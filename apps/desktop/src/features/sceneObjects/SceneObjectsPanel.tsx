/**
 * Scene objects (ADR-036 P2d, SRS §7.1): target space → allowed category → preset → quantity
 * → placement → static / moving → preview with warnings.
 *
 * Choices are per shot: they go into the open project's ShotIntent in the workspace store,
 * never into the DNA. Impossible options are disabled with their reason, and every submit
 * still goes through the conflict gate (`validateShot` runs the same placement rules).
 */
import { useState } from "react";
import {
  OBJECT_COLOR_IDS,
  SCENE_OBJECT_VISIBILITIES,
  SITE_FRONTAGE_TARGET,
  SPACE_CATALOG,
  allowedObjectsForKind,
  isVehicleType,
  placementZoneStatus,
  presetsOfType,
  resolveSceneTarget,
  sceneObjectPreset,
  sceneObjectsLines,
  stateAllowed,
  validateObjectPlacement,
  type ObjectColorId,
  type ObjectPlacementIssue,
  type PlacementZoneId,
  type ProjectDNA,
  type SceneObjectPreset,
  type SceneObjectRequest,
  type SceneObjectState,
  type SceneObjectType,
  type SceneObjectVisibility,
  type ZoneStatus,
} from "@arch/domain";
import { selectReadOnly, useStudio } from "../../app/store";
import { SectionPanel } from "../../components/panels/SectionPanel";
import { NumberField, SelectField } from "../../components/panels/fields";
import { useLocale, useT } from "../../i18n";

const MAX_QUANTITY = 20;

type Draft = {
  type?: SceneObjectType;
  presetId?: string;
  quantity: number;
  zone?: PlacementZoneId;
  state: SceneObjectState;
  color?: ObjectColorId;
  visibility?: SceneObjectVisibility;
};

const EMPTY_DRAFT: Draft = { quantity: 1, state: "static" };

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function SceneObjectsPanel() {
  const t = useT();
  const locale = useLocale((s) => s.locale);
  const readOnly = useStudio(selectReadOnly);
  const setShotIntent = useStudio((s) => s.setShotIntent);
  const project = useStudio((s) => s.workspace!.project);
  const dna = useStudio((s) => s.workspace!.draftDna) as ProjectDNA;
  const shotIntent = useStudio((s) => s.workspace!.shotIntent);
  const projectType = project.projectType;
  const requests = shotIntent?.sceneObjects ?? [];

  // ---- 1. target space: the catalog spaces, plus the street frontage of an exterior shot
  const spaces = dna.spaceCatalog?.spaces ?? [];
  const targets = [
    ...spaces.map((space) => {
      const preset = SPACE_CATALOG.preset(space.presetId);
      const presetLabel = preset
        ? locale === "vi"
          ? preset.labelVi
          : capitalize(preset.labelEn)
        : null;
      return { value: space.id, label: space.label ?? presetLabel ?? space.presetId };
    }),
    ...(projectType === "interior"
      ? []
      : [{ value: SITE_FRONTAGE_TARGET, label: t("sceneObjects.frontage") }]),
  ];
  const [chosenTarget, setChosenTarget] = useState<string | undefined>();
  const targetId =
    chosenTarget && targets.some((o) => o.value === chosenTarget)
      ? chosenTarget
      : (targets.find((o) => o.value === dna.spaceCatalog?.activeSpaceId)?.value ??
        targets[0]?.value);
  const target = targetId ? resolveSceneTarget(dna, projectType, targetId) : null;

  // ---- 2–6. the request being composed
  const [draft, setDraftState] = useState<Draft>(EMPTY_DRAFT);
  const setDraft = (patch: Partial<Draft>) => setDraftState((d) => ({ ...d, ...patch }));
  const rules = target ? allowedObjectsForKind(target.kind) : [];
  const typeRule = rules.find((r) => r.type === draft.type && r.allowed);
  const type = typeRule?.type;
  const presets = type ? presetsOfType(type) : [];
  const preset = presets.find((p) => p.id === draft.presetId) ?? presets[0];

  const zoneOptions = (typeRule?.zones ?? []).map((zone) => ({
    zone,
    status: (target && type && isVehicleType(type)
      ? placementZoneStatus(dna, projectType, target, zone)
      : null) as ZoneStatus | null,
  }));
  const usable = zoneOptions.filter((o) => o.status !== "absent");
  const zone =
    zoneOptions.find((o) => o.zone === draft.zone && o.status !== "absent")?.zone ??
    usable[0]?.zone ??
    zoneOptions[0]?.zone;
  const movingAllowed = !!type && !!zone && stateAllowed(type, zone, "moving");
  const state: SceneObjectState = movingAllowed ? draft.state : "static";

  const candidate: SceneObjectRequest | null =
    target && preset && zone
      ? {
          presetId: preset.id,
          quantity: Math.min(MAX_QUANTITY, Math.max(1, Math.round(draft.quantity || 1))),
          targetSpaceId: target.id,
          placementZoneId: zone,
          state,
          ...(draft.color && preset.colorable
            ? { appearanceOverrides: { color: draft.color } }
            : {}),
          ...(draft.visibility ? { visibility: draft.visibility } : {}),
          sourceReferenceIds: [],
        }
      : null;
  // The candidate is checked together with what is already added (shared garage bays).
  const candidateIssues = candidate
    ? validateObjectPlacement(dna, {
        projectType,
        sceneObjects: [...requests, candidate],
      }).filter((i) => i.path.startsWith(`sceneObjects[${requests.length}]`))
    : [];
  const candidateBlocked = candidateIssues.some((i) => i.severity === "BLOCK");

  const write = (sceneObjects: SceneObjectRequest[]) =>
    setShotIntent(
      sceneObjects.length || shotIntent?.targetSpaceId || shotIntent?.targetDetailId
        ? { ...shotIntent, projectType, sceneObjects }
        : undefined,
    );
  const add = () => {
    if (!candidate || candidateBlocked) return;
    write([...requests, candidate]);
    setDraftState(EMPTY_DRAFT);
  };

  // ---- 7. preview of what is in the shot
  const issues = validateObjectPlacement(dna, { projectType, sceneObjects: requests });
  const issuesOf = (index: number) =>
    issues.filter(
      (i) => i.path === `sceneObjects[${index}]` || i.path.startsWith(`sceneObjects[${index}].`),
    );
  const promptLines = sceneObjectsLines(dna, projectType, requests);

  const presetLabel = (p: SceneObjectPreset) => {
    const label = locale === "vi" ? p.labelVi : p.labelEn;
    return p.simulatedModel ? `${label} (${t("sceneObjects.simulated")})` : label;
  };
  const targetLabel = (id: string) => targets.find((o) => o.value === id)?.label ?? id;
  const zoneLabel = (z: PlacementZoneId, status: ZoneStatus | null) =>
    status
      ? `${t(`sceneObjects.zones.${z}`)} · ${t(`sceneObjects.zoneStatus.${status}`)}`
      : t(`sceneObjects.zones.${z}`);
  const issueText = (issue: ObjectPlacementIssue) => {
    const reason = String(issue.params.reason ?? "");
    const known = [
      "type_not_allowed",
      "unknown_preset",
      "unknown_target",
      "zone_not_in_space",
      "zone_absent",
      "zone_unverified",
      "moving_outside_road",
      "too_small",
    ] as const;
    const key = known.find((k) => k === reason);
    return key
      ? t(`sceneObjects.reasons.${key}`, { capacity: issue.params.capacity ?? 0 })
      : t(`conflicts.${issue.code}`);
  };
  const renderIssues = (list: readonly ObjectPlacementIssue[]) =>
    list.map((issue) => (
      <div
        key={`${issue.code}|${issue.path}|${String(issue.params.reason)}`}
        className={`callout ${issue.severity === "BLOCK" ? "callout-error" : "callout-warning"}`}
        role={issue.severity === "BLOCK" ? "alert" : "status"}
      >
        <span>
          {issueText(issue)}{" "}
          {issue.severity === "BLOCK" ? t("sceneObjects.blockHint") : t("sceneObjects.warnHint")}
        </span>
      </div>
    ));

  return (
    <div className="scene-objects-panel" data-testid="scene-objects-panel">
      <SectionPanel title={t("sceneObjects.title")}>
        <p className="field-hint">{t("sceneObjects.intro")}</p>
        {targets.length === 0 ? (
          <p className="field-hint">{t("sceneObjects.noTargets")}</p>
        ) : (
          <SelectField
            label={t("sceneObjects.targetSpace")}
            value={targetId}
            allowEmpty={false}
            disabled={readOnly}
            options={targets}
            onChange={(value) => {
              setChosenTarget(value);
              setDraftState(EMPTY_DRAFT);
            }}
          />
        )}
        {target && (
          <>
            <p className="field-hint" data-testid="scene-objects-rule">
              {t(`sceneObjects.kindRules.${target.kind}`)}
            </p>
            <div className="field" role="group" aria-label={t("sceneObjects.category")}>
              <span className="field-label">{t("sceneObjects.category")}</span>
              <div className="scene-object-chips">
                {rules.map((rule) => (
                  <button
                    key={rule.type}
                    type="button"
                    className="chip"
                    aria-pressed={type === rule.type}
                    disabled={readOnly || !rule.allowed}
                    title={rule.allowed ? undefined : t(`sceneObjects.kindRules.${target.kind}`)}
                    onClick={() =>
                      setDraft({ type: rule.type, presetId: undefined, zone: undefined })
                    }
                  >
                    {t(`sceneObjects.types.${rule.type}`)}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
        {type && preset && (
          <>
            <SelectField
              label={t("sceneObjects.preset")}
              value={preset.id}
              allowEmpty={false}
              disabled={readOnly}
              options={presets.map((p) => ({ value: p.id, label: presetLabel(p) }))}
              onChange={(presetId) => setDraft({ presetId })}
            />
            {preset.trademarkWarning && (
              <div className="callout callout-warning" data-testid="scene-object-trademark">
                <span>{t("sceneObjects.trademark")}</span>
              </div>
            )}
            <NumberField
              label={t("sceneObjects.quantity")}
              value={draft.quantity}
              disabled={readOnly}
              onChange={(quantity) =>
                quantity !== undefined &&
                Number.isFinite(quantity) &&
                setDraft({ quantity: Math.min(MAX_QUANTITY, Math.max(1, Math.round(quantity))) })
              }
            />
            <SelectField<PlacementZoneId>
              label={t("sceneObjects.zone")}
              value={zone}
              allowEmpty={false}
              disabled={readOnly}
              hint={
                zoneOptions.some((o) => o.status === "absent")
                  ? t("sceneObjects.zoneAbsentHint")
                  : undefined
              }
              options={zoneOptions.map((o) => ({
                value: o.zone,
                label: zoneLabel(o.zone, o.status),
                disabled: o.status === "absent",
              }))}
              onChange={(value) => setDraft({ zone: value })}
            />
            <SelectField<SceneObjectState>
              label={t("sceneObjects.state")}
              value={state}
              allowEmpty={false}
              disabled={readOnly}
              hint={
                movingAllowed
                  ? undefined
                  : type === "plant"
                    ? t("sceneObjects.movingPlant")
                    : t("sceneObjects.movingVehicle")
              }
              options={[
                { value: "static", label: t("sceneObjects.states.static") },
                {
                  value: "moving",
                  label: t("sceneObjects.states.moving"),
                  disabled: !movingAllowed,
                },
              ]}
              onChange={(value) => value && setDraft({ state: value })}
            />
            {preset.colorable && (
              <SelectField<ObjectColorId>
                label={t("sceneObjects.color")}
                value={draft.color}
                disabled={readOnly}
                options={OBJECT_COLOR_IDS.map((id) => ({
                  value: id,
                  label: t(`sceneObjects.colors.${id}`),
                }))}
                onChange={(color) => setDraft({ color })}
              />
            )}
            <SelectField<SceneObjectVisibility>
              label={t("sceneObjects.visibility")}
              value={draft.visibility}
              disabled={readOnly}
              options={SCENE_OBJECT_VISIBILITIES.map((id) => ({
                value: id,
                label: t(`sceneObjects.visibilities.${id}`),
              }))}
              onChange={(visibility) => setDraft({ visibility })}
            />
            {renderIssues(candidateIssues)}
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={readOnly || !candidate || candidateBlocked}
              onClick={add}
            >
              {t("sceneObjects.add")}
            </button>
          </>
        )}
      </SectionPanel>

      <SectionPanel title={t("sceneObjects.preview")}>
        {requests.length === 0 ? (
          <p className="field-hint">{t("sceneObjects.empty")}</p>
        ) : (
          <>
            <span className="field-label">{t("sceneObjects.added")}</span>
            <ul className="scene-object-list" data-testid="scene-object-list">
              {requests.map((request, index) => {
                const p = sceneObjectPreset(request.presetId);
                const own = issuesOf(index);
                return (
                  <li key={`${index}|${request.presetId}`} className="scene-object-item">
                    <div className="scene-object-row">
                      <span>
                        {request.quantity} × {p ? presetLabel(p) : request.presetId}
                        {" · "}
                        {targetLabel(request.targetSpaceId)}
                        {request.placementZoneId
                          ? ` · ${t(`sceneObjects.zones.${request.placementZoneId}`)}`
                          : ""}
                        {` · ${t(`sceneObjects.states.${request.state}`)}`}
                      </span>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={readOnly}
                        onClick={() => write(requests.filter((_, i) => i !== index))}
                      >
                        {t("sceneObjects.remove")}
                      </button>
                    </div>
                    {renderIssues(own)}
                    {own.some((i) => i.severity === "BLOCK") && (
                      <p className="field-hint">{t("sceneObjects.notCompiled")}</p>
                    )}
                  </li>
                );
              })}
            </ul>
            {promptLines.length > 0 && (
              <div className="field">
                <span className="field-label">{t("sceneObjects.promptLines")}</span>
                <pre className="scene-object-prompt" data-testid="scene-object-prompt">
                  {promptLines.join("\n")}
                </pre>
              </div>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={readOnly}
              onClick={() => write([])}
            >
              {t("sceneObjects.clear")}
            </button>
          </>
        )}
      </SectionPanel>
    </div>
  );
}
