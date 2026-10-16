/**
 * Optical and motion effects (ADR-036 P2c, SRS §6.2): one card per effect with its "feel"
 * name, the compatibility status of the shot and a light / medium / strong slider.
 *
 * Everything is off by default; a shot has one primary effect, and secondary effects can be
 * added only when they are compatible. A blocked effect is disabled with its plain reason, a
 * conditional one shows a hint. The selection is a per-shot choice: it goes into the open
 * project's ShotIntent in the workspace store (never the DNA), and every submit still goes
 * through the conflict gate (`validateShot` runs the same matrix).
 */
import {
  EFFECT_CATALOG,
  EFFECT_INTENSITIES,
  MAX_SECONDARY_EFFECTS,
  effectsCompatibility,
  effectsCompatibleTogether,
  effectsLines,
  selectedEffects,
  type EffectChoice,
  type EffectCompatibility,
  type EffectDefinition,
  type EffectId,
  type EffectIntensity,
  type ProjectDNA,
  type ShotEffects,
} from "@arch/domain";
import { selectReadOnly, useStudio } from "../../app/store";
import { SectionPanel } from "../../components/panels/SectionPanel";
import { useLocale, useT } from "../../i18n";

const STATUS_BADGE: Record<EffectCompatibility["status"], string> = {
  available: "badge-success",
  conditional: "badge-warning",
  blocked: "badge-danger",
};

export function EffectsPanel() {
  const t = useT();
  const locale = useLocale((s) => s.locale);
  const readOnly = useStudio(selectReadOnly);
  const setShotIntent = useStudio((s) => s.setShotIntent);
  const projectType = useStudio((s) => s.workspace!.project.projectType);
  const dna = useStudio((s) => s.workspace!.draftDna) as ProjectDNA;
  const shotIntent = useStudio((s) => s.workspace!.shotIntent);

  const shot = { ...shotIntent, projectType };
  const matrix = effectsCompatibility(dna, shot);
  const entryOf = (id: EffectId) => matrix.find((m) => m.effectId === id)!;
  const current = shotIntent?.effects;
  const primary = current?.primary;
  const secondary = current?.secondary ?? [];
  const active = selectedEffects(current);
  const promptLines = effectsLines(dna, { ...shot, effects: current });

  const write = (effects: ShotEffects | undefined) =>
    setShotIntent({ ...shotIntent, projectType, effects });

  const choiceOf = (id: EffectId): EffectChoice | undefined =>
    primary?.id === id ? primary : secondary.find((c) => c.id === id);

  const togglePrimary = (id: EffectId) => {
    if (primary?.id === id) return write(undefined);
    const chosen: EffectChoice = { id, intensity: choiceOf(id)?.intensity ?? "light" };
    write({
      primary: chosen,
      secondary: secondary.filter((c) => c.id !== id && effectsCompatibleTogether(id, c.id)),
    });
  };
  const toggleSecondary = (id: EffectId) => {
    if (!primary) return;
    const exists = secondary.some((c) => c.id === id);
    write({
      primary,
      secondary: exists
        ? secondary.filter((c) => c.id !== id)
        : [...secondary, { id, intensity: "light" }],
    });
  };
  const setIntensity = (id: EffectId, intensity: EffectIntensity) => {
    if (!primary) return;
    write({
      primary: primary.id === id ? { id, intensity } : primary,
      secondary: secondary.map((c) => (c.id === id ? { id, intensity } : c)),
    });
  };

  /** Why an effect cannot be added as a secondary one (null when it can). */
  const secondaryBlock = (id: EffectId): string | null => {
    if (!primary) return t("effects.secondaryNeedsPrimary");
    if (primary.id === id) return t("effects.alreadyPrimary");
    if (secondary.some((c) => c.id === id)) return null;
    if (entryOf(id).status === "blocked") return t(entryOf(id).reasonKey);
    if (![primary, ...secondary].every((c) => effectsCompatibleTogether(c.id, id)))
      return t("effects.incompatible");
    if (secondary.length >= MAX_SECONDARY_EFFECTS)
      return t("effects.secondaryLimit", { max: MAX_SECONDARY_EFFECTS });
    return null;
  };

  const label = (e: EffectDefinition) => (locale === "vi" ? e.labelVi : e.labelEn);

  return (
    <div className="effects-panel" data-testid="effects-panel">
      <SectionPanel title={t("effects.title")}>
        <p className="field-hint">{t("effects.intro")}</p>
        <ul className="effect-cards">
          {EFFECT_CATALOG.map((effect) => {
            const entry = entryOf(effect.id);
            const choice = choiceOf(effect.id);
            const isPrimary = primary?.id === effect.id;
            const isSecondary = !isPrimary && secondary.some((c) => c.id === effect.id);
            const blocked = entry.status === "blocked";
            const secondaryReason = secondaryBlock(effect.id);
            const intensity = choice?.intensity ?? "light";
            return (
              <li
                key={effect.id}
                className="effect-card"
                data-testid={`effect-${effect.id}`}
                data-status={entry.status}
              >
                <div className="effect-card-head">
                  <span className="effect-card-name">{label(effect)}</span>
                  <span className={`badge ${STATUS_BADGE[entry.status]}`}>
                    {t(`effects.status.${entry.status}`)}
                  </span>
                </div>
                {entry.status !== "available" && (
                  <p
                    className={`field-hint effect-reason effect-reason-${entry.status}`}
                    role={blocked && choice ? "alert" : undefined}
                  >
                    {t(entry.reasonKey)}
                  </p>
                )}
                <div className="effect-card-actions">
                  <button
                    type="button"
                    className="chip"
                    aria-pressed={isPrimary}
                    disabled={readOnly || (blocked && !isPrimary)}
                    onClick={() => togglePrimary(effect.id)}
                  >
                    {t("effects.primary")}
                  </button>
                  <button
                    type="button"
                    className="chip"
                    aria-pressed={isSecondary}
                    disabled={readOnly || (secondaryReason !== null && !isSecondary)}
                    title={secondaryReason ?? undefined}
                    onClick={() => toggleSecondary(effect.id)}
                  >
                    {t("effects.secondary")}
                  </button>
                </div>
                {choice && (
                  <label className="effect-intensity">
                    <span className="field-label">
                      {t("effects.intensity")}: {t(`effects.intensities.${intensity}`)}
                    </span>
                    <input
                      type="range"
                      min="0"
                      max={EFFECT_INTENSITIES.length - 1}
                      step="1"
                      value={EFFECT_INTENSITIES.indexOf(intensity)}
                      disabled={readOnly}
                      aria-valuetext={t(`effects.intensities.${intensity}`)}
                      onChange={(event) =>
                        setIntensity(effect.id, EFFECT_INTENSITIES[Number(event.target.value)]!)
                      }
                    />
                  </label>
                )}
              </li>
            );
          })}
        </ul>
      </SectionPanel>

      <SectionPanel title={t("effects.preview")}>
        {active.length === 0 ? (
          <p className="field-hint">{t("effects.off")}</p>
        ) : (
          <>
            {active.some((c) => entryOf(c.id).status === "blocked") && (
              <div className="callout callout-error" role="alert">
                <span>{t("effects.blockedSelected")}</span>
              </div>
            )}
            {promptLines.length > 0 && (
              <div className="field">
                <span className="field-label">{t("effects.promptLines")}</span>
                <pre className="effects-prompt" data-testid="effects-prompt">
                  {promptLines.join("\n")}
                </pre>
              </div>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={readOnly}
              onClick={() => write(undefined)}
            >
              {t("effects.clear")}
            </button>
          </>
        )}
      </SectionPanel>
    </div>
  );
}
