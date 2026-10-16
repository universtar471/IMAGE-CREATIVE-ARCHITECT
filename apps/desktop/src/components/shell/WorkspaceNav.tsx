import { Fragment } from "react";
import { AlertTriangle, Check, Circle, LockKeyhole, Minus } from "lucide-react";
import { selectSection, useStudio } from "../../app/store";
import {
  moduleById,
  sectionById,
  WORKSPACE_SECTIONS,
  type SectionId,
} from "../../features/workspace/modules";
import { useT } from "../../i18n";
import { WORKFLOW_STEPS } from "../../lib/workflow";

/**
 * Permanent left navigation (ADR-040): five sections, "Studio nâng cao" separated at the
 * bottom with its nine modules as a secondary list. Order is product architecture.
 */
export function WorkspaceNav() {
  const section = useStudio(selectSection);
  const setSection = useStudio((s) => s.setSection);
  const t = useT();
  const main = WORKSPACE_SECTIONS.filter((s) => s.id !== "studio");
  return (
    <nav className="nav" aria-label={t("sections.navLabel")}>
      {main.map((s) => (
        <SectionButton
          key={s.id}
          id={s.id}
          active={section === s.id}
          onSelect={() => setSection(s.id)}
        />
      ))}
      <div className="nav-studio">
        <div className="nav-group-sep" role="separator" />
        <SectionButton
          id="studio"
          active={section === "studio"}
          onSelect={() => setSection("studio")}
        />
        {section === "studio" && <StudioModules />}
      </div>
    </nav>
  );
}

function SectionButton({
  id,
  active,
  onSelect,
}: {
  id: SectionId;
  active: boolean;
  onSelect: () => void;
}) {
  const t = useT();
  const Icon = sectionById(id).icon;
  return (
    <button
      className="nav-item nav-section"
      aria-current={active ? "page" : undefined}
      onClick={onSelect}
      title={t(`sections.${id}.description`)}
      data-section={id}
    >
      <Icon size={16} />
      <span className="nav-label">{t(`sections.${id}.label`)}</span>
    </button>
  );
}

/** Studio's modules with the workflow step numbers and status icons. */
function StudioModules() {
  const active = useStudio((s) => s.activeModule);
  const setModule = useStudio((s) => s.setModule);
  const t = useT();
  const workflow = useStudio((s) => s.workflowView);
  const isInterior = useStudio((s) => s.workspace?.project.projectType === "interior");
  const modules = sectionById("studio").modules.map(moduleById);
  return (
    <div className="nav-sub" role="group" aria-label={t("sections.studioModules")}>
      {modules.map((m, i) => {
        const prev = modules[i - 1];
        const Icon = m.icon;
        const label =
          isInterior && m.id === "design_dna" ? t("interior.space") : t(`modules.${m.id}.label`);
        const dnaIndex = WORKFLOW_STEPS.findIndex(
          (item) => item.moduleId === m.id && item.stage === "dna",
        );
        const step = WORKFLOW_STEPS.find((item) => item.moduleId === m.id);
        const status = workflow?.steps.find((item) => item.id === step?.id)?.status;
        return (
          <Fragment key={m.id}>
            {m.group === "dna" && (!prev || prev.group !== m.group) && (
              <div className="nav-group-label">{t("workflow.stage.dna")}</div>
            )}
            <button
              className={`nav-item ${m.availableIn ? "is-future" : ""}`}
              aria-current={active === m.id ? "page" : undefined}
              onClick={() => setModule(m.id)}
              title={
                m.availableIn
                  ? t("modules.futureTitle", { label, phase: m.availableIn })
                  : t(`modules.${m.id}.description`)
              }
              data-module={m.id}
            >
              {dnaIndex >= 0 ? <span className="nav-step-number">{dnaIndex + 1}</span> : null}
              <Icon size={16} />
              <span className="nav-label">{label}</span>
              {m.availableIn && <span className="nav-phase">P{m.availableIn}</span>}
              {step && status ? (
                <span
                  className="nav-status"
                  data-testid={`workflow-status-${step.id}`}
                  title={t(`workflow.status.${status}`)}
                >
                  {statusIcon(status)}
                </span>
              ) : null}
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}

function statusIcon(status: string) {
  if (status === "locked") return <LockKeyhole size={12} />;
  if (status === "confirmed" || status === "done") return <Check size={12} />;
  if (status === "needs_review") return <AlertTriangle size={12} />;
  if (status === "skipped") return <Minus size={12} />;
  return <Circle size={12} />;
}
