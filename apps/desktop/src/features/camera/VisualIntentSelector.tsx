import { useState } from "react";
import {
  availableIntents,
  VISUAL_INTENT_PURPOSES,
  type VisualIntent,
  type VisualIntentPurpose,
  type VisualIntentView,
} from "@arch/domain";
import { selectReadOnly, useStudio } from "../../app/store";
import { FieldGroup } from "../../components/panels/fields";
import { useT } from "../../i18n";
import { PremiumIcon, type PremiumIconId } from "../../components/common/PremiumIcon";

type SelectorLevel = "simple" | "custom" | "expert";

const VIEW_ICONS: Record<VisualIntentView, PremiumIconId> = {
  front: "view",
  street_oblique: "wide-view",
  pedestrian: "view",
  overview: "wide-view",
  approach: "view",
  detail: "closeup",
  aerial: "isometric",
};

const VIEW_KEYS: Record<VisualIntentView, string> = {
  front: "front",
  street_oblique: "streetOblique",
  pedestrian: "pedestrian",
  overview: "overview",
  approach: "approach",
  detail: "detail",
  aerial: "aerial",
};

const PURPOSE_KEYS: Record<VisualIntentPurpose, string> = {
  landscape: "landscape",
  portrait: "portrait",
  square: "square",
};

const DEFAULT_INTENT: VisualIntent = { view: "front", purpose: "landscape" };

/** Shot-level visual choices. It writes only to the workspace ShotIntent, never to DNA. */
export function VisualIntentSelector() {
  const workspace = useStudio((s) => s.workspace!);
  const readOnly = useStudio(selectReadOnly);
  const setShotIntent = useStudio((s) => s.setShotIntent);
  const setCenterView = useStudio((s) => s.setCenterView);
  const t = useT();
  const [level, setLevel] = useState<SelectorLevel>("simple");
  const intent = workspace.shotIntent?.visualIntent ?? DEFAULT_INTENT;
  const views = availableIntents(workspace.draftDna);

  const update = (patch: Partial<VisualIntent>) => {
    if (readOnly) return;
    setShotIntent({
      ...(workspace.shotIntent ?? {
        projectType: workspace.project.projectType,
      }),
      projectType: workspace.project.projectType,
      visualIntent: { ...intent, ...patch },
    });
  };

  return (
    <section className="visual-intent" data-testid="visual-intent-selector">
      <div className="visual-intent-head">
        <div>
          <strong>{t("camera.visualIntent.title")}</strong>
          <span className="field-hint">{t("camera.visualIntent.subtitle")}</span>
        </div>
        <div
          className="visual-intent-levels"
          role="tablist"
          aria-label={t("camera.visualIntent.levelsLabel")}
        >
          {(["simple", "custom", "expert"] as const).map((item) => (
            <button
              key={item}
              className="btn btn-ghost btn-sm"
              role="tab"
              aria-selected={level === item}
              data-testid={`visual-intent-level-${item}`}
              onClick={() => {
                setLevel(item);
                if (item === "expert") setCenterView("director");
              }}
            >
              {t(`camera.visualIntent.levels.${item}`)}
            </button>
          ))}
        </div>
      </div>

      {level === "expert" ? (
        <div className="visual-intent-expert">
          <span className="field-hint">{t("camera.visualIntent.expertHint")}</span>
          <button className="btn btn-sm" onClick={() => setCenterView("director")}>
            {t("camera.visualIntent.openDirector")}
          </button>
        </div>
      ) : (
        <>
          <div className="visual-intent-question">{t("camera.visualIntent.viewQuestion")}</div>
          <div className="choice-grid visual-intent-grid">
            {views.map((view) => (
              <button
                key={view}
                className="choice visual-intent-card"
                type="button"
                aria-pressed={intent.view === view}
                disabled={readOnly}
                data-testid="visual-intent-view-card"
                onClick={() => update({ view })}
              >
                <span className="visual-intent-card-art" aria-hidden="true">
                  <PremiumIcon id={VIEW_ICONS[view]} size={27} />
                </span>
                <strong>{t(`camera.visualIntent.views.${VIEW_KEYS[view]}` as never)}</strong>
                <small>{t(`camera.visualIntent.viewHints.${VIEW_KEYS[view]}` as never)}</small>
              </button>
            ))}
          </div>

          <div className="visual-intent-question">{t("camera.visualIntent.purposeQuestion")}</div>
          <div className="choice-grid visual-intent-purpose-grid">
            {VISUAL_INTENT_PURPOSES.map((purpose) => (
              <button
                key={purpose}
                className="choice"
                type="button"
                aria-pressed={intent.purpose === purpose}
                disabled={readOnly}
                data-testid="visual-intent-purpose-card"
                onClick={() => update({ purpose })}
              >
                <strong>
                  {t(`camera.visualIntent.purposes.${PURPOSE_KEYS[purpose]}` as never)}
                </strong>
              </button>
            ))}
          </div>

          {level === "custom" && (
            <div className="visual-intent-sliders">
              <IntentSlider
                label={t("camera.visualIntent.sliders.distance")}
                value={intent.distance}
                disabled={readOnly}
                onChange={(distance) => update({ distance })}
              />
              <IntentSlider
                label={t("camera.visualIntent.sliders.height")}
                value={intent.height}
                disabled={readOnly}
                onChange={(height) => update({ height })}
              />
              <IntentSlider
                label={t("camera.visualIntent.sliders.focus")}
                value={intent.focus}
                disabled={readOnly}
                onChange={(focus) => update({ focus })}
              />
            </div>
          )}
        </>
      )}
    </section>
  );
}

function IntentSlider({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number | undefined;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <FieldGroup label={label} hint={`${value ?? 50}/100`}>
      <input
        className="visual-intent-slider"
        type="range"
        min="0"
        max="100"
        value={value ?? 50}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </FieldGroup>
  );
}
