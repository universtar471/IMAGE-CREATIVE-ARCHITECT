import {
  allowedObjectsForSpace,
  resolveActiveSpace,
  sceneObjectPreset,
  SCENE_OBJECT_PRESETS,
  validateObjectPlacement,
  type SceneObjectRequest,
  type SceneObjectState,
  type SceneObjectType,
} from "@arch/domain";
import { useStudio } from "../../app/store";
import { currentLocale, useT } from "../../i18n";
import { SectionPanel } from "../../components/panels/SectionPanel";
import { NumberField, SelectField, TextField } from "../../components/panels/fields";
import { selectReadOnly } from "../../app/store";

const TYPE_LABELS: Record<SceneObjectType, { en: string; vi: string }> = {
  person: { en: "People", vi: "Người" },
  car: { en: "Cars", vi: "Ô tô" },
  motorbike: { en: "Motorbikes", vi: "Xe máy" },
  bicycle: { en: "Bicycles", vi: "Xe đạp" },
  plant: { en: "Plants", vi: "Cây" },
  pet: { en: "Pets", vi: "Thú cưng" },
};

/** Shot-level object picker. It never edits ProjectDNA; choices live in the workspace snapshot. */
export function SceneObjectsPanel() {
  const ws = useStudio((s) => s.workspace!);
  const setShotIntent = useStudio((s) => s.setShotIntent);
  const readOnly = useStudio(selectReadOnly);
  const t = useT();
  const spaces = ws.draftDna.spaceCatalog?.spaces ?? [];
  const selected = ws.shotIntent?.sceneObjects?.[0];
  const targetSpaceId =
    selected?.targetSpaceId ??
    ws.shotIntent?.targetSpaceId ??
    ws.draftDna.spaceCatalog?.activeSpaceId;
  const active = targetSpaceId ? resolveActiveSpace(ws.draftDna, { targetSpaceId }) : null;
  const allowed = active ? allowedObjectsForSpace(active.preset, active.space) : null;
  const locale = currentLocale();
  const allowedTypes = allowed?.allowed ?? [];
  const category = selected ? sceneObjectPreset(selected.presetId)?.type : allowedTypes[0];
  const presets = SCENE_OBJECT_PRESETS.filter((preset) => allowedTypes.includes(preset.type));
  const request =
    selected ??
    (presets[0]
      ? {
          presetId: presets[0].id,
          quantity: 1,
          targetSpaceId: targetSpaceId ?? "",
          state: "static" as const,
          sourceReferenceIds: [],
        }
      : undefined);
  const update = (patch: Partial<SceneObjectRequest>) => {
    if (!request) return;
    const next = { ...request, ...patch };
    setShotIntent({
      projectType: ws.project.projectType,
      targetSpaceId: next.targetSpaceId,
      sceneObjects: [next],
    });
  };
  const issues = request
    ? validateObjectPlacement(ws.draftDna, {
        targetSpaceId: request.targetSpaceId,
        sceneObjects: [request],
      })
    : [];
  const label = (preset: (typeof SCENE_OBJECT_PRESETS)[number]) =>
    locale === "en" ? preset.labelEn : preset.labelVi;

  return (
    <div className="scene-objects-panel">
      <SectionPanel title={t("sceneObjects.targetSpace")}>
        {spaces.length === 0 ? (
          <span className="field-hint">{t("sceneObjects.noSpaces")}</span>
        ) : (
          <SelectField
            label={t("sceneObjects.targetSpace")}
            value={targetSpaceId}
            disabled={readOnly}
            options={spaces.map((space) => ({
              value: space.id,
              label: space.label ?? space.presetId,
            }))}
            onChange={(value) => value && update({ targetSpaceId: value })}
          />
        )}
        {allowed && (
          <span className="field-hint">
            {locale === "en" ? allowed.reasonEn : allowed.reasonVi}
          </span>
        )}
      </SectionPanel>
      {request && allowed && (
        <SectionPanel title={t("sceneObjects.section")}>
          <SelectField
            label={t("sceneObjects.category")}
            value={category}
            disabled={readOnly}
            options={allowedTypes.map((type) => ({
              value: type,
              label: locale === "en" ? TYPE_LABELS[type].en : TYPE_LABELS[type].vi,
            }))}
            onChange={(type) => {
              const first = presets.find((preset) => preset.type === type);
              if (first) update({ presetId: first.id });
            }}
          />
          <SelectField
            label={t("sceneObjects.preset")}
            value={request.presetId}
            disabled={readOnly}
            options={presets
              .filter((preset) => preset.type === category)
              .map((preset) => ({ value: preset.id, label: label(preset) }))}
            onChange={(presetId) => presetId && update({ presetId })}
          />
          <NumberField
            label={t("sceneObjects.quantity")}
            value={request.quantity}
            disabled={readOnly}
            onChange={(quantity) =>
              quantity && update({ quantity: Math.max(1, Math.round(quantity)) })
            }
          />
          <TextField
            label={t("sceneObjects.zone")}
            value={request.placementZoneId}
            disabled={readOnly}
            placeholder={t("sceneObjects.zonePlaceholder")}
            onChange={(placementZoneId) => update({ placementZoneId })}
          />
          <SelectField<SceneObjectState>
            label={t("sceneObjects.state")}
            value={request.state}
            disabled={readOnly}
            allowEmpty={false}
            options={[
              { value: "static", label: t("sceneObjects.static") },
              { value: "moving", label: t("sceneObjects.moving") },
            ]}
            onChange={(state) => state && update({ state })}
          />
          {sceneObjectPreset(request.presetId)?.trademarkWarning && (
            <div className="callout callout-warning">
              {sceneObjectPreset(request.presetId)?.trademarkWarning}
            </div>
          )}
          {issues.map((issue) => (
            <div
              className={`callout ${issue.severity === "BLOCK" ? "callout-error" : "callout-warning"}`}
              key={`${issue.code}-${issue.path}`}
            >
              {t(`conflicts.${issue.code}`)}
            </div>
          ))}
          <button
            type="button"
            className="btn btn-ghost"
            disabled={readOnly}
            onClick={() => setShotIntent(undefined)}
          >
            {t("sceneObjects.clear")}
          </button>
        </SectionPanel>
      )}
    </div>
  );
}
