import { GitBranch, Image as ImageIcon } from "lucide-react";
import { useStudio } from "../../app/store";
import { hasOwnCenter } from "../../features/workspace/modules";
import { useT } from "../../i18n";

/**
 * Studio ↔ Node switch (ADR-044): one place in the top bar. Switching only changes the centre
 * view; drafts, selection and the Node Canvas pan/zoom are kept, and nothing is sent.
 */
export function ModeSwitch() {
  const mode = useStudio((s) => s.workspaceMode);
  const setMode = useStudio((s) => s.setWorkspaceMode);
  const active = useStudio((s) => s.activeModule);
  const t = useT();
  const locked = hasOwnCenter(active);
  const reason = locked ? t("workspace.modeLocked") : undefined;
  const shown = locked ? "studio" : mode;
  const options = [
    { id: "studio" as const, icon: ImageIcon, label: t("workspace.modeStudio") },
    { id: "node" as const, icon: GitBranch, label: t("workspace.modeNode") },
  ];
  return (
    <div className="mode-switch" role="group" aria-label={t("workspace.modeLabel")}>
      {options.map(({ id, icon: Icon, label }) => (
        <button
          key={id}
          type="button"
          className="mode-switch-btn"
          aria-pressed={shown === id}
          disabled={locked && id === "node"}
          title={locked && id === "node" ? reason : label}
          onClick={() => setMode(id)}
          data-testid={`mode-${id}`}
        >
          <Icon size={14} aria-hidden="true" />
          <span className="topbar-label">{label}</span>
        </button>
      ))}
    </div>
  );
}
