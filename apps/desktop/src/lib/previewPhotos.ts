export type PreviewPhotoManifest = { version: 1; items: Record<string, { src: string; w: number; h: number }> };
export type PreviewKind = "lighting" | "lighting_interior" | "mood" | "mood_interior" | "context" | "style";

// TODO(assist-core): photo manifest schema is intentionally local to the desktop UI.
export function previewPhoto(kind: PreviewKind, id: string, manifest: PreviewPhotoManifest, interior = false) {
  const preferred = interior && (kind === "lighting" || kind === "mood") ? `${kind}_interior` : kind;
  const entry = manifest.items[`${preferred}/${id}`] ?? (preferred !== kind ? manifest.items[`${kind}/${id}`] : undefined);
  return entry;
}

const manifest = { version: 1, items: {} } as PreviewPhotoManifest;
try {
  const loaded = await import("../../public/previews/manifest.json");
  Object.assign(manifest, loaded.default);
} catch { /* The bundled UI falls back to the SVG preview when absent. */ }

export const presetPhoto = (kind: PreviewKind, id: string, interior = false) => previewPhoto(kind, id, manifest, interior);
