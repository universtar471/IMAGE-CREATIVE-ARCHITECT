/**
 * SITE & OCCLUSION section (ADR-034, SRS §5.2, §12.2 item 4).
 *
 * Replaces the ADR-028 party-wall wording with lines driven by the site adjacency and the
 * visibility resolver. It keeps every constraint the old wording expressed:
 * - attached sides: party walls hidden, no side facade or windows, no setback / yard / gap /
 *   passage / alley / detached corner, and the oblique street viewpoint line;
 * - continuous block (aerial): same mid-block street, no corner lot or new street;
 * - corner lot: only the confirmed street side is revealed;
 * - unknown side: no invented corner, side street or neighbour arrangement.
 * It now also applies without a master image (worded without "Image N") and to every
 * exterior camera, not only the one that points at the attached side.
 */
import type { ProjectType } from "../../schemas/enums";
import type { ProjectDNA } from "../../schemas/projectDna";
import type { CameraDNA } from "../../schemas/future";
import type { SiteSide } from "../../schemas/extensions";
import { describeCamera } from "../../camera/describe";
import { resolveSiteAdjacency, type ResolvedSiteAdjacency } from "../../site/adjacency";
import {
  isFacadeExposable,
  resolveVisibility,
  type Facade,
  type VisibilityResult,
} from "../../site/visibility";
import { cameraSitePlan } from "../topology";

export const SITE_OCCLUSION_HEADING = "SITE & OCCLUSION PRESERVATION:";

/** Site adjacency and visibility for one exterior shot; null for interiors or no camera. */
export function shotVisibility(
  dna: Pick<ProjectDNA, "site" | "context">,
  camera: CameraDNA | null | undefined,
  projectType: ProjectType,
): { adjacency: ResolvedSiteAdjacency; visibility: VisibilityResult } | null {
  if (!camera || projectType === "interior") return null;
  const adjacency = resolveSiteAdjacency(dna);
  return { adjacency, visibility: resolveVisibility(adjacency, camera) };
}

/** The camera section text that never promises a facade the site hides. */
export function siteCameraText(
  camera: CameraDNA,
  dna: Pick<ProjectDNA, "site" | "context">,
  projectType: ProjectType,
): string {
  return describeCamera(camera, shotVisibility(dna, camera, projectType)?.visibility);
}

const LATERAL: readonly SiteSide[] = ["left", "right"];

function sidesText(sides: readonly SiteSide[]): string {
  const lateral = sides.filter((s) => s !== "rear");
  const parts: string[] = [];
  if (lateral.length === 2) parts.push("both sides");
  else if (lateral.length === 1) parts.push(`the ${lateral[0]} side`);
  if (sides.includes("rear")) parts.push(parts.length ? "at the rear" : "the rear");
  return parts.join(" and ");
}

function attachedLines(adjacency: ResolvedSiteAdjacency, attached: readonly SiteSide[]): string[] {
  // A lateral side the site lets a camera show (street or open space) must not be
  // forbidden: then the party-wall rule is scoped to the attached sides only.
  const otherExposable = LATERAL.some(
    (s) => !attached.includes(s) && isFacadeExposable(adjacency, s),
  );
  const intro = `The building is attached to neighbouring buildings on ${sidesText(attached)}.`;
  if (!otherExposable)
    return [
      `${intro} Keep the party walls hidden and attached to the same neighbours; do not expose a side facade or side windows. Do not create a side setback, side yard, gap, passage, alley, or detached corner condition.`,
    ];
  const scoped = attached.map((s) => (s === "rear" ? "the rear" : `the ${s} side`)).join(" or ");
  return [
    `${intro} Keep the party walls hidden and attached to the same neighbours; do not expose a facade or windows on ${scoped}. Do not create a setback, yard, gap, passage, or alley on ${scoped}.`,
  ];
}

function unknownLine(side: SiteSide, source: string): string {
  const invented =
    side === "rear"
      ? "a rear street, back lane or new neighbour arrangement"
      : "a corner plot, side street or new neighbour arrangement";
  const name = side === "rear" ? "the rear" : `the ${side} side`;
  return `${name[0]!.toUpperCase()}${name.slice(1)} is not confirmed: do not invent ${invented}, and do not present ${name} as an exposed facade; show it only as a plain continuation consistent with ${source}.`;
}

/**
 * The section's lines (heading first), or none when the site adds nothing for this shot:
 * no camera, an interior, or a camera that shows only free sides of a detached building.
 */
export function siteOcclusionLines(
  dna: Pick<ProjectDNA, "site" | "context">,
  camera: CameraDNA | null | undefined,
  projectType: ProjectType,
  masterIndex: number,
): string[] {
  const shot = shotVisibility(dna, camera, projectType);
  if (!shot || !camera) return [];
  const { adjacency, visibility } = shot;
  const master = masterIndex >= 0 ? `Image ${masterIndex + 1}` : null;
  const plan = cameraSitePlan(camera, dna.context, projectType);
  const hasWarning = (facade: Facade, code: VisibilityResult["warnings"][number]["code"]) =>
    visibility.warnings.some((w) => w.facade === facade && w.code === code);
  const lines: string[] = [];

  const attached = (["left", "right", "rear"] as const).filter(
    (s) => adjacency[s].kind === "attached_building",
  );
  if (attached.length) lines.push(...attachedLines(adjacency, attached));

  const hiddenAttached = LATERAL.filter((s) => hasWarning(s, "attached_side_hidden"));
  const fromAbove = camera.viewType === "aerial" || plan.mode === "aerial_block";
  if (plan.mode === "oblique_street" || (hiddenAttached.length && !fromAbove)) {
    const side = plan.side ?? hiddenAttached[0] ?? "side";
    lines.push(
      "Use an oblique street-level viewpoint of the front facade only. The oblique camera angle does not imply an exposed side elevation.",
    );
    if (plan.mode === "oblique_street")
      lines.push(
        `Camera viewpoint: ${side === "left" ? "front-left" : "front-right"} oblique street view from eye level, about 30–35° off the facade axis, looking along the street. Composition: front facade dominant; the ${side} side wall stays hidden behind the attached neighbour.`,
      );
  }

  if (plan.mode === "aerial_block") {
    lines.push(
      master
        ? `Keep the same continuous mid-block street and neighbourhood shown in ${master}. The subject remains between the same left and right neighbours, at the same street frontage. Extend the existing block naturally into areas outside ${master}; do not create a corner lot, street junction, side street, vacant plot, new boundary, or new access road. Keep the neighbours as separate buildings and preserve their visible footprints and roof forms.`
        : "Keep the same continuous mid-block street and neighbourhood. The subject remains between the same left and right neighbours, at the same street frontage. Extend the block naturally beyond the frame; do not create a corner lot, street junction, side street, vacant plot, new boundary, or new access road. Keep the neighbours as separate buildings and preserve their footprints and roof forms.",
    );
  }

  for (const side of LATERAL) {
    if (visibility.visibleFacades.includes(side) && adjacency[side].kind === "street")
      lines.push(
        `This is a corner plot: a side street runs along the ${side} side; reveal that side facade consistently with ${master ?? "the design"}.`,
      );
  }

  for (const side of ["left", "right", "rear"] as const) {
    if (hasWarning(side, "boundary_wall"))
      lines.push(
        `A boundary wall runs along ${side === "rear" ? "the rear" : `the ${side} side`}: keep the wall and do not expose the ${side} facade behind it.`,
      );
    if (hasWarning(side, "side_unknown"))
      lines.push(unknownLine(side, master ?? "the described site"));
  }

  if (attached.length)
    lines.push(
      "Preserve adjacent buildings, shared boundaries and realistic occlusion. Never clear neighbouring plots or relocate contextual buildings to reveal a side facade.",
    );

  return lines.length ? [SITE_OCCLUSION_HEADING, ...lines] : [];
}
