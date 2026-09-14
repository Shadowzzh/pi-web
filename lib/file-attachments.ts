import { getBase64DecodedByteLength } from "./image-attachments";

export const MAX_ATTACHED_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_ATTACHED_FILES = 10;

export interface Base64FileAttachment {
  /** Client-supplied display name; never used as a server path component. */
  name: string;
  mimeType?: string;
  data: string;
}

const EXTENSION = /^[a-zA-Z0-9]{1,10}$/;
const MAX_DISPLAY_NAME_LENGTH = 200;

/** Strip control characters and path separators from a client-supplied name for display. */
export function sanitizeAttachmentName(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.split(/[\\/]/).pop() ?? "";
  const printable = trimmed.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return printable.slice(0, MAX_DISPLAY_NAME_LENGTH);
}

/** Derive a safe file extension from the display name, falling back to `bin`. */
export function fileAttachmentExtension(name: string): string {
  const match = /\.([a-zA-Z0-9]{1,10})$/.exec(sanitizeAttachmentName(name));
  return match && EXTENSION.test(match[1]) ? match[1].toLowerCase() : "bin";
}

/**
 * Returns an API-safe error for prompt, steering, and follow-up file arrays.
 * Any file type is allowed; only the count, base64 shape and size are checked.
 */
export function validateAgentFiles(value: unknown): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return "files must be an array";
  if (value.length > MAX_ATTACHED_FILES) {
    return `A message can include at most ${MAX_ATTACHED_FILES} files`;
  }
  for (const file of value) {
    if (!file || typeof file !== "object") return "Each attachment must be a file";
    const candidate = file as Partial<Base64FileAttachment>;
    if (typeof candidate.name !== "string" || !candidate.name.trim()) {
      return "Each file needs a name";
    }
    if (typeof candidate.data !== "string") {
      return "Each file needs base64 file data";
    }
    const bytes = getBase64DecodedByteLength(candidate.data);
    if (bytes === null) {
      return "Each file must contain valid base64 file data";
    }
    if (bytes > MAX_ATTACHED_FILE_BYTES) {
      return `Each file must be ${MAX_ATTACHED_FILE_BYTES / (1024 * 1024)}MB or smaller`;
    }
  }
  return null;
}
