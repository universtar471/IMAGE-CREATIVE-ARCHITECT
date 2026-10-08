import { ImageOff } from "lucide-react";
import { useStudio } from "../../app/store";
import { fileUrl } from "../../lib/files";

/** Small output thumbnails of a generation; clicking one selects it in the canvas. */
export function OutputThumbs({
  ids,
  selectedId,
  onSelect,
  size = "md",
}: {
  ids: readonly string[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  size?: "sm" | "md";
}) {
  const assets = useStudio((s) => s.workspace?.assets ?? []);
  return (
    <div className={`out-thumbs out-thumbs-${size}`}>
      {ids.map((id) => {
        const a = assets.find((x) => x.id === id);
        const src = a && a.status === "ready" ? fileUrl(a.thumbnailPath) : null;
        return (
          <button
            key={id}
            type="button"
            className="out-thumb"
            aria-pressed={id === selectedId}
            title={a?.originalName ?? id}
            onClick={() => onSelect(id)}
            data-testid="output-thumb"
          >
            {src ? (
              <img src={src} alt="" loading="lazy" decoding="async" />
            ) : (
              <ImageOff size={14} />
            )}
          </button>
        );
      })}
    </div>
  );
}
