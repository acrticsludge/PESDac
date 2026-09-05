// Staged upload helpers (mockup stage): files picked in the composer live
// here until send. Only metadata (`Attachment`) is ever persisted —
// preview URLs and File handles stay in memory and are revoked on
// remove/send. Backend will replace staging with real uploads and swap
// the metadata for server ids/URLs (same shape otherwise).

import type { Attachment } from "../content/threads/types";

export type StagedFile = {
  att: Attachment;
  file?: File;
  previewUrl?: string;
};

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function stageFiles(files: File[]): StagedFile[] {
  return files.map((file) => ({
    att: {
      id: makeId(),
      name: file.name,
      mime: file.type || "application/octet-stream",
      size: file.size,
    },
    file,
    previewUrl: file.type.startsWith("image/")
      ? URL.createObjectURL(file)
      : undefined,
  }));
}

export function revokeStaged(staged: StagedFile[]) {
  for (const s of staged) {
    if (s.previewUrl) URL.revokeObjectURL(s.previewUrl);
  }
}

export function formatFileSize(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Chip label for an attachment (name + size when known). */
export function attachmentLabel(att: Attachment): string {
  const size = formatFileSize(att.size);
  return size ? `${att.name} · ${size}` : att.name;
}
