import { Fragment } from "react";
import { useStudio } from "../../app/store";
import { WORKSPACE_MODULES } from "../../features/workspace/modules";
import { useT } from "../../i18n";

/** Permanent left navigation. Order and grouping are product architecture — do not reorder. */
export function WorkspaceNav() {
  const active = useStudio((s) => s.activeModule);
  const setModule = useStudio((s) => s.setModule);
  const t = useT();
  return (
    <nav className="nav" aria-label={t("modules.navLabel")}>
      {WORKSPACE_MODULES.map((m, i) => {
        const prev = WORKSPACE_MODULES[i - 1];
        const Icon = m.icon;
        const label = t(`modules.${m.id}.label`);
        return (
          <Fragment key={m.id}>
            {prev && prev.group !== m.group && <div className="nav-group-sep" role="separator" />}
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
              <Icon size={16} />
              <span className="nav-label">{label}</span>
              {m.availableIn && <span className="nav-phase">P{m.availableIn}</span>}
            </button>
          </Fragment>
        );
      })}
    </nav>
  );
}
