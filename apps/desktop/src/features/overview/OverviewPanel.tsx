import { useState } from "react";
import { CheckCircle2, Circle, FileText, ShieldCheck, Star } from "lucide-react";
import {
  AssetRoleSchema,
  DensitySchema,
  TIME_OF_DAY_VALUES,
  dnaReadiness,
  type AssetRole,
  type ProjectDTO,
} from "@arch/domain";
import { attempt, selectReadOnly, useStudio, type WorkspaceData } from "../../app/store";
import { StatusBadge } from "../../components/common/StatusBadge";
import { SectionPanel } from "../../components/panels/SectionPanel";
import { NumberField, SelectField, TextField } from "../../components/panels/fields";
import { call } from "../../lib/bridge";
import { knowledge } from "../../lib/knowledge";
import { formatDateTime } from "../../lib/format";
import { MasterDnaCheck } from "../generate/MasterDnaCheck";
import { useT } from "../../i18n";
import { readinessLabel } from "../../i18n/domain";
import { packLabel } from "../../i18n/knowledge";
import type { DnaStepId, DerivedWorkflowStep } from "../../lib/workflow";

export function OverviewPanel() {
  const project = useStudio((s) => s.workspace!.project);
  const dna = useStudio((s) => s.workspace!.persistedDna);
  const assets = useStudio((s) => s.workspace!.assets);
  const setModule = useStudio((s) => s.setModule);
  const setCenterView = useStudio((s) => s.setCenterView);
  const readOnly = useStudio(selectReadOnly);
  const adoptProject = useStudio((s) => s.adoptProject);
  const refreshWorkflow = useStudio((s) => s.refreshWorkflow);
  const master = assets.find((a) => a.id === project.activeMasterAssetId) ?? null;
  const readiness = dnaReadiness(dna, project.projectType);
  const { pack, match } = knowledge.resolve(project.projectType, project.subtype);
  const t = useT();

  const approve = async (approved: boolean) => {
    const p = await attempt(() =>
      call("project_approve_master", { projectId: project.id, approved }),
    );
    if (p) {
      adoptProject(p);
      void refreshWorkflow();
    }
  };

  return (
    <>
      <SectionPanel title={t("overview.project")}>
        <ProjectNameField
          key={project.id + project.updatedAt}
          project={project}
          disabled={readOnly}
        />
        <dl className="kv">
          <dt>{t("overview.type")}</dt>
          <dd>{t(`labels.projectType.${project.projectType}`)}</dd>
          <dt>{t("overview.subtype")}</dt>
          <dd>{pack && match === "exact" ? packLabel(pack) : (project.subtype ?? "—")}</dd>
          <dt>{t("overview.status")}</dt>
          <dd>
            <StatusBadge status={project.status} />
          </dd>
          <dt>{t("overview.pack")}</dt>
          <dd>
            {pack
              ? `${packLabel(pack)} v${pack.packVersion}${match === "custom_fallback" ? ` ${t("overview.genericFallback")}` : ""}`
              : t("common.none")}
          </dd>
          <dt>{t("overview.created")}</dt>
          <dd>{formatDateTime(project.createdAt)}</dd>
          <dt>{t("overview.updated")}</dt>
          <dd>{formatDateTime(project.updatedAt)}</dd>
        </dl>
      </SectionPanel>

      <SectionPanel title={t("overview.readiness")}>
        <ul className="checklist">
          {readiness.map((r) => (
            <li key={r.key}>
              {r.done ? (
                <CheckCircle2 size={14} className="ok" />
              ) : (
                <Circle size={14} className="todo" />
              )}
              {readinessLabel(r, t)}
            </li>
          ))}
        </ul>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn btn-sm" onClick={() => setModule("design_dna")}>
            {t("overview.editDna")}
          </button>
          <button className="btn btn-sm" onClick={() => setModule("context")}>
            {t("overview.editContext")}
          </button>
        </div>
      </SectionPanel>

      <WorkflowOverview />

      <SectionPanel title={t("overview.masterImage")}>
        {master ? (
          <>
            <span>
              <Star size={13} style={{ verticalAlign: -2 }} /> {master.originalName}
            </span>
            {project.status === "master_approved" ? (
              <button
                className="btn btn-sm"
                onClick={() => void approve(false)}
                disabled={readOnly}
              >
                {t("overview.withdraw")}
              </button>
            ) : (
              <button
                className="btn btn-sm btn-primary"
                onClick={() => void approve(true)}
                disabled={readOnly}
              >
                <ShieldCheck size={14} /> {t("overview.approve")}
              </button>
            )}
            <MasterDnaCheck />
          </>
        ) : (
          <>
            <span className="field-hint">{t("overview.noMaster")}</span>
            <button className="btn btn-sm" onClick={() => setModule("references")}>
              {t("overview.chooseInReferences")}
            </button>
          </>
        )}
      </SectionPanel>

      <SectionPanel title={t("overview.prompt")}>
        <button className="btn btn-sm" onClick={() => setCenterView("prompt")}>
          <FileText size={14} /> {t("overview.openPrompt")}
        </button>
        <span className="field-hint">{t("overview.promptHint")}</span>
        <span className="field-hint">{t("prompt.englishNote")}</span>
      </SectionPanel>
    </>
  );
}

function WorkflowOverview() {
  const workflow = useStudio((s) => s.workflowView);
  const ws = useStudio((s) => s.workspace!);
  const setModule = useStudio((s) => s.setModule);
  const confirm = useStudio((s) => s.confirmWorkflowStep);
  const reopen = useStudio((s) => s.reopenWorkflowStep);
  const t = useT();
  const stages = ["dna", "generate", "post"] as const;
  if (!workflow) return null;
  return (
    <SectionPanel title={t("workflow.overviewTitle")}>
      {stages.map((stage) => (
        <div className="workflow-overview-stage" key={stage}>
          <h3>{t(`workflow.stage.${stage}`)}</h3>
          {workflow.steps
            .filter((step) => step.stage === stage)
            .map((step) => {
              const summary = workflowSummary(step.id, ws, t);
              return (
                <details className="workflow-overview-row" key={step.id}>
                  <summary>
                    <span className="workflow-overview-name">
                      <span className={`badge workflow-status-${step.status}`}>
                        {t(`workflow.status.${step.status}`)}
                      </span>
                      {t(`workflow.steps.${step.id}.name`)}
                    </span>
                    <span className="field-hint">{summary}</span>
                  </summary>
                  <div className="workflow-overview-actions">
                    <button
                      className="btn btn-sm"
                      onClick={() => setModule(step.moduleId as Parameters<typeof setModule>[0])}
                    >
                      {t("workflow.open")}
                    </button>
                    {step.status === "available" && step.id.startsWith("dna.") && (
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => void confirm(step.id as DnaStepId)}
                      >
                        {t("workflow.confirm")}
                      </button>
                    )}
                    {(step.status === "confirmed" || step.status === "needs_review") &&
                      step.id.startsWith("dna.") && (
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() => void reopen(step.id as DnaStepId)}
                        >
                          {t("workflow.reopen")}
                        </button>
                      )}
                  </div>
                  {step.stage === "dna" && <WorkflowQuickEdit step={step} ws={ws} />}
                </details>
              );
            })}
        </div>
      ))}
    </SectionPanel>
  );
}

function workflowSummary(stepId: string, ws: WorkspaceData, t: ReturnType<typeof useT>) {
  const none = t("common.none");
  const values = (...items: Array<string | number | undefined | null>) =>
    items
      .filter((item): item is string | number => item !== undefined && item !== null && item !== "")
      .join(" · ") || none;
  if (stepId === "dna.camera") {
    return t("workflow.cameraSummary", {
      cameras: ws.draftDna.cameras.length,
      anchors: ws.draftDna.cameras.filter((camera) => camera.isAnchorView).length,
    });
  }
  if (stepId === "dna.building") {
    const building = ws.draftDna.building;
    return values(
      building.buildingType,
      building.architecturalStyle,
      building.floors && `${building.floors} ${t("dna.floors").toLowerCase()}`,
    );
  }
  if (stepId === "dna.context") {
    const context = ws.draftDna.context;
    return values(context.macroContext, context.climateContext, context.density);
  }
  if (stepId === "dna.references") {
    return values(
      `${ws.assets.length} ${t("tray.assets").toLowerCase()}`,
      ws.project.activeMasterAssetId ? t("workflow.masterApproved") : t("workflow.masterMissing"),
    );
  }
  if (stepId === "generate.master") {
    return ws.project.activeMasterAssetId
      ? t("workflow.masterApproved")
      : t("workflow.masterMissing");
  }
  if (stepId === "dna.lighting") {
    const lighting = (ws.draftDna.lighting ?? {}) as {
      timeOfDay?: string;
      artificialLighting?: unknown[];
    };
    const weather = (ws.draftDna.weather ?? {}) as { preset?: string; sky?: string };
    const time = lighting.timeOfDay
      ? t(`lighting.timeOptions.${lighting.timeOfDay}` as never)
      : none;
    return values(
      time,
      `${lighting.artificialLighting?.length ?? 0} ${t("workflow.lights")}`,
      weather.preset ?? weather.sky,
    );
  }
  if (stepId === "generate.anchors") {
    const anchorIds = ws.draftDna.cameras
      .filter((camera) => camera.isAnchorView)
      .map((camera) => camera.id);
    const approved = ws.anchors.filter((anchor) => anchorIds.includes(anchor.cameraId)).length;
    return anchorIds.length === 0
      ? t("workflow.status.skipped")
      : values(`${approved}/${anchorIds.length}`, t("workflow.steps.generate.anchors.name"));
  }
  if (stepId === "generate.render") {
    return values(ws.draftDna.cameras.length, t("camera.cameras").toLowerCase());
  }
  if (stepId === "post.grade") {
    return (
      ws.draftDna.mood?.preset ??
      (ws.draftDna.colorGrade ? t("workflow.gradeApplied") : t("workflow.reviewValues"))
    );
  }
  return t("workflow.reviewValues");
}

function WorkflowQuickEdit({ step, ws }: { step: DerivedWorkflowStep; ws: WorkspaceData }) {
  const t = useT();
  const editDna = useStudio((s) => s.editDna);
  const selectedAssetId = useStudio((s) => s.selectedAssetId);
  const selectAsset = useStudio((s) => s.selectAsset);
  const selectedCameraId = useStudio((s) => s.selectedCameraId);
  const selectCamera = useStudio((s) => s.selectCamera);
  const adoptAssets = useStudio((s) => s.adoptAssets);
  const editable = step.status === "available" && !ws.project.archivedAt;

  if (step.id === "dna.building") {
    const disabled = !editable || ws.draftDna.locks.building;
    return (
      <fieldset className="workflow-quick-edit" disabled={!editable}>
        <TextField
          label={t("dna.buildingType")}
          value={ws.draftDna.building.buildingType}
          disabled={disabled}
          onChange={(value) => editDna("building.buildingType", value ?? "")}
        />
        <TextField
          label={t("dna.style")}
          value={ws.draftDna.building.architecturalStyle}
          disabled={disabled}
          onChange={(value) => editDna("building.architecturalStyle", value)}
        />
        <NumberField
          label={t("dna.floors")}
          value={ws.draftDna.building.floors}
          step={1}
          disabled={disabled}
          onChange={(value) => editDna("building.floors", value)}
        />
      </fieldset>
    );
  }

  if (step.id === "dna.context") {
    const disabled = !editable || ws.draftDna.locks.context;
    return (
      <fieldset className="workflow-quick-edit" disabled={!editable}>
        <TextField
          label={t("context.macro")}
          value={ws.draftDna.context.macroContext}
          disabled={disabled}
          onChange={(value) => editDna("context.macroContext", value)}
        />
        <TextField
          label={t("context.climate")}
          value={ws.draftDna.context.climateContext}
          disabled={disabled}
          onChange={(value) => editDna("context.climateContext", value)}
        />
        <SelectField
          label={t("context.density")}
          value={ws.draftDna.context.density}
          disabled={disabled}
          options={DensitySchema.options.map((density) => ({
            value: density,
            label: t(`labels.density.${density}`),
          }))}
          onChange={(value) => editDna("context.density", value)}
        />
      </fieldset>
    );
  }

  if (step.id === "dna.references") {
    const selected = ws.assets.find((asset) => asset.id === selectedAssetId) ?? ws.assets[0];
    const setRole = async (role: AssetRole | undefined) => {
      if (!role || !selected || role === selected.role) return;
      const assets = await attempt(() =>
        call("asset_update_role", { projectId: ws.project.id, assetId: selected.id, role }),
      );
      if (assets) await adoptAssets(ws.project.id, assets);
    };
    return (
      <fieldset className="workflow-quick-edit" disabled={!editable}>
        <SelectField
          label={t("workspace.selectedAsset")}
          value={selected?.id}
          allowEmpty={false}
          disabled={!editable}
          options={ws.assets.map((asset) => ({
            value: asset.id,
            label: asset.originalName ?? asset.id,
          }))}
          onChange={(value) => selectAsset(value ?? null)}
        />
        {selected && (
          <SelectField
            label={t("assets.assetRole")}
            value={selected.role}
            allowEmpty={false}
            disabled={!editable}
            options={AssetRoleSchema.options.map((role) => ({
              value: role,
              label: t(`labels.assetRole.${role}`),
            }))}
            onChange={(role) => void setRole(role)}
          />
        )}
      </fieldset>
    );
  }

  if (step.id === "dna.camera") {
    const selected =
      ws.draftDna.cameras.find((camera) => camera.id === selectedCameraId) ??
      ws.draftDna.cameras[0];
    if (!selected)
      return (
        <span className="field-hint">
          {t("camera.noCameras", {
            type: t(`labels.projectType.${ws.project.projectType}`).toLowerCase(),
          })}
        </span>
      );
    const index = ws.draftDna.cameras.findIndex((camera) => camera.id === selected.id);
    const disabled = !editable || ws.draftDna.locks.camera;
    return (
      <fieldset className="workflow-quick-edit" disabled={!editable}>
        <SelectField
          label={t("camera.cameras")}
          value={selected.id}
          allowEmpty={false}
          disabled={disabled}
          options={ws.draftDna.cameras.map((camera) => ({ value: camera.id, label: camera.name }))}
          onChange={(value) => selectCamera(value ?? null)}
        />
        <TextField
          label={t("camera.name")}
          value={selected.name}
          disabled={disabled}
          onChange={(value) => editDna(`cameras.${index}.name`, value ?? "")}
        />
        <NumberField
          label={t("camera.lens")}
          value={selected.lensMm}
          hint={t("camera.lensHint")}
          disabled={disabled}
          onChange={(value) => editDna(`cameras.${index}.lensMm`, value)}
        />
        <label className="check-row">
          <input
            type="checkbox"
            checked={selected.isAnchorView}
            disabled={disabled}
            onChange={(event) => editDna(`cameras.${index}.isAnchorView`, event.target.checked)}
          />
          {t("camera.anchorViewCheck")}
        </label>
      </fieldset>
    );
  }

  if (step.id === "dna.lighting") {
    const lighting = ws.draftDna.lighting ?? { schemaVersion: 1, artificialLighting: [] };
    const weather = ws.draftDna.weather ?? { schemaVersion: 1, notes: "" };
    return (
      <fieldset className="workflow-quick-edit" disabled={!editable}>
        <SelectField
          label={t("lighting.timeOfDay")}
          value={lighting.timeOfDay}
          disabled={!editable || ws.draftDna.locks.lighting}
          options={TIME_OF_DAY_VALUES.map((time) => ({
            value: time,
            label: t(`lighting.timeOptions.${time}` as never),
          }))}
          onChange={(value) => editDna("lighting.timeOfDay", value)}
        />
        <TextField
          label={t("lighting.sky")}
          value={weather.sky}
          disabled={!editable || ws.draftDna.locks.weather}
          onChange={(value) => editDna("weather.sky", value)}
        />
        <TextField
          label={t("lighting.humidity")}
          value={weather.humidity}
          disabled={!editable || ws.draftDna.locks.weather}
          onChange={(value) => editDna("weather.humidity", value)}
        />
      </fieldset>
    );
  }

  return null;
}

function ProjectNameField({ project, disabled }: { project: ProjectDTO; disabled: boolean }) {
  const [name, setName] = useState(project.name);
  const [error, setError] = useState<string | undefined>();
  const adoptProject = useStudio((s) => s.adoptProject);
  const t = useT();

  const commit = async () => {
    const trimmed = name.trim();
    if (trimmed === project.name) return;
    if (!trimmed) {
      setError(t("overview.nameEmpty"));
      return;
    }
    const p = await attempt(() =>
      call("project_update_metadata", { projectId: project.id, name: trimmed }),
    );
    if (p) {
      setError(undefined);
      adoptProject(p);
    }
  };

  return (
    <div onBlur={() => void commit()} onKeyDown={(e) => e.key === "Enter" && void commit()}>
      <TextField
        label={t("overview.name")}
        value={name}
        error={error}
        disabled={disabled}
        onChange={(v) => setName(v ?? "")}
      />
    </div>
  );
}
