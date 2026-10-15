import { describe, expect, it } from "vitest";
import {
  ContextDNASchema,
  attachedSides,
  cameraSitePlan,
  isExposableBoundary,
  resolveSiteAdjacency,
  type SiteExtension,
} from "../src";

const context = (patch: Record<string, unknown> = {}) =>
  ContextDNASchema.parse({ schemaVersion: 1, ...patch });

const kinds = (a: ReturnType<typeof resolveSiteAdjacency>) => ({
  front: a.front.kind,
  left: a.left.kind,
  right: a.right.kind,
  rear: a.rear.kind,
});

describe("resolveSiteAdjacency — derived from context.siteTopology", () => {
  it("defaults to street front, unknown sides and rear when nothing is declared", () => {
    const a = resolveSiteAdjacency({ context: context() });
    expect(a.source).toBe("siteTopology");
    expect(a.coordinateConvention).toBe("viewer_facing_front_facade");
    expect(kinds(a)).toEqual({
      front: "street",
      left: "unknown",
      right: "unknown",
      rear: "unknown",
    });
    expect(a.front.evidence.status).toBe("inferred");
    expect(a.left.evidence.status).toBe("unknown");
  });

  it("maps attached toggles to attached_building with user_declared evidence", () => {
    const a = resolveSiteAdjacency({
      context: context({ siteTopology: { left: "attached", right: "attached" } }),
    });
    expect(kinds(a)).toEqual({
      front: "street",
      left: "attached_building",
      right: "attached_building",
      rear: "unknown",
    });
    expect(a.left.evidence.status).toBe("user_declared");
    expect(attachedSides(a)).toEqual(["left", "right"]);
  });

  it("maps open to open_space", () => {
    const a = resolveSiteAdjacency({
      context: context({ siteTopology: { left: "open", right: "unknown" } }),
    });
    expect(a.left).toEqual({
      kind: "open_space",
      evidence: { status: "user_declared", sourceAssetIds: [] },
    });
    expect(a.right.kind).toBe("unknown");
    expect(isExposableBoundary(a.left)).toBe(true);
    expect(isExposableBoundary(a.right)).toBe(false);
  });

  it("turns the open cornerSide of a corner lot into a street", () => {
    const a = resolveSiteAdjacency({
      context: context({
        siteTopology: { left: "open", right: "attached", cornerLot: true, cornerSide: "left" },
      }),
    });
    expect(kinds(a)).toEqual({
      front: "street",
      left: "street",
      right: "attached_building",
      rear: "unknown",
    });
    expect(a.left.evidence.status).toBe("user_declared");
  });

  it("never claims an unknown cornerSide as a street; cameraSitePlan agrees (P0-B)", () => {
    const ctx = context({
      siteTopology: { left: "unknown", right: "attached", cornerLot: true, cornerSide: "left" },
    });
    const a = resolveSiteAdjacency({ context: ctx });
    expect(a.left).toEqual({
      kind: "unknown",
      evidence: { status: "unknown", sourceAssetIds: [] },
    });
    const sideLeft = { viewType: "exterior_side" as const, azimuthDeg: 30 };
    expect(cameraSitePlan(sideLeft, ctx, "townhouse")).toEqual({
      mode: "unknown_side",
      side: "left",
      reason: "side_not_confirmed",
    });
    // Once the side is declared open, both call it the street side.
    const open = context({
      siteTopology: { left: "open", right: "attached", cornerLot: true, cornerSide: "left" },
    });
    expect(resolveSiteAdjacency({ context: open }).left.kind).toBe("street");
    expect(cameraSitePlan(sideLeft, open, "townhouse").mode).toBe("corner_side");
  });

  it("keeps a non-corner open side as open_space on a corner lot", () => {
    const a = resolveSiteAdjacency({
      context: context({
        siteTopology: { left: "open", right: "open", cornerLot: true, cornerSide: "right" },
      }),
    });
    expect(a.left.kind).toBe("open_space");
    expect(a.right.kind).toBe("street");
  });

  it("marks sides read from free-text neighbour notes as inferred", () => {
    const a = resolveSiteAdjacency({
      context: context({ left: { adjacentBuildings: ["nhà liền kề 4 tầng"] } }),
    });
    expect(a.left).toEqual({
      kind: "attached_building",
      evidence: { status: "inferred", sourceAssetIds: [] },
    });
  });

  it("accepts a DNA without context", () => {
    expect(kinds(resolveSiteAdjacency({}))).toEqual({
      front: "street",
      left: "unknown",
      right: "unknown",
      rear: "unknown",
    });
  });

  it("defaults undeclared sides to inferred open space for detached project types", () => {
    for (const projectType of ["villa", "single_storey_house", "prefab_modular"] as const) {
      const a = resolveSiteAdjacency({ context: context() }, projectType);
      expect(a.left).toMatchObject({
        kind: "open_space",
        evidence: { status: "inferred" },
      });
      expect(a.right).toMatchObject({
        kind: "open_space",
        evidence: { status: "inferred" },
      });
    }
  });

  it("keeps townhouse undeclared sides unknown and lets inferred attachment win", () => {
    const unknown = resolveSiteAdjacency({ context: context() }, "townhouse");
    expect(unknown.left.kind).toBe("unknown");
    expect(unknown.left.evidence.status).toBe("unknown");
    const inferred = resolveSiteAdjacency(
      { context: context({ left: { notes: "attached neighbouring townhouse" } }) },
      "villa",
    );
    expect(inferred.left).toMatchObject({
      kind: "attached_building",
      evidence: { status: "inferred" },
    });
  });

  it("keeps an explicit attached value over the detached default", () => {
    const a = resolveSiteAdjacency(
      { context: context({ siteTopology: { left: "attached" } }) },
      "villa",
    );
    expect(a.left).toMatchObject({
      kind: "attached_building",
      evidence: { status: "user_declared" },
    });
  });
});

describe("resolveSiteAdjacency — explicit site wins", () => {
  const site: SiteExtension = {
    version: 1,
    coordinateConvention: "viewer_facing_front_facade",
    front: { kind: "street", evidence: { status: "verified", sourceAssetIds: ["AST_1"] } },
    left: { kind: "open_space", evidence: { status: "verified", sourceAssetIds: ["AST_1"] } },
    right: { kind: "boundary_wall", evidence: { status: "user_declared", sourceAssetIds: [] } },
    rear: { kind: "attached_building", evidence: { status: "inferred", sourceAssetIds: [] } },
  };

  it("returns the site sides verbatim even when siteTopology disagrees", () => {
    const a = resolveSiteAdjacency({
      site,
      context: context({ siteTopology: { left: "attached", right: "attached" } }),
    });
    expect(a.source).toBe("site");
    expect(a.left).toEqual(site.left);
    expect(a.right).toEqual(site.right);
    expect(a.rear).toEqual(site.rear);
    expect(attachedSides(a)).toEqual(["rear"]);
  });
});
