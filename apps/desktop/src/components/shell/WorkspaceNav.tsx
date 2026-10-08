import { Fragment } from "react";
import { useStudio } from "../../app/store";
import { WORKSPACE_MODULES } from "../../features/workspace/modules";

/** Permanent left navigation. Order and grouping are product architecture — do not reorder. */
export function WorkspaceNav() {
  const active = useStudio((s) => s.activeModule);
  const setModule = useStudio((s) => s.setModule);
  return (
    <nav className="nav" aria-label="Workspace modules">
      {WORKSPACE_MODULES.map((m, i) => {
        const prev = WORKSPACE_MODULES[i - 1];
        const Icon = m.icon;
        return (
          <Fragment key={m.id}>
            {prev && prev.group !== m.group && <div className="nav-group-sep" role="separator" />}
            <button
              className={`nav-item ${m.availableIn ? "is-future" : ""}`}
              aria-current={active === m.id ? "page" : undefined}
              onClick={() => setModule(m.id)}
              title={
                m.availableIn ? `${m.label} — coming in Phase ${m.availableIn}` : m.description
              }
              data-module={m.id}
            >
              <Icon size={16} />
              <span className="nav-label">{m.label}</span>
              {m.availableIn && <span className="nav-phase">P{m.availableIn}</span>}
            </button>
          </Fragment>
        );
      })}
    </nav>
  );
}
