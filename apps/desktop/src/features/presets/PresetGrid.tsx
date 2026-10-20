import { useState } from "react";
import { X } from "lucide-react";
import {
  PRESET_GROUPS,
  normalizePresetIds,
  presetShotIsInterior,
  presetsForShot,
  setShotPresets,
  shotPreset,
  togglePreset,
  type ProjectDNA,
} from "@arch/domain";
import { selectReadOnly, useStudio } from "../../app/store";
import { useLocale, useT } from "../../i18n";
import { UserPresetsRow } from "./UserPresetsRow";
import { presetLabel, presetLabels } from "./labels";
import { PremiumIcon } from "../../components/common/PremiumIcon";
import { groupVisualId, presetVisualId } from "./presetVisuals";

/**
 * Preset studio (ADR-039): one click adds a chip that writes structured choices into the
 * per-shot ShotIntent. Exclusive presets (one time of day, one weather, one view…) replace
 * each other. Nothing here edits the project DNA.
 */
export function PresetGrid({ disabled = false }: { disabled?: boolean }) {
  const ws = useStudio((s) => s.workspace!);
  const setShotIntent = useStudio((s) => s.setShotIntent);
  const readOnly = useStudio(selectReadOnly);
  const locale = useLocale((s) => s.locale);
  const t = useT();
  const [skipped, setSkipped] = useState<string[]>([]);

  const projectType = ws.project.projectType;
  const dna = ws.draftDna as ProjectDNA;
  const shot = ws.shotIntent;
  const selected = shot?.presetIds ?? [];
  const offered = presetsForShot(presetShotIsInterior(dna, projectType));
  const locked = disabled || readOnly;

  const apply = (ids: string[]) => {
    const result = setShotPresets({ ...(shot ?? {}), projectType }, ids, dna);
    setSkipped(result.skipped);
    setShotIntent(result.shotIntent);
  };

  return (
    <div className="preset-studio" data-testid="preset-studio">
      <div className="preset-selected" aria-label={t("presets.selected")}>
        {selected.length === 0 ? (
          <span className="field-hint">{t("presets.none")}</span>
        ) : (
          selected.map((id) => {
            const preset = shotPreset(id);
            const label = preset ? presetLabel(preset, locale) : id;
            return (
              <span className="preset-chip" key={id} data-testid={`preset-chip-${id}`}>
                {label}
                {preset?.group === "color_look" && (
                  <small className="preset-chip-note">{t("presets.lookFree")}</small>
                )}
                <button
                  type="button"
                  className="preset-chip-remove"
                  disabled={locked}
                  aria-label={t("presets.remove", { label })}
                  onClick={() => apply(togglePreset(selected, id))}
                >
                  <X size={11} />
                </button>
              </span>
            );
          })
        )}
      </div>
      {skipped.length > 0 && (
        <span className="field-hint" role="status" data-testid="preset-skipped">
          {t("presets.skipped", { list: presetLabels(skipped, locale).join(", ") })}
        </span>
      )}
      <UserPresetsRow
        selected={selected}
        disabled={locked}
        onApply={(ids) => apply(normalizePresetIds(ids))}
      />
      {PRESET_GROUPS.map((group) => {
        const items = offered.filter((p) => p.group === group);
        if (!items.length) return null;
        return (
          <div className="preset-group" key={group}>
            <div className="preset-group-heading">
              <PremiumIcon id={groupVisualId[group]} size={20} />
              <span className="field-label">{t(`presets.groups.${group}`)}</span>
              <span className="preset-group-count" aria-hidden="true">
                {items.length}
              </span>
            </div>
            <div className="preset-options" role="group" aria-label={t(`presets.groups.${group}`)}>
              {items.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="chip premium-preset-card"
                  aria-pressed={selected.includes(preset.id)}
                  disabled={locked}
                  title={locale === "vi" ? preset.hintVi : preset.hintEn}
                  data-preset={preset.id}
                  onClick={() => apply(togglePreset(selected, preset.id))}
                >
                  <PremiumIcon
                    id={presetVisualId(preset)}
                    size={31}
                    className="premium-preset-icon"
                  />
                  <span className="preset-option-label">{presetLabel(preset, locale)}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
