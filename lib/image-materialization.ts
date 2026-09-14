import { tmpdir } from "node:os";
import { AttachmentStore, ATTACHMENT_IDLE_TTL_MS, type MaterializedBatch } from "./attachment-store";
import { validateAgentImages, type Base64ImageAttachment } from "./image-attachments";

export const IMAGE_IDLE_TTL_MS = ATTACHMENT_IDLE_TTL_MS;
const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp",
  "image/avif": "avif", "image/svg+xml": "svg", "image/bmp": "bmp",
  "image/tiff": "tiff", "image/heic": "heic", "image/heif": "heif",
  "image/x-icon": "ico", "image/vnd.microsoft.icon": "ico", "image/x-ms-bmp": "bmp",
};

export type MaterializedImages = MaterializedBatch;

type AgentImageAttachment = Base64ImageAttachment & { type: "image" };

export class ImageAttachmentStore extends AttachmentStore {
  constructor(options: {
    root?: string;
    now?: () => number;
    isBusy?: () => boolean;
    isProcessAlive?: (pid: number) => boolean;
  } = {}) {
    super({
      ownerPrefix: "pi-web-clipboard-v1",
      filePrefix: "pi-web-clipboard",
      label: "image attachment",
      root: options.root ?? tmpdir(),
      now: options.now,
      isBusy: options.isBusy,
      isProcessAlive: options.isProcessAlive,
    });
  }

  materialize(images: AgentImageAttachment[]): Promise<MaterializedImages> {
    return this.exclusive(async () => {
      const error = validateAgentImages(images);
      if (error) throw new Error(error);
      const extensions = images.map(image => {
        const extension = MIME_EXTENSIONS[image.mimeType];
        if (!extension) throw new Error(`Unsupported image MIME type: ${image.mimeType}`);
        return extension;
      });
      return this.writeBatch(images.map((image, index) => ({ data: image.data, extension: extensions[index] })));
    });
  }
}

export function appendImagePaths(message: string, paths: string[]): string {
  if (!paths.length) return message;
  // The space preserves the SDK's split-on-first-space /command behavior; JSON quoting keeps
  // newlines inside a path from confusing the annotation.
  return `${message} \n\n[Attached image files on this server (temporary):\n${paths.map((path, index) => `${index + 1}. ${JSON.stringify(path)}`).join("\n")}\nThe same images are also included as image inputs. Use these paths for file/image tools.]`;
}

declare global {
  var __piImageAttachmentStore: ImageAttachmentStore | undefined;
}

export function getImageAttachmentStore(isBusy: () => boolean): ImageAttachmentStore {
  if (!globalThis.__piImageAttachmentStore) {
    const store = new ImageAttachmentStore({ isBusy });
    globalThis.__piImageAttachmentStore = store;
    store.installProcessLifecycle();
  }
  return globalThis.__piImageAttachmentStore;
}
