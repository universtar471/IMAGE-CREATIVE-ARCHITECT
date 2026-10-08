import { useState } from "react";
import { CheckCircle2, Circle, FileText, ShieldCheck, Star } from "lucide-react";
import { dnaReadiness, PROJECT_TYPE_LABELS, type ProjectDTO } from "@arch/domain";
import { attempt, selectReadOnly, useStudio } from "../../app/store";
import { StatusBadge } from "../../components/common/StatusBadge";
import { SectionPanel } from "../../components/panels/SectionPanel";
import { TextField } from "../../components/panels/fields";
import { call } from "../../lib/bridge";
import { knowledge } from "../../lib/knowledge";

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

  const approve = async (approved: boolean) => {
    const p = await attempt(() =>
      call("project_approve_master", { projectId: project.id, approved }),
    );
    if (p) adoptProject(p);
  };

  return (
    <>
      <SectionPanel title="Project">
        <ProjectNameField
          key={project.id + project.updatedAt}
          project={project}
          disabled={readOnly}
        />
        <dl className="kv">
          <dt>Type</dt>
          <dd>{PROJECT_TYPE_LABELS[project.projectType]}</dd>
          <dt>Subtype</dt>
          <dd>{pack && match === "exact" ? pack.label : (project.subtype ?? "—")}</dd>
          <dt>Status</dt>
          <dd>
            <StatusBadge status={project.status} />
          </dd>
          <dt>Knowledge pack</dt>
          <dd>
            {pack
              ? `${pack.label} v${pack.packVersion}${match === "custom_fallback" ? " (generic fallback)" : ""}`
              : "none"}
          </dd>
          <dt>Created</dt>
          <dd>{new Date(project.createdAt).toLocaleString()}</dd>
          <dt>Updated</dt>
          <dd>{new Date(project.updatedAt).toLocaleString()}</dd>
        </dl>
      </SectionPanel>

      <SectionPanel title="DNA readiness">
        <ul className="checklist">
          {readiness.map((r) => (
            <li key={r.key}>
              {r.done ? (
                <CheckCircle2 size={14} className="ok" />
              ) : (
                <Circle size={14} className="todo" />
              )}
              {r.label}
            </li>
          ))}
        </ul>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn btn-sm" onClick={() => setModule("design_dna")}>
            Edit Design DNA
          </button>
          <button className="btn btn-sm" onClick={() => setModule("context")}>
            Edit Context
          </button>
        </div>
      </SectionPanel>

      <SectionPanel title="Master image">
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
                Withdraw approval
              </button>
            ) : (
              <button
                className="btn btn-sm btn-primary"
                onClick={() => void approve(true)}
                disabled={readOnly}
              >
                <ShieldCheck size={14} /> Approve master
              </button>
            )}
          </>
        ) : (
          <>
            <span className="field-hint">No master architecture image yet.</span>
            <button className="btn btn-sm" onClick={() => setModule("references")}>
              Choose in References
            </button>
          </>
        )}
      </SectionPanel>

      <SectionPanel title="Prompt">
        <button className="btn btn-sm" onClick={() => setCenterView("prompt")}>
          <FileText size={14} /> Open Prompt Preview
        </button>
        <span className="field-hint">
          The prompt is compiled from structured DNA; it is never the source of truth.
        </span>
      </SectionPanel>
    </>
  );
}

function ProjectNameField({ project, disabled }: { project: ProjectDTO; disabled: boolean }) {
  const [name, setName] = useState(project.name);
  const [error, setError] = useState<string | undefined>();
  const adoptProject = useStudio((s) => s.adoptProject);

  const commit = async () => {
    const trimmed = name.trim();
    if (trimmed === project.name) return;
    if (!trimmed) {
      setError("Project name cannot be empty.");
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
        label="Name"
        value={name}
        error={error}
        disabled={disabled}
        onChange={(v) => setName(v ?? "")}
      />
    </div>
  );
}
