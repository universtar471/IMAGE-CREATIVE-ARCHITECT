import { useCallback, useEffect, useMemo, useState } from "react";
import { FolderOpen, Plus, Search, SearchX } from "lucide-react";
import type { ProjectSummaryDTO } from "@arch/domain";
import { attempt, useStudio } from "../../app/store";
import { ConfirmDialog } from "../../components/common/Dialog";
import { EmptyState, ErrorState, LoadingState } from "../../components/common/states";
import { BrandMark } from "../../components/shell/BrandMark";
import { LocaleSwitch } from "../../components/shell/LocaleSwitch";
import { translate, useLocale, useT } from "../../i18n";
import { subtypeLabel } from "../../i18n/knowledge";
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
  const t = useT();
  const locale = useLocale((s) => s.locale);

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
    // Search matches the type/subtype in both languages and the raw subtype id.
    const typeText = (p: ProjectSummaryDTO) =>
      [
        translate("en", `labels.projectType.${p.projectType}`),
        translate(locale, `labels.projectType.${p.projectType}`),
        p.subtype ?? "",
        p.subtype ? subtypeLabel(p.projectType, p.subtype, locale) : "",
      ]
        .join(" ")
        .toLowerCase();
    return (projects ?? [])
      .filter((p) =>
        filter === "all" ? true : filter === "archived" ? !!p.archivedAt : !p.archivedAt,
      )
      .filter((p) => !q || p.name.toLowerCase().includes(q) || typeText(p).includes(q));
  }, [projects, filter, query, locale]);

  const setArchived = async (p: ProjectSummaryDTO, archived: boolean) => {
    setToArchive(null);
    const res = await attempt(() => call("project_set_archived", { projectId: p.id, archived }));
    if (res) {
      notify(
        "success",
        archived
          ? t("hub.archivedToast", { name: p.name })
          : t("hub.restoredToast", { name: p.name }),
      );
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
            placeholder={t("hub.search")}
            aria-label={t("hub.search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="segmented" role="group" aria-label={t("hub.filterLabel")}>
          <button aria-pressed={filter === "active"} onClick={() => setFilter("active")}>
            {t("hub.active", { count: activeCount })}
          </button>
          <button aria-pressed={filter === "archived"} onClick={() => setFilter("archived")}>
            {t("hub.archived", { count: archivedCount })}
          </button>
          <button aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
            {t("hub.all")}
          </button>
        </div>
        <button className="btn btn-primary" onClick={() => setWizardOpen(true)}>
          <Plus size={15} /> {t("hub.newProject")}
        </button>
        <LocaleSwitch />
      </header>

      <div className="hub-body">
        {error ? (
          <ErrorState title={t("hub.loadFailed")} message={error} onRetry={() => void load()} />
        ) : !projects ? (
          <LoadingState label={t("hub.loading")} />
        ) : projects.length === 0 ? (
          <EmptyState
            icon={<FolderOpen size={36} />}
            title={t("hub.empty")}
            action={
              <button className="btn btn-primary" onClick={() => setWizardOpen(true)}>
                <Plus size={15} /> {t("hub.createFirst")}
              </button>
            }
          >
            {t("hub.emptyHint")}
          </EmptyState>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<SearchX size={32} />}
            title={
              query
                ? t("hub.noMatch")
                : filter === "archived"
                  ? t("hub.noArchived")
                  : t("hub.noActive")
            }
          >
            {query
              ? t("hub.tryOther")
              : filter === "archived"
                ? t("hub.archivedAppear")
                : t("hub.allArchived")}
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
            notify("success", t("hub.createdToast", { name: p.name }));
            void openProject(p.id);
          }}
        />
      )}
      {toArchive && (
        <ConfirmDialog
          title={t("hub.archiveTitle")}
          message={t("hub.archiveMessage", { name: toArchive.name })}
          confirmLabel={t("common.archive")}
          onConfirm={() => void setArchived(toArchive, true)}
          onCancel={() => setToArchive(null)}
        />
      )}
    </div>
  );
}
