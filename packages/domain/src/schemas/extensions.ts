/**
 * Optional, individually versioned ProjectDNA extensions (ADR-034, SRS §14).
 *
 * `ProjectDNA.schemaVersion` stays 1: a DNA without these keys is still a complete v1 DNA
 * and must load, save and reopen unchanged. Each extension carries its own `version` so it
 * can migrate on its own.
 */
import { z } from "zod";
import { EvidenceRefSchema } from "../facts/evidence";

const id = z.string().trim().min(1);

// ---------------------------------------------------------------- site adjacency

export const SITE_SIDES = ["front", "left", "right", "rear"] as const;
export type SiteSide = (typeof SITE_SIDES)[number];

export const SITE_BOUNDARY_KINDS = [
  "attached_building",
  "street",
  "open_space",
  "boundary_wall",
  "unknown",
] as const;
export const SiteBoundaryKindSchema = z.enum(SITE_BOUNDARY_KINDS);
export type SiteBoundaryKind = z.infer<typeof SiteBoundaryKindSchema>;

export const SiteBoundarySchema = z.object({
  kind: SiteBoundaryKindSchema,
  evidence: EvidenceRefSchema,
  neighborObjectId: id.optional(),
  heightRelation: z.enum(["lower", "similar", "taller", "unknown"]).optional(),
});
export type SiteBoundary = z.infer<typeof SiteBoundarySchema>;

/** Left/right are as seen by a viewer standing outside, facing the front facade. */
export const SiteExtensionSchema = z.object({
  version: z.literal(1),
  coordinateConvention: z.literal("viewer_facing_front_facade"),
  front: SiteBoundarySchema,
  left: SiteBoundarySchema,
  right: SiteBoundarySchema,
  rear: SiteBoundarySchema,
});
export type SiteExtension = z.infer<typeof SiteExtensionSchema>;

// ---------------------------------------------------------------- space catalog

export const SpaceFactSchema = z.object({
  // Any JSON value; must be present so the persisted fact always has a `value` key.
  value: z.unknown().refine((v) => v !== undefined, "A fact needs a value."),
  evidence: EvidenceRefSchema,
});
export type SpaceFact = z.infer<typeof SpaceFactSchema>;

export const SpaceInstanceSchema = z.object({
  id,
  presetId: id,
  floorId: id.optional(),
  label: z.string().trim().min(1).optional(),
  facts: z.record(z.string(), SpaceFactSchema).default({}),
  lockedElementIds: z.array(id).default([]),
  approvedOptionalIds: z.array(id).default([]),
});
export type SpaceInstance = z.infer<typeof SpaceInstanceSchema>;

export const SpaceCatalogExtensionSchema = z
  .object({
    version: z.literal(1),
    buildingArchetype: id,
    spaces: z.array(SpaceInstanceSchema).default([]),
    activeSpaceId: id.optional(),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.spaces.forEach((space, index) => {
      if (seen.has(space.id))
        ctx.addIssue({
          code: "custom",
          path: ["spaces", index, "id"],
          message: "Space ids must be unique.",
        });
      seen.add(space.id);
    });
    if (value.activeSpaceId !== undefined && !seen.has(value.activeSpaceId))
      ctx.addIssue({
        code: "custom",
        path: ["activeSpaceId"],
        message: "activeSpaceId must name one of the spaces.",
      });
  });
export type SpaceCatalogExtension = z.infer<typeof SpaceCatalogExtensionSchema>;

// ---------------------------------------------------------------- architectural details

/**
 * Schema only in P0; the detail planner, prompts and UI arrive in P2. The extension is a
 * plain array (ADR-034), so each record carries the extension version.
 */
export const DetailRecordSchema = z.object({
  version: z.literal(1),
  id,
  spaceId: id,
  name: z.string().trim().min(1),
  location: z
    .object({
      facade: z.enum(["front", "rear", "left", "right"]).optional(),
      floorId: id.optional(),
      elementId: id.optional(),
    })
    .optional(),
  evidence: EvidenceRefSchema,
  materialIds: z.array(id).default([]),
  locked: z.boolean().default(false),
});
export type DetailRecord = z.infer<typeof DetailRecordSchema>;
