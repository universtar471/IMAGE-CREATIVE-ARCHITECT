import { useState } from "react";
import {
  GENERATION_STYLES,
  type InteriorGenerationState,
  type InteriorStyleId,
} from "@arch/domain";
import { Dialog } from "../../../components/common/Dialog";
import { PhotoThumbnail } from "../../previews/PhotoThumbnail";
import { useLocale, useT } from "../../../i18n";

export function InteriorStylePicker({
  state,
  set,
  disabled,
  children,
}: {
  state: InteriorGenerationState;
  set: (next: InteriorGenerationState) => void;
  disabled: boolean;
  children?: React.ReactNode;
}) {
  const t = useT();
  const locale = useLocale((s) => s.locale);
  const [all, setAll] = useState(false);
  const choose = (id: InteriorStyleId | null) => {
    set({ ...state, style: id });
    setAll(false);
  };
  const visible = GENERATION_STYLES.slice(0, 6);
  const selected = GENERATION_STYLES.find((s) => s.id === state.style);
  if (selected && !visible.includes(selected)) visible[visible.length - 1] = selected;
  const grid = (items: typeof GENERATION_STYLES) => (
    <div className="interior-style-grid" role="group" aria-label={t("interiorFlow.style")}>
      {items.map((item) => (
        <button
          type="button"
          className="style-thumbnail"
          key={item.id}
          aria-pressed={state.style === item.id}
          disabled={disabled || state.changeLevel === 0}
          title={item.description[locale]}
          onClick={() => choose(item.id as InteriorStyleId)}
        >
          <PhotoThumbnail kind="style" presetId={item.id} label={item.label[locale]}>
            <span>{item.label[locale]}</span>
          </PhotoThumbnail>
          <span>{item.label[locale]}</span>
        </button>
      ))}
    </div>
  );
  return (
    <>
      <button
        type="button"
        className="btn btn-sm"
        disabled={disabled}
        aria-pressed={state.style === null}
        onClick={() => choose(null)}
      >
        {t("interiorFlow.originalStyle")}
      </button>
      {grid(visible)}
      <button type="button" className="btn btn-sm" onClick={() => setAll(true)}>
        {t("interiorFlow.allStyles")}
      </button>
      {children}
      {state.style &&
        (state.preserve.architecture || state.preserve.furniture || state.preserve.materials) && (
          <span className="field-hint">{t("interiorFlow.styleLocks")}</span>
        )}
      {all && (
        <Dialog title={t("interiorFlow.allStyles")} onClose={() => setAll(false)}>
          {grid(GENERATION_STYLES)}
        </Dialog>
      )}
    </>
  );
}
