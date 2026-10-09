import type { AssetRole, ProjectStatus } from "@arch/domain";
import { useT } from "../../i18n";

const STATUS_TONE: Partial<Record<ProjectStatus, string>> = {
  draft: "badge-neutral",
  dna_ready: "badge-info",
  master_pending: "badge-warning",
  master_approved: "badge-success",
  anchor_generation: "badge-warning",
  production: "badge-accent",
  archived: "badge-neutral",
};

export function StatusBadge({ status }: { status: ProjectStatus }) {
  const t = useT();
  return (
    <span className={`badge ${STATUS_TONE[status] ?? "badge-info"}`}>
      {t(`labels.projectStatus.${status}`)}
    </span>
  );
}

const ROLE_TONE: Record<AssetRole, string> = {
  master_architecture: "badge-accent",
  architecture_reference: "badge-info",
  material_reference: "badge-warning",
  context_reference: "badge-neutral",
  landscape_reference: "badge-success",
  lighting_reference: "badge-warning",
  mood_reference: "badge-accent",
  camera_reference: "badge-info",
  regular_image: "badge-neutral",
};

export function RoleBadge({ role, short = false }: { role: AssetRole; short?: boolean }) {
  const t = useT();
  const label = t(`labels.assetRole.${role}`);
  return (
    <span className={`badge ${ROLE_TONE[role]}`} title={label}>
      {short ? t(`labels.assetRoleShort.${role}`) : label}
    </span>
  );
}
