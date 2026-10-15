import { useEffect, useState } from "react";

export type PreviewPhotoManifest = {
  version: 1;
  items: Record<string, { src: string; w: number; h: number }>;
};
export type PreviewKind =
  "lighting" | "lighting_interior" | "mood" | "mood_interior" | "context" | "style";

export function previewPhoto(
  kind: PreviewKind,
  id: string,
  manifest: PreviewPhotoManifest,
  interior = false,
) {
  const preferred =
    interior && (kind === "lighting" || kind === "mood") ? `${kind}_interior` : kind;
  const entry =
    manifest.items[`${preferred}/${id}`] ??
    (preferred !== kind ? manifest.items[`${kind}/${id}`] : undefined);
  return entry;
}

let manifestPromise: Promise<PreviewPhotoManifest | null> | undefined;
let loadedManifest: PreviewPhotoManifest | null = null;

export function loadPreviewPhotos(): Promise<PreviewPhotoManifest | null> {
  manifestPromise ??= fetch("/previews/manifest.json")
    .then(async (response) => {
      if (!response.ok) return null;
      const data: unknown = await response.json();
      if (
        !data ||
        typeof data !== "object" ||
        !("version" in data) ||
        data.version !== 1 ||
        !("items" in data) ||
        !data.items ||
        typeof data.items !== "object"
      )
        return null;
      loadedManifest = data as PreviewPhotoManifest;
      return loadedManifest;
    })
    .catch(() => null);
  return manifestPromise;
}

export function presetPhoto(
  kind: PreviewKind,
  id: string,
  interior = false,
  manifest: PreviewPhotoManifest | null = loadedManifest,
) {
  const entry = manifest && previewPhoto(kind, id, manifest, interior);
  return entry && /^previews\/[a-z_]+\/[a-zA-Z0-9_-]+\.webp$/.test(entry.src)
    ? { ...entry, src: `/${entry.src}` }
    : undefined;
}

export function usePreviewPhoto(kind: PreviewKind, id: string, interior = false) {
  const [manifest, setManifest] = useState<PreviewPhotoManifest | null>(null);
  useEffect(() => {
    let active = true;
    void loadPreviewPhotos().then((loaded) => {
      if (active) setManifest(loaded);
    });
    return () => {
      active = false;
    };
  }, []);
  return presetPhoto(kind, id, interior, manifest);
}
