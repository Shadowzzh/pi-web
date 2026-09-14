import fs from "node:fs/promises";
import { rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const ATTACHMENT_IDLE_TTL_MS = 24 * 60 * 60 * 1000;
export const ATTACHMENT_GC_INTERVAL_MS = 60 * 60 * 1000;

export interface MaterializedBatch {
  paths: string[];
  rollback: () => Promise<void>;
}

export interface AttachmentWrite {
  /** Base64 payload written to disk unchanged. */
  data: string;
  /** Extension without the dot, already validated by the caller. */
  extension: string;
}

export interface AttachmentStoreOptions {
  /** Directory that holds this store's owner directory; defaults to `os.tmpdir()`. */
  root?: string;
  /** Prefix of the per-process owner directory, e.g. `pi-web-clipboard-v1`. */
  ownerPrefix: string;
  /** Prefix of every materialized file, e.g. `pi-web-clipboard`. */
  filePrefix: string;
  /** Label used in cleanup error logs. */
  label: string;
  ttlMs?: number;
  now?: () => number;
  isBusy?: () => boolean;
  isProcessAlive?: (pid: number) => boolean;
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // Permission errors and other unexpected failures must not count as process exit.
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function reportAttachmentCleanupError(label: string, error: unknown): void {
  console.error(`[pi-web] ${label} cleanup failed:`, error);
}

/**
 * Owns one private temporary directory per server process and writes attachment
 * batches below it. Subclasses add validation and decide the file extension.
 */
export class AttachmentStore {
  protected readonly root: string;
  protected readonly ownerPrefix: string;
  protected readonly filePrefix: string;
  protected readonly label: string;
  protected readonly ttlMs: number;
  protected readonly now: () => number;
  protected readonly isBusy: () => boolean;
  protected readonly isProcessAlive: (pid: number) => boolean;
  protected directory?: string;
  protected lastActivity: number;
  private readonly ownerDirectory: RegExp;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(options: AttachmentStoreOptions) {
    this.root = options.root ?? tmpdir();
    this.ownerPrefix = options.ownerPrefix;
    this.filePrefix = options.filePrefix;
    this.label = options.label;
    this.ttlMs = options.ttlMs ?? ATTACHMENT_IDLE_TTL_MS;
    this.now = options.now ?? Date.now;
    this.isBusy = options.isBusy ?? (() => false);
    this.isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
    this.ownerDirectory = new RegExp(`^${escapeRegExp(this.ownerPrefix)}-([1-9]\\d*)-[a-zA-Z0-9]{6}$`);
    this.lastActivity = this.now();
  }

  touch(): void {
    this.lastActivity = this.now();
  }

  protected exclusive<T>(operation: () => Promise<T>): Promise<T> {
    // Cleanup, rollback and writes share one queue so async deletion cannot race a new batch write.
    const result = this.tail.then(operation);
    this.tail = result.catch(() => {});
    return result;
  }

  /**
   * Write one batch of already-validated items. Callers must hold the exclusive
   * queue (see `exclusive`) so cleanup cannot interleave with the write.
   */
  protected async writeBatch(items: AttachmentWrite[]): Promise<MaterializedBatch> {
    this.touch();
    if (!items.length) return { paths: [], rollback: async () => {} };
    if (!this.directory) {
      await this.collectOrphans();
      await fs.mkdir(this.root, { recursive: true });
      this.directory = await fs.mkdtemp(join(this.root, `${this.ownerPrefix}-${process.pid}-`));
      await fs.chmod(this.directory, 0o700);
    }
    const batch = await fs.mkdtemp(join(this.directory, "batch-"));
    const paths: string[] = [];
    try {
      await fs.chmod(batch, 0o700);
      for (const item of items) {
        const path = join(batch, `${this.filePrefix}-${randomUUID()}.${item.extension}`);
        await fs.writeFile(path, Buffer.from(item.data, "base64"), { mode: 0o600, flag: "wx" });
        paths.push(path);
      }
    } catch (error) {
      await fs.rm(batch, { recursive: true, force: true }).catch(
        cleanupError => reportAttachmentCleanupError(this.label, cleanupError),
      );
      throw error;
    }
    this.touch();
    return {
      paths,
      rollback: () => this.exclusive(() => fs.rm(batch, { recursive: true, force: true })),
    };
  }

  collect(): Promise<void> {
    return this.exclusive(async () => {
      if (this.isBusy()) this.touch();
      if (this.directory && this.now() - this.lastActivity >= this.ttlMs) {
        await fs.rm(this.directory, { recursive: true, force: true });
        this.directory = undefined;
      }
      await this.collectOrphans();
    });
  }

  private async collectOrphans(): Promise<void> {
    const entries = await fs.readdir(this.root, { withFileTypes: true }).catch(error => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    });
    for (const entry of entries) {
      const match = this.ownerDirectory.exec(entry.name);
      if (!entry.isDirectory() || !match) continue;
      const pid = Number(match[1]);
      if (!Number.isSafeInteger(pid) || this.isProcessAlive(pid)) continue;
      const path = join(this.root, entry.name);
      try {
        const stat = await fs.lstat(path);
        if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
        if (process.getuid && stat.uid !== process.getuid()) continue;
        if (this.now() - stat.mtimeMs < this.ttlMs) continue;
        await fs.rm(path, { recursive: true, force: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          reportAttachmentCleanupError(this.label, error);
        }
      }
    }
  }

  disposeSync(): void {
    if (!this.directory) return;
    rmSync(this.directory, { recursive: true, force: true });
    this.directory = undefined;
  }

  /** Periodic GC plus process-exit cleanup; call once per long-lived store instance. */
  installProcessLifecycle(): void {
    const timer = setInterval(() => {
      void this.collect().catch(error => reportAttachmentCleanupError(this.label, error));
    }, ATTACHMENT_GC_INTERVAL_MS);
    timer.unref();
    process.once("exit", () => {
      clearInterval(timer);
      try { this.disposeSync(); } catch (error) { reportAttachmentCleanupError(this.label, error); }
    });
  }
}
