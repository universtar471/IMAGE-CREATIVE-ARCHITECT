/**
 * File-system helpers for the UI: picking images to import and turning managed
 * file paths into URLs the webview can display.
 */
import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { SUPPORTED_IMPORT_EXTENSIONS } from "@arch/domain";

/** URL for a managed file path (thumbnail or selected original). */
export function fileUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (!isTauri()) return path; // mock backend already returns blob:/data: URLs
  return convertFileSrc(path);
}

/** Ask the user for one or more images. Returns absolute paths (or mock handles). */
export async function pickImages(): Promise<string[]> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({
      multiple: true,
      directory: false,
      title: "Import images",
      filters: [{ name: "Images (JPEG, PNG, WebP)", extensions: [...SUPPORTED_IMPORT_EXTENSIONS] }],
    });
    if (!picked) return [];
    return Array.isArray(picked) ? picked : [picked];
  }
  return pickBrowserFiles();
}

async function pickBrowserFiles(): Promise<string[]> {
  const { registerBrowserFile } = await import("./mockBackend");
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = SUPPORTED_IMPORT_EXTENSIONS.map((e) => `.${e}`).join(",");
    input.onchange = () => resolve([...(input.files ?? [])].map(registerBrowserFile));
    input.oncancel = () => resolve([]);
    input.click();
  });
}

export function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
