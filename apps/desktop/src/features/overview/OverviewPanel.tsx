import { useState } from "react";
import { CheckCircle2, Circle, FileText, ShieldCheck, Star } from "lucide-react";
import { dnaReadiness, type ProjectDTO } from "@arch/domain";
import { attempt, selectReadOnly, useStudio } from "../../app/store";
import { StatusBadge } from "../../components/common/StatusBadge";
import { SectionPanel } from "../../components/panels/SectionPanel";
import { TextField } from "../../components/panels/fields";
import { call } from "../../lib/bridge";
import { knowledge } from "../../lib/knowledge";
import { formatDateTime } from "../../lib/format";
import { useT } from "../../i18n";
import { readinessLabel } from "../../i18n/domain";
import { packLabel } from "../../i18n/knowledge";

export function OverviewPanel() {
  const project = useStudio((s) => s.workspace!.project);
  const dna = useStudio((s) => s.workspace!.persistedDna);
  const assets = useStudio((s) => s.workspace!.assets);
  const setModule = useStudio((s) => s.setModule);
  const setCenterView = useStudio((s) => s.setCenterView);
  const readOnly = useStudio(selectReadOnly);
  const adoptProject = useStudio((s) => s.adoptProject);
  const master = assets.find((a) => a.id === project.activeMasterAssetId) ?? null;
  const readiness = dnaReadiness(dna, project.projectType);
  const { pack, match } = knowledge.resolve(project.projectType, project.subtype);
  const t = useT();

  const approve = async (approved: boolean) => {
    const p = await attempt(() =>
      call("project_approve_master", { projectId: project.id, approved }),
    );
    if (p) adoptProject(p);
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
