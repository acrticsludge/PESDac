"use client";

import { useRef } from "react";

import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";

import { PaperClipIcon } from "@heroicons/react/24/outline";

// Paperclip button that opens the native file picker. Staging/preview lives
// with the composer (see lib/attachments); this only produces File objects.
export default function AttachButton({
  onFiles,
  label = "Attach files",
}: {
  onFiles: (files: File[]) => void;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <Button
        label={label}
        variant="ghost"
        size="sm"
        isIconOnly
        icon={<Icon icon={PaperClipIcon} size="sm" />}
        onClick={() => inputRef.current?.click()}
      />
      <input
        ref={inputRef}
        type="file"
        multiple
        style={{ display: "none" }}
        aria-hidden
        tabIndex={-1}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          // Reset so the same file can be picked twice in a row.
          event.target.value = "";
          if (files.length > 0) onFiles(files);
        }}
      />
    </>
  );
}
