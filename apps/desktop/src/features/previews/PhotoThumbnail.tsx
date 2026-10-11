import { useState, type ReactNode } from "react";
import { usePreviewPhoto, type PreviewKind } from "../../lib/previewPhotos";

export function PhotoThumbnail({
  kind,
  presetId,
  label,
  interior = false,
  children,
}: {
  kind: PreviewKind;
  presetId: string;
  label: string;
  interior?: boolean;
  children: ReactNode;
}) {
  const photo = usePreviewPhoto(kind, presetId, interior);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  return photo && failedSrc !== photo.src ? (
    <img
      src={photo.src}
      width={photo.w}
      height={photo.h}
      loading="lazy"
      alt={label}
      style={{ objectFit: "contain" }}
      onError={() => setFailedSrc(photo.src)}
    />
  ) : (
    children
  );
}
