import { useCallback, useEffect, useMemo, useState } from "react";
import { FolderOpen, Plus, Search, SearchX } from "lucide-react";
import { PROJECT_TYPE_LABELS, type ProjectSummaryDTO } from "@arch/domain";
import { attempt, useStudio } from "../../app/store";
import { ConfirmDialog } from "../../components/common/Dialog";
import { EmptyState, ErrorState, LoadingState } from "../../components/common/states";
import { BrandMark } from "../../components/shell/BrandMark";
import { call, toBridgeError } from "../../lib/bridge";
import { NewProjectWizard } from "./NewProjectWizard";
import { ProjectCard } from "./ProjectCard";

type Filter = "active" | "archived" | "all";

export function ProjectHub() {
  const openProject = useStudio((s) => s.openProject);
  const notify = useStudio((s) => s.notify);
  const [projects, setProjects] = useState<ProjectSummaryDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("active");
  const [query, setQuery] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [toArchive, setToArchive] = useState<ProjectSummaryDTO | null>(null);

  const load = useCallback(
    () =>
      call("project_list", { includeArchived: true }).then(
        (list) => {
          setProjects(list);
          setError(null);
        },
        (err: unknown) => setError(toBridgeError(err).message),
      ),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (projects ?? [])
      .filter((p) =>
        filter === "all" ? true : filter === "archived" ? !!p.archivedAt : !p.archivedAt,
      )
      .filter(
        (p) =>
          !q ||
          p.name.toLowerCase().includes(q) ||
          PROJECT_TYPE_LABELS[p.projectType].toLowerCase().includes(q) ||
          (p.subtype ?? "").toLowerCase().includes(q),
      );
  }, [projects, filter, query]);

  const setArchived = async (p: ProjectSummaryDTO, archived: boolean) => {
    setToArchive(null);
    const res = await attempt(() => call("project_set_archived", { projectId: p.id, archived }));
    if (res) {
      notify("success", archived ? `'${p.name}' archived.` : `'${p.name}' restored.`);
      await load();
    }
  };

  const activeCount = projects?.filter((p) => !p.archivedAt).length ?? 0;
  const archivedCount = (projects?.length ?? 0) - activeCount;

  return (
    <div className="hub" data-testid="project-hub">
      <header className="hub-header">
        <div className="brand">
          <BrandMark /> Arch AI Studio
        </div>
        <span className="spacer" />
        <div className="search">
          <Search size={14} />
          <input
            className="input"
            placeholder="Search projects"
            aria-label="Search projects"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="segmented" role="group" aria-label="Project filter">
          <button aria-pressed={filter === "active"} onClick={() => setFilter("active")}>
            Active ({activeCount})
          </button>
          <button aria-pressed={filter === "archived"} onClick={() => setFilter("archived")}>
            Archived ({archivedCount})
          </button>
          <button aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
            All
          </button>
        </div>
        <button className="btn btn-primary" onClick={() => setWizardOpen(true)}>
          <Plus size={15} /> New Project
        </button>
      </header>

      <div className="hub-body">
        {error ? (
          <ErrorState title="Could not load projects" message={error} onRetry={() => void load()} />
        ) : !projects ? (
          <LoadingState label="Loading projects…" />
        ) : projects.length === 0 ? (
          <EmptyState
            icon={<FolderOpen size={36} />}
            title="No projects yet"
            action={
              <button className="btn btn-primary" onClick={() => setWizardOpen(true)}>
                <Plus size={15} /> Create your first project
              </button>
            }
          >
            A project holds the structured design DNA, references and every image produced from
            them.
          </EmptyState>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<SearchX size={32} />}
            title={query ? "No matching projects" : `No ${filter} projects`}
          >
            {query
              ? "Try a different search or filter."
              : filter === "archived"
                ? "Archived projects will appear here."
                : "All projects are archived."}
          </EmptyState>
        ) : (
          <div className="hub-grid">
            {visible.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                onOpen={() => void openProject(p.id)}
                onArchive={() => setToArchive(p)}
                onRestore={() => void setArchived(p, false)}
              />
            ))}
          </div>
        )}
      </div>

      {wizardOpen && (
        <NewProjectWizard
          onClose={() => setWizardOpen(false)}
          onCreated={(p) => {
            setWizardOpen(false);
            notify("success", `Project '${p.name}' created.`);
            void openProject(p.id);
          }}
        />
      )}
      {toArchive && (
        <ConfirmDialog
          title="Archive project?"
          message={`'${toArchive.name}' will become read-only and move to Archived. Nothing is deleted; you can restore it any time.`}
          confirmLabel="Archive"
          onConfirm={() => void setArchived(toArchive, true)}
          onCancel={() => setToArchive(null)}
        />
      )}
    </div>
  );
}
