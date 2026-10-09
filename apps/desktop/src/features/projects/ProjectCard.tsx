import { memo } from "react";
import { Archive, ArchiveRestore, Building2, FolderOpen, Star } from "lucide-react";
import type { ProjectSummaryDTO } from "@arch/domain";
import { StatusBadge } from "../../components/common/StatusBadge";
import { fileUrl } from "../../lib/files";
import { formatRelativeTime } from "../../lib/format";
import { useT } from "../../i18n";
import { subtypeLabel } from "../../i18n/knowledge";

export const ProjectCard = memo(function ProjectCard({
  project,
  onOpen,
  onArchive,
  onRestore,
}: {
  project: ProjectSummaryDTO;
  onOpen: () => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  // Hub uses the master's small thumbnail only, never the original.
  const t = useT();
  const thumb = fileUrl(project.thumbnailPath);
  const archived = !!project.archivedAt;
  return (
    <article className={`project-card ${archived ? "is-archived" : ""}`} data-testid="project-card">
      <button
        className="project-thumb"
        onClick={onOpen}
        aria-label={t("hub.openProject", { name: project.name })}
      >
        {thumb ? (
          <img src={thumb} alt="" loading="lazy" decoding="async" />
        ) : (
          <Building2 size={36} />
        )}
        {project.activeMasterAssetId && (
          <span className="badge badge-accent" title={t("hub.hasMaster")}>
            <Star size={10} /> {t("common.master")}
          </span>
        )}
      </button>
      <div className="project-card-body">
        <div className="project-card-title" title={project.name}>
          {project.name}
        </div>
        <div className="project-card-meta">
          <span>{t(`labels.projectType.${project.projectType}`)}</span>
          {project.subtype && <span>· {subtypeLabel(project.projectType, project.subtype)}</span>}
        </div>
        <div className="project-card-meta">
          <StatusBadge status={project.status} />
          <span>{t("common.images", { count: project.assetCount })}</span>
          <span>· {formatRelativeTime(project.updatedAt)}</span>
        </div>
        <div className="project-card-actions">
          <button className="btn btn-sm btn-primary" onClick={onOpen}>
            <FolderOpen size={13} /> {t("common.open")}
          </button>
          <span style={{ flex: 1 }} />
          {archived ? (
            <button className="btn btn-sm" onClick={onRestore}>
              <ArchiveRestore size={13} /> {t("common.restore")}
            </button>
          ) : (
            <button className="btn btn-sm btn-ghost" onClick={onArchive}>
              <Archive size={13} /> {t("common.archive")}
            </button>
          )}
        </div>
      </div>
    </article>
  );
});
