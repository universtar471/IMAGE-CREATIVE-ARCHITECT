/**
 * Resolves `dna.spaceCatalog` against the catalog and turns the active space into prompt
 * lines (SRS §4.3–4.4, §12.3). Only the active space is compiled, never the other rooms.
 *
 * Evidence policy: a required element is stated as present only when the space's fact for
 * it is confirmed (`verified` / `user_declared`); otherwise it is phrased "if present in the
 * approved references". Optional elements appear only once the user approved them, and a
 * forbidden element is lifted only by a confirmed fact.
 */
import { isConfirmed } from "../facts/evidence";
import type { ProjectDNA } from "../schemas/projectDna";
import type { SpaceInstance } from "../schemas/extensions";
import { SPACE_CATALOG } from "./catalog";
import type { SpaceCatalogRegistry } from "./registry";
import {
  CUSTOM_SPACE_PRESET_ID,
  type SpaceItem,
  type SpacePreset,
  type SpaceZone,
} from "./schemas";

export type ActiveSpace = {
  space: SpaceInstance;
  /** `null` for a custom space or a preset id the catalog does not know. */
  preset: SpacePreset | null;
  custom: boolean;
};

/** Measured dimensions of a space, stored as facts (metres); unmeasured ones stay absent. */
export const SPACE_DIMENSION_FACTS = ["widthM", "depthM", "heightM"] as const;
export type SpaceDimensionFact = (typeof SPACE_DIMENSION_FACTS)[number];

/**
 * The space a shot renders: `targetSpaceId` when given, else `activeSpaceId`. `null` when
 * the DNA has no catalog extension or no such space.
 */
export function resolveActiveSpace(
  dna: Pick<ProjectDNA, "spaceCatalog">,
  options: { targetSpaceId?: string | null; catalog?: SpaceCatalogRegistry } = {},
): ActiveSpace | null {
  const extension = dna.spaceCatalog;
  const id = options.targetSpaceId ?? extension?.activeSpaceId;
  const space = id ? extension?.spaces.find((s) => s.id === id) : undefined;
  if (!space) return null;
  const custom = space.presetId === CUSTOM_SPACE_PRESET_ID;
  const catalog = options.catalog ?? SPACE_CATALOG;
  return { space, preset: custom ? null : catalog.preset(space.presetId), custom };
}

const ZONE_TEXT: Record<SpaceZone, string> = {
  interior: "interior space",
  exterior: "outdoor space",
  semi_outdoor: "semi-outdoor space",
};

const DIMENSION_LABEL: Record<SpaceDimensionFact, string> = {
  widthM: "width",
  depthM: "depth",
  heightM: "height",
};

const confirmedFact = (space: SpaceInstance, key: string) =>
  Object.hasOwn(space.facts, key) && isConfirmed(space.facts[key]!.evidence);

const list = (items: readonly SpaceItem[]) => items.map((i) => i.en).join("; ");

/** Fixed formatting: at most 2 decimals, '.' separator (as the compiler). */
const num = (n: number) => String(Math.round(n * 100) / 100);

function dimensionLine(space: SpaceInstance): string | null {
  const parts = SPACE_DIMENSION_FACTS.flatMap((key) => {
    const value = space.facts[key]?.value;
    if (!confirmedFact(space, key) || typeof value !== "number" || !Number.isFinite(value))
      return [];
    return value > 0 ? [`${DIMENSION_LABEL[key]} ${num(value)} m`] : [];
  });
  return parts.length ? `Verified dimensions: ${parts.join(", ")}.` : null;
}

/**
 * Prompt lines for the active space (empty without one). The first line names the space and
 * its scope; the rest are evidence-aware element lists.
 */
export function spaceScopeLines(
  dna: Pick<ProjectDNA, "spaceCatalog">,
  options: { targetSpaceId?: string | null; catalog?: SpaceCatalogRegistry } = {},
): string[] {
  const active = resolveActiveSpace(dna, options);
  if (!active) return [];
  const { space, preset } = active;
  const dimensions = dimensionLine(space);
  if (active.custom) {
    const label = space.label ? ` "${space.label}"` : "";
    return [
      `Space scope: render only the selected custom space${label}; do not merge in other spaces of the building.`,
      ...(dimensions ? [dimensions] : []),
    ];
  }
  // An unknown preset id compiles nothing; the validator reports it.
  if (!preset) return [];

  const catalog = options.catalog ?? SPACE_CATALOG;
  const archetype = catalog.archetype(dna.spaceCatalog?.buildingArchetype)?.labelEn.toLowerCase();
  const lines = [
    `Space scope: render only the ${preset.labelEn} of this ${archetype ?? "building"} (${ZONE_TEXT[preset.zone]}); do not merge in other spaces of the building.`,
  ];
  const variant = preset.variants.find((v) => v.id === space.variantId);
  if (variant) lines.push(`Variant: ${variant.labelEn}.`);
  if (dimensions) lines.push(dimensions);

  const confirmed = preset.requiredIfVerified.filter((i) => confirmedFact(space, i.id));
  const unconfirmed = preset.requiredIfVerified.filter((i) => !confirmedFact(space, i.id));
  if (confirmed.length) lines.push(`Confirmed elements: ${list(confirmed)}.`);
  if (unconfirmed.length)
    lines.push(`Only if present in the approved references: ${list(unconfirmed)}.`);

  const approved = preset.optional.filter((i) => space.approvedOptionalIds.includes(i.id));
  if (approved.length)
    lines.push(`Approved optional additions, only where they physically fit: ${list(approved)}.`);

  const forbidden = preset.forbiddenUnlessConfirmed.filter((i) => !confirmedFact(space, i.id));
  if (forbidden.length) lines.push(`Do not introduce: ${list(forbidden)}.`);
  return lines;
}
