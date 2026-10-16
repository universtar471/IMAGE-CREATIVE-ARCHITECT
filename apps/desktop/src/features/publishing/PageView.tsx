import type { CSSProperties, DragEvent, ElementType } from "react";
import {
  PAPER_DIMENSIONS_PT,
  resolvePublicationStyle,
  type AssetDTO,
  type Page,
  type PageSlot,
  type Publication,
} from "@arch/domain";
import { fileUrl } from "../../lib/files";
import { useT } from "../../i18n";
import type { SlotRef } from "./publishing";

const DRAG_TYPE = "application/x-publication-slot";

const pct = (value: number) => `${value * 100}%`;

/**
 * One page as laid out in the book, in the book's style: the same normalized rects and
 * type sizes as the export renderer, drawn with DOM (font sizes scale with the page width).
 * `interactive` adds frame selection and image drag-and-drop between frames.
 */
export function PageView({
  publication,
  page,
  assets,
  thumbnail = false,
  selectedSlotId = null,
  onSelectSlot,
  onSwap,
}: {
  publication: Publication;
  page: Page;
  assets: readonly AssetDTO[];
  thumbnail?: boolean;
  selectedSlotId?: string | null;
  onSelectSlot?: (slotId: string) => void;
  onSwap?: (from: SlotRef, to: SlotRef) => void;
}) {
  const t = useT();
  const style = resolvePublicationStyle(publication.type, publication.styleId);
  const paper = PAPER_DIMENSIONS_PT[publication.paper];
  const locked = publication.lockedPageIds.includes(page.id);
  const interactive = !!onSelectSlot && !thumbnail;
  const fontSize = (pt: number) => `${(pt / paper.width) * 100}cqw`;
  // Thumbnails sit inside a page button, so their frames are plain boxes.
  const Slot: ElementType = interactive ? "button" : "div";
  const control = (selected: boolean, onClick: () => void): Record<string, unknown> =>
    interactive ? { type: "button", "aria-pressed": selected, onClick } : { "aria-hidden": true };

  const frame = (slot: PageSlot): CSSProperties => ({
    left: pct(slot.rect.x),
    top: pct(slot.rect.y),
    width: pct(slot.rect.w),
    height: pct(slot.rect.h),
  });

  const dragStart = (event: DragEvent, slot: PageSlot) => {
    event.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ pageId: page.id, slotId: slot.id }));
    event.dataTransfer.effectAllowed = "move";
  };
  const drop = (event: DragEvent, slot: PageSlot) => {
    const raw = event.dataTransfer.getData(DRAG_TYPE);
    if (!raw || !onSwap) return;
    event.preventDefault();
    onSwap(JSON.parse(raw) as SlotRef, { pageId: page.id, slotId: slot.id });
  };

  return (
    <div
      className={`pub-page ${thumbnail ? "is-thumb" : ""}`}
      style={{
        aspectRatio: `${paper.width} / ${paper.height}`,
        background: style.palette.background,
        color: style.palette.foreground,
      }}
      data-testid={thumbnail ? undefined : "pub-page"}
    >
      {page.slots.map((slot) => {
        const selected = slot.id === selectedSlotId;
        const className = `pub-slot pub-slot-${slot.type} ${selected ? "is-selected" : ""}`;
        const select = () => onSelectSlot?.(slot.id);
        if (slot.type === "image") {
          const asset = assets.find((item) => item.id === slot.assetId);
          const src = fileUrl(thumbnail ? asset?.thumbnailPath : asset?.absolutePath);
          const canDrag = interactive && !locked && !!onSwap;
          return (
            <Slot
              key={slot.id}
              {...control(selected, select)}
              className={className}
              style={{ ...frame(slot), background: style.palette.muted }}
              aria-label={slot.label ?? asset?.originalName ?? t("publishing.imageSlot")}
              title={canDrag ? t("publishing.dragImage") : undefined}
              draggable={canDrag}
              onDragStart={canDrag ? (event) => dragStart(event, slot) : undefined}
              onDragOver={canDrag ? (event) => event.preventDefault() : undefined}
              onDrop={canDrag ? (event) => drop(event, slot) : undefined}
              data-testid={interactive ? `pub-slot-${slot.id}` : undefined}
            >
              {src ? (
                <img src={src} alt="" draggable={false} style={{ objectFit: slot.fit }} />
              ) : (
                <span className="pub-missing">{t("publishing.missingImage")}</span>
              )}
              {slot.label && publication.type === "catalog" && (
                <span className="pub-label" style={{ fontSize: fontSize(style.typeScale.label) }}>
                  {slot.label}
                </span>
              )}
            </Slot>
          );
        }
        const text =
          slot.type === "text" ? slot.text : slot.caption.sentences.map((s) => s.text).join(" ");
        const review = slot.type === "caption" && slot.caption.needs_review;
        const pt =
          slot.fontSizePt ??
          (slot.type === "caption" ? style.typeScale.caption : style.typeScale.body);
        const heading =
          slot.type === "text" && (slot.role === "headline" || slot.role === "chapter");
        return (
          <Slot
            key={slot.id}
            {...control(selected, select)}
            className={`${className} ${text.trim() ? "" : "is-empty"} ${review ? "is-review" : ""}`}
            style={{
              ...frame(slot),
              fontSize: fontSize(pt),
              fontFamily: (heading ? style.fontFamilies.display : style.fontFamilies.body).join(
                ", ",
              ),
              fontWeight: heading ? 600 : 400,
              textAlign: slot.type === "text" && slot.role === "chapter" ? "center" : "left",
              textTransform:
                slot.type === "caption" && style.caption.uppercase ? "uppercase" : undefined,
            }}
            aria-label={
              slot.type === "caption" ? t("publishing.captionSlot") : t("publishing.textSlot")
            }
            data-testid={interactive ? `pub-slot-${slot.id}` : undefined}
          >
            {text.trim() ? text : !thumbnail && interactive ? t("publishing.emptyFrame") : null}
          </Slot>
        );
      })}
      {locked && <span className="pub-lock-mark" aria-hidden="true" />}
    </div>
  );
}
