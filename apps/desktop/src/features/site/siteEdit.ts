/**
 * Site edits (ADR-034). The site editor owns `dna.site` and keeps the ADR-028
 * `context.siteTopology` toggles in sync, so older code paths (camera plans, chips, the
 * overview summary, the context preview) keep reading the same sides.
 */
import {
  siteForEditing,
  siteTopologyFromSite,
  withSiteBoundary,
  type EvidenceStatus,
  type ProjectDNA,
  type SiteBoundaryKind,
  type SiteExtension,
  type SiteSide,
} from "@arch/domain";

type EditDna = (path: string, value: unknown) => void;

/** Writes both representations: `site`, then the synced `context.siteTopology`. */
export function writeSite(editDna: EditDna, site: SiteExtension): void {
  editDna("site", site);
  editDna("context.siteTopology", siteTopologyFromSite(site));
}

/**
 * The evidence a side gets when the user picks its kind: choosing a kind declares it,
 * unless the kind is "unknown" or the side already carries stronger evidence.
 */
export function statusAfterKindChange(
  kind: SiteBoundaryKind,
  current: EvidenceStatus,
): EvidenceStatus {
  if (kind === "unknown") return "unknown";
  return current === "unknown" || current === "inferred" ? "user_declared" : current;
}

/** Applies one side edit on top of the stored site (or the sides derived from the toggles). */
export function editSiteSide(
  editDna: EditDna,
  dna: Pick<ProjectDNA, "site" | "context">,
  side: SiteSide,
  patch: { kind?: SiteBoundaryKind; status?: EvidenceStatus },
): void {
  const site = siteForEditing(dna);
  const status =
    patch.status ??
    (patch.kind !== undefined
      ? statusAfterKindChange(patch.kind, site[side].evidence.status)
      : undefined);
  writeSite(editDna, withSiteBoundary(site, side, { ...patch, status }));
}
