import { useState } from "react";
import { INTERIOR_STYLES, PALETTES, applyStyleDefaults, type InteriorStyleId } from "@arch/domain";
import { selectReadOnly, useStudio } from "../../app/store";
import { Dialog } from "../../components/common/Dialog";
import { HelpPopover } from "../../components/common/HelpPopover";
import { SelectField } from "../../components/panels/fields";
import { PhotoThumbnail } from "../previews/PhotoThumbnail";
import { ModuleAssist } from "../assist/ModuleAssist";
import { knowledge } from "../../lib/knowledge";
import { styleLabel } from "../../i18n/knowledge";
import { useLocale, useT } from "../../i18n";

/** One thumbnail/detail interaction for both design modes. */
export function StylePanel() {
  const ws = useStudio((s) => s.workspace!);
  const disabled = useStudio(selectReadOnly) || ws.draftDna.locks.building;
  const t = useT();
  const locale = useLocale((s) => s.locale);
  const [preview, setPreview] = useState<string | null>(null);
  const interior = ws.draftDna.interior;
  const pack = knowledge.resolve(ws.project.projectType, ws.project.subtype).pack;
  const items = interior
    ? INTERIOR_STYLES.map((s) => ({ id: s.id, label: s[locale] }))
    : [
        ...new Set([
          ...(pack?.styleSuggestions ?? []),
          "modern",
          "minimalist",
          "modern tropical",
          "japandi",
          "indochine",
          "neo-classical",
        ]),
      ].map((id) => ({ id, label: styleLabel(id) }));
  const selected = interior?.styleId ?? ws.draftDna.building.architecturalStyle;
  const apply = (id: string) => {
    if (disabled) return;
    if (interior) {
      const next = applyStyleDefaults(
        {
          ...interior,
          surfaces: {
            floor: [],
            wall: [],
            ceiling: [],
            cabinetry: [],
            countertop: [],
            textile: [],
            metal: [],
          },
        },
        id as InteriorStyleId,
      );
      useStudio.getState().editDna("interior", next);
    } else useStudio.getState().editDna("building.architecturalStyle", id);
    setPreview(null);
  };
  return (
    <div className="style-panel">
      <HelpPopover topic={t("menu.style")}>{t("menu.styleHelp")}</HelpPopover>
      <ModuleAssist scope="style" stepId="dna.building" />
      <div className="style-thumbnail-grid" role="group" aria-label={t("menu.style")}>
        {items.map((item) => (
          <button
            type="button"
            className="style-thumbnail"
            key={item.id}
            aria-label={item.label}
            aria-pressed={selected === item.id}
            onClick={() => setPreview(item.id)}
          >
            <PhotoThumbnail
              kind={interior ? "style" : "style_architecture"}
              presetId={item.id}
              label={item.label}
            >
              <span className="style-thumbnail-fallback">{item.label}</span>
            </PhotoThumbnail>
            <span>{item.label}</span>
          </button>
        ))}
      </div>
      {interior && (
        <SelectField
          label={t("interior.palette")}
          disabled={disabled}
          value={interior.paletteId}
          options={PALETTES.map((p) => ({ value: p.id, label: p[locale] }))}
          onChange={(id) => useStudio.getState().editDna("interior.paletteId", id)}
        />
      )}
      {preview && (
        <Dialog
          title={items.find((s) => s.id === preview)?.label ?? preview}
          onClose={() => setPreview(null)}
          footer={
            <button className="btn btn-primary" disabled={disabled} onClick={() => apply(preview)}>
              {t("menu.apply")}
            </button>
          }
        >
          <div className="style-detail-preview">
            <PhotoThumbnail
              kind={interior ? "style" : "style_architecture"}
              presetId={preview}
              label={preview}
            >
              <span>{preview}</span>
            </PhotoThumbnail>
          </div>
          {interior && (
            <div className="moodboard-palette">
              {PALETTES.find(
                (p) => p.id === INTERIOR_STYLES.find((s) => s.id === preview)?.paletteId,
              )?.swatches.map((color) => (
                <span
                  className="moodboard-swatch"
                  key={color}
                  style={{ background: color }}
                  title={color}
                />
              ))}
            </div>
          )}
          <p>{t("menu.styleHelp")}</p>
        </Dialog>
      )}
    </div>
  );
}
