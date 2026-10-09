import { useState } from "react";
import { CheckCircle2, Circle, FileText, ShieldCheck, Star } from "lucide-react";
import { dnaReadiness, type ProjectDTO } from "@arch/domain";
import { attempt, selectReadOnly, useStudio, type WorkspaceData } from "../../app/store";
import { StatusBadge } from "../../components/common/StatusBadge";
import { SectionPanel } from "../../components/panels/SectionPanel";
import { TextField } from "../../components/panels/fields";
import { call } from "../../lib/bridge";
import { knowledge } from "../../lib/knowledge";
import { formatDateTime } from "../../lib/format";
import { useT } from "../../i18n";
import { readinessLabel } from "../../i18n/domain";
import { packLabel } from "../../i18n/knowledge";
import type { DnaStepId } from "../../lib/workflow";

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
                </details>
              );
            })}
        </div>
      ))}
    </SectionPanel>
  );
}

function workflowSummary(stepId: string, ws: WorkspaceData, t: ReturnType<typeof useT>) {
  if (stepId === "dna.camera") {
    const anchors = ws.anchors.filter((anchor) =>
      ws.draftDna.cameras.some((camera) => camera.id === anchor.cameraId),
    );
    return t("workflow.cameraSummary", {
      cameras: ws.draftDna.cameras.length,
      anchors: anchors.length,
    });
  }
  if (stepId === "generate.master") {
    return ws.project.activeMasterAssetId
      ? t("workflow.masterApproved")
      : t("workflow.masterMissing");
  }
  if (stepId === "dna.lighting") {
    const lighting = ws.draftDna.lighting as { timeOfDay?: string; artificialLighting?: unknown[] };
    return `${lighting.timeOfDay ?? "—"} · ${lighting.artificialLighting?.length ?? 0} ${t("workflow.lights")}`;
  }
  return t("workflow.reviewValues");
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
