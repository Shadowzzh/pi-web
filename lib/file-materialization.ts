import { tmpdir } from "node:os";
import { AttachmentStore, ATTACHMENT_IDLE_TTL_MS, type MaterializedBatch } from "./attachment-store";
import {
  fileAttachmentExtension,
  sanitizeAttachmentName,
  validateAgentFiles,
  type Base64FileAttachment,
} from "./file-attachments";

export const FILE_IDLE_TTL_MS = ATTACHMENT_IDLE_TTL_MS;

type AgentFileAttachment = Base64FileAttachment;

export interface MaterializedFiles extends MaterializedBatch {
  /** Sanitized original names, index-aligned with `paths`. */
  names: string[];
}

export class FileAttachmentStore extends AttachmentStore {
  constructor(options: {
    root?: string;
    now?: () => number;
    isBusy?: () => boolean;
    isProcessAlive?: (pid: number) => boolean;
  } = {}) {
    super({
      ownerPrefix: "pi-web-attach-v1",
      filePrefix: "pi-web-attach",
      label: "file attachment",
      root: options.root ?? tmpdir(),
      now: options.now,
      isBusy: options.isBusy,
      isProcessAlive: options.isProcessAlive,
    });
  }

  materialize(files: AgentFileAttachment[]): Promise<MaterializedFiles> {
    return this.exclusive(async () => {
      const error = validateAgentFiles(files);
      if (error) throw new Error(error);
      const batch = await this.writeBatch(
        files.map(file => ({ data: file.data, extension: fileAttachmentExtension(file.name) })),
      );
      return { ...batch, names: files.map(file => sanitizeAttachmentName(file.name)) };
    });
  }
}

export function appendFilePaths(message: string, entries: Array<{ path: string; name: string }>): string {
  if (!entries.length) return message;
  // The space preserves the SDK's split-on-first-space /command behavior; JSON quoting keeps
  // newlines inside a path or name from confusing the annotation.
  const lines = entries.map((entry, index) => {
    const name = entry.name ? ` (original name: ${JSON.stringify(entry.name)})` : "";
    return `${index + 1}. ${JSON.stringify(entry.path)}${name}`;
  });
  return `${message} \n\n[Attached files on this server (temporary):\n${lines.join("\n")}\nUse these paths to read the files.]`;
}

declare global {
  var __piFileAttachmentStore: FileAttachmentStore | undefined;
}

export function getFileAttachmentStore(isBusy: () => boolean): FileAttachmentStore {
  if (!globalThis.__piFileAttachmentStore) {
    const store = new FileAttachmentStore({ isBusy });
    globalThis.__piFileAttachmentStore = store;
    store.installProcessLifecycle();
  }
  return globalThis.__piFileAttachmentStore;
}
