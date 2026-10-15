/**
 * SRS P1b (ADR-034): visibility resolver, OCCLUDED_TARGET, the SITE & OCCLUSION compiler
 * section, occlusion-aware `describeCamera`, and the site ↔ siteTopology sync.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COMPILER_VERSION,
  ProjectDNASchema,
  SITE_OCCLUSION_HEADING,
  cameraSitePlan,
  compilePrompt,
  describeCamera,
  requestedFacades,
  resolveSiteAdjacency,
  resolveSiteTopology,
  resolveVisibility,
  siteForEditing,
  siteTopologyFromSite,
  validateShot,
  withSiteBoundary,
  type CameraDNA,
  type ProjectDNA,
  type ProjectType,
  type SiteBoundary,
  type SiteExtension,
  type SiteTopology,
  type TopologyContext,
} from "../src";

/** Real townhouse DNA: front-left corner (+45), front-right corner (-45), aerial (+35). */
const townhouse = (): ProjectDNA =>
  ProjectDNASchema.parse(
    JSON.parse(
      readFileSync(
        new URL("../../../apps/desktop/tests/fixtures/nhapho-dna.json", import.meta.url),
        "utf8",
      ),
    ),
  );
const FRONT_LEFT = "CAM_01M4K1Q5C6PGJBEGD65E0JFSY0";
const FRONT_RIGHT = "CAM_01M4K1QAHYASB70RRGAWGASY57";
const AERIAL = "CAM_01M4K1QEPT19H0EZY58K5NR0PW";
const SIDE_LEFT = "CAM_01M4K1QS1DEVEZ9ZMEPFT1E7X0";
const REAR = "CAM_01M4K1QS1DEVEZ9ZMEPFT1E7X1";
const FRONT = "CAM_01M4K1QS1DEVEZ9ZMEPFT1E7X2";

const extraCameras: CameraDNA[] = [
  {
    schemaVersion: 1,
    id: SIDE_LEFT,
    name: "Left side",
    viewType: "exterior_side",
    azimuthDeg: 90,
    isAnchorView: false,
    composition: "left side elevation",
    notes: "",
  },
  {
    schemaVersion: 1,
    id: REAR,
    name: "Rear",
    viewType: "exterior_rear",
    azimuthDeg: 180,
    isAnchorView: false,
    notes: "",
  },
  {
    schemaVersion: 1,
    id: FRONT,
    name: "Front",
    viewType: "exterior_front",
    azimuthDeg: 0,
    heightM: 1.6,
    isAnchorView: false,
    notes: "",
  },
];

const withTopology = (topology: SiteTopology | null): ProjectDNA => {
  const dna = townhouse();
  dna.cameras.push(...structuredClone(extraCameras));
  if (topology) dna.context.siteTopology = topology;
  else {
    dna.context.left.adjacentBuildings = [];
    dna.context.right.adjacentBuildings = [];
  }
  return dna;
};

const boundary = (
  kind: SiteBoundary["kind"],
  status: SiteBoundary["evidence"]["status"] = "verified",
): SiteBoundary => ({ kind, evidence: { status, sourceAssetIds: [] } });

const site = (sides: Partial<Record<"front" | "left" | "right" | "rear", SiteBoundary>>) =>
  ({
    version: 1,
    coordinateConvention: "viewer_facing_front_facade",
    front: boundary("street"),
    left: boundary("unknown", "unknown"),
    right: boundary("unknown", "unknown"),
    rear: boundary("unknown", "unknown"),
    ...sides,
  }) satisfies SiteExtension;

const camera = (dna: ProjectDNA, id: string) => dna.cameras.find((c) => c.id === id)!;

/** The positive prompt's camera paragraph. */
const cameraLine = (positivePrompt: string) =>
  positivePrompt.split("\n\n").find((p) => p.startsWith("Camera:")) ?? "";

const compile = (dna: ProjectDNA, cameraId: string, master = true) =>
  compilePrompt({
    project: { id: "PRJ_SITE", name: "Site", projectType: "townhouse", subtype: "default" },
    dna,
    references: master ? [{ assetId: "AST_MASTER", role: "master_architecture" }] : [],
    cameraId,
  });

const MID_BLOCK: SiteTopology = { left: "attached", right: "attached", cornerLot: false };
const CORNER_LEFT: SiteTopology = {
  left: "open",
  right: "attached",
  cornerLot: true,
  cornerSide: "left",
};

// ---------------------------------------------------------------- resolver

describe("resolveVisibility", () => {
  it("names the facades a camera angle points at", () => {
    const at = (azimuthDeg: number, viewType: CameraDNA["viewType"] = "exterior_corner") =>
      requestedFacades({ viewType, azimuthDeg });
    expect(at(0, "exterior_front")).toEqual(["front"]);
    expect(at(45)).toEqual(["front", "left"]);
    expect(at(-45)).toEqual(["front", "right"]);
    expect(at(90, "exterior_side")).toEqual(["left"]);
    expect(at(-135, "exterior_rear")).toEqual(["right", "rear"]);
    expect(at(180, "exterior_rear")).toEqual(["rear"]);
    expect(requestedFacades({ viewType: "aerial", azimuthDeg: 35 })).toEqual([
      "front",
      "left",
      "roof",
    ]);
    expect(
      requestedFacades({ viewType: "exterior_corner", presetId: "front_right_corner" }),
    ).toEqual(["front", "right"]);
    expect(requestedFacades({ viewType: "interior_wide", azimuthDeg: 45 })).toEqual([]);
  });

  it("never shows an attached side", () => {
    const adjacency = resolveSiteAdjacency(withTopology(MID_BLOCK));
    for (const azimuthDeg of [45, 90, -45, -90, 135, -135]) {
      const v = resolveVisibility(adjacency, { viewType: "exterior_side", azimuthDeg });
      expect(v.visibleFacades, String(azimuthDeg)).not.toContain("left");
      expect(v.visibleFacades, String(azimuthDeg)).not.toContain("right");
    }
    const v = resolveVisibility(adjacency, { viewType: "exterior_corner", azimuthDeg: 45 });
    expect(v.visibleFacades).toEqual(["front"]);
    expect(v.occludedFacades).toEqual(["left"]);
    expect(v.warnings).toContainEqual({ code: "attached_side_hidden", facade: "left" });
  });

  it("shows only street or open-space sides and never claims unknown or walled sides", () => {
    const adjacency = resolveSiteAdjacency({
      site: site({
        left: boundary("street"),
        right: boundary("boundary_wall"),
        rear: boundary("open_space"),
      }),
    });
    const at = (azimuthDeg: number) =>
      resolveVisibility(adjacency, { viewType: "exterior_side", azimuthDeg });
    expect(at(45).visibleFacades).toEqual(["front", "left"]);
    expect(at(-45).visibleFacades).toEqual(["front"]);
    expect(at(-45).occludedFacades).toEqual(["right"]);
    expect(at(-45).warnings).toContainEqual({ code: "boundary_wall", facade: "right" });
    expect(at(180).visibleFacades).toEqual(["rear"]);
    const unknown = resolveVisibility(resolveSiteAdjacency({ site: site({}) }), {
      viewType: "exterior_corner",
      azimuthDeg: 45,
    });
    expect(unknown.occludedFacades).toEqual(["left"]);
    expect(unknown.warnings).toContainEqual({ code: "side_unknown", facade: "left" });
  });

  it("lowers confidence for unknown or unconfirmed sides and never reaches 1", () => {
    const confirmed = resolveVisibility(
      resolveSiteAdjacency({ site: site({ left: boundary("open_space") }) }),
      { viewType: "exterior_corner", azimuthDeg: 45 },
    );
    const inferred = resolveVisibility(
      resolveSiteAdjacency({ site: site({ left: boundary("open_space", "inferred") }) }),
      { viewType: "exterior_corner", azimuthDeg: 45 },
    );
    const unknown = resolveVisibility(resolveSiteAdjacency({ site: site({}) }), {
      viewType: "exterior_corner",
      azimuthDeg: 45,
    });
    expect(confirmed.confidence).toBe(0.9);
    expect(inferred.confidence).toBeLessThan(confirmed.confidence);
    expect(unknown.confidence).toBeLessThan(inferred.confidence);
    expect(inferred.warnings).toContainEqual({ code: "evidence_unconfirmed", facade: "left" });
    // An attached neighbour without a height relation: partial occlusion is approximate.
    const attached = resolveVisibility(
      resolveSiteAdjacency({ site: site({ left: boundary("attached_building") }) }),
      { viewType: "exterior_corner", azimuthDeg: 45 },
    );
    expect(attached.warnings).toContainEqual({ code: "neighbour_height_unknown", facade: "left" });
    expect(attached.confidence).toBeLessThan(0.9);
  });

  it("lists feasible camera zones and is deterministic", () => {
    const adjacency = resolveSiteAdjacency(withTopology(MID_BLOCK));
    const cam = { viewType: "exterior_corner" as const, azimuthDeg: 45 };
    const v = resolveVisibility(adjacency, cam);
    // Rear and sides are attached or unknown: only views from the street and above remain.
    expect(v.feasibleCameraZones).toEqual(["front", "front_left", "front_right", "aerial"]);
    expect(JSON.stringify(resolveVisibility(adjacency, cam))).toBe(JSON.stringify(v));
    expect(resolveVisibility(adjacency, null)).toMatchObject({
      visibleFacades: [],
      occludedFacades: [],
      warnings: [],
    });
  });
});

// ---------------------------------------------------------------- AC-03 / AC-04

describe("AC-03 attached townhouse, AC-04 corner lot", () => {
  it("AC-03: a mid-block townhouse at 45° never shows a side facade", () => {
    const dna = withTopology(MID_BLOCK);
    for (const id of [FRONT_LEFT, FRONT_RIGHT, AERIAL, FRONT]) {
      const v = resolveVisibility(resolveSiteAdjacency(dna), camera(dna, id));
      expect(
        v.visibleFacades.filter((f) => f === "left" || f === "right"),
        id,
      ).toEqual([]);
      for (const master of [true, false]) {
        const b = compile(dna, id, master);
        // The subject keeps its view-type framing ("exterior three-quarter view", ADR-028);
        // the camera paragraph and the preservation text must not promise a side.
        const all = [cameraLine(b.positivePrompt), b.preservationInstructions].join("\n");
        expect(all, id).not.toMatch(/two exposed fa[cç]ades|three-quarter/i);
        expect(all, id).not.toContain("showing the front facade and the left side");
        expect(all, id).not.toContain("showing the front facade and the right side");
        expect(b.preservationInstructions, id).toContain(SITE_OCCLUSION_HEADING);
        expect(b.preservationInstructions, id).toContain(
          "The building is attached to neighbouring buildings on both sides. Keep the party walls hidden",
        );
        expect(b.preservationInstructions, id).toContain(
          "Never clear neighbouring plots or relocate contextual buildings to reveal a side facade.",
        );
      }
    }
    const left = compile(dna, FRONT_LEFT);
    expect(left.preservationInstructions).toContain(
      "Use an oblique street-level viewpoint of the front facade only. The oblique camera angle does not imply an exposed side elevation.",
    );
    expect(left.negativePrompt).toContain("exposed side wall");
  });

  it("AC-04: a verified corner lot shows its street side and only that one", () => {
    const dna = withTopology(null);
    dna.site = site({ left: boundary("street"), right: boundary("attached_building") });
    dna.context.siteTopology = siteTopologyFromSite(dna.site);
    const adjacency = resolveSiteAdjacency(dna);
    expect(resolveVisibility(adjacency, camera(dna, FRONT_LEFT)).visibleFacades).toEqual([
      "front",
      "left",
    ]);
    expect(resolveVisibility(adjacency, camera(dna, FRONT_RIGHT)).visibleFacades).toEqual([
      "front",
    ]);

    const left = compile(dna, FRONT_LEFT);
    expect(left.positivePrompt).toContain("front-left three-quarter view");
    expect(left.preservationInstructions).toContain(
      "This is a corner plot: a side street runs along the left side; reveal that side facade consistently with Image 1.",
    );
    // The attached right side stays hidden, without forbidding the real street side.
    expect(left.preservationInstructions).toContain(
      "do not expose a facade or windows on the right side",
    );
    expect(left.preservationInstructions).not.toContain("do not expose a side facade");

    const right = compile(dna, FRONT_RIGHT);
    expect(cameraLine(right.positivePrompt)).not.toContain("three-quarter");
    expect(right.positivePrompt).toContain("the right side wall stays hidden");
    expect(right.preservationInstructions).not.toContain("corner plot: a side street");
  });
});

describe("detached project defaults preserve corner-camera wording", () => {
  it("keeps the legacy three-quarter wording for an undeclared villa", () => {
    const dna = withTopology(null);
    const compiled = compilePrompt({
      project: { id: "PRJ_VILLA", name: "Villa", projectType: "villa" },
      dna,
      references: [],
      cameraId: FRONT_LEFT,
    });
    expect(compiled.positivePrompt).toContain("front-left three-quarter view");
    expect(resolveSiteAdjacency(dna, "villa").left).toMatchObject({
      kind: "open_space",
      evidence: { status: "inferred" },
    });
  });

  it("blocks an explicitly attached villa side while inferred open remains visible", () => {
    const dna = withTopology(null);
    dna.context.siteTopology = { left: "attached", right: "unknown", cornerLot: false };
    const result = validateShot({
      dna,
      shotIntent: { projectType: "villa", cameraId: SIDE_LEFT },
    });
    expect(result.verdict).toBe("BLOCK");
    expect(result.issues.map((issue) => issue.code)).toEqual(["ADJACENT_BUILDING_CONFLICT"]);
  });
});

// ---------------------------------------------------------------- compiler section

/** The ADR-028 party-wall wording exactly as pc-1.6.0 produced it (with a master). */
function legacyLines(cam: CameraDNA, context: TopologyContext, projectType: ProjectType) {
  const plan = cameraSitePlan(cam, context, projectType);
  const image = "Image 1";
  if (plan.mode === "oblique_street") {
    const topology = resolveSiteTopology(context);
    const sideText =
      topology.left === "attached" && topology.right === "attached"
        ? "both sides"
        : plan.side
          ? `the ${plan.side} side`
          : "both sides";
    const hidden = plan.side === "left" ? "front-left" : "front-right";
    return [
      `The building is attached to neighbouring buildings on ${sideText}. Keep the party walls hidden and attached to the same neighbours; do not expose a side facade or side windows. Do not create a side setback, side yard, gap, passage, alley, or detached corner condition.`,
      `Camera viewpoint: ${hidden} oblique street view from eye level, about 30–35° off the facade axis, looking along the street. Composition: front facade dominant; the ${plan.side ?? "side"} side wall stays hidden behind the attached neighbour.`,
    ];
  }
  if (plan.mode === "aerial_block")
    return [
      `Keep the same continuous mid-block street and neighbourhood shown in ${image}. The subject remains between the same left and right neighbours, at the same street frontage. Extend the existing block naturally into areas outside ${image}; do not create a corner lot, street junction, side street, vacant plot, new boundary, or new access road. Keep the neighbours as separate buildings and preserve their visible footprints and roof forms.`,
    ];
  if (plan.mode === "corner_side" && plan.side)
    return [
      `This is a corner plot: a side street runs along the ${plan.side} side; reveal that side facade consistently with ${image}.`,
    ];
  if (plan.mode === "unknown_side" && plan.side)
    return [
      `Do not invent a corner plot, side street or new neighbour arrangement; reveal the ${plan.side} side only as a plain continuation consistent with ${image}.`,
    ];
  return [];
}

const TOPOLOGIES: SiteTopology[] = [
  MID_BLOCK,
  { left: "attached", right: "unknown", cornerLot: false },
  { left: "unknown", right: "attached", cornerLot: false },
  { left: "attached", right: "open", cornerLot: false },
  { left: "unknown", right: "open", cornerLot: false },
  { left: "open", right: "open", cornerLot: false },
  { left: "unknown", right: "unknown", cornerLot: false },
  CORNER_LEFT,
  { left: "attached", right: "open", cornerLot: true, cornerSide: "right" },
];

describe("SITE & OCCLUSION section keeps every ADR-028 constraint", () => {
  it("contains each pc-1.6.0 line verbatim, or its documented stricter rewrite", () => {
    let verbatim = 0;
    let rewritten = 0;
    for (const topology of TOPOLOGIES) {
      for (const id of [FRONT_LEFT, FRONT_RIGHT, AERIAL, SIDE_LEFT, FRONT]) {
        const dna = withTopology(topology);
        const label = `${JSON.stringify(topology)} ${id}`;
        const now = compile(dna, id).preservationInstructions;
        for (const line of legacyLines(camera(dna, id), dna.context, "townhouse")) {
          if (now.includes(line)) {
            verbatim++;
            continue;
          }
          rewritten++;
          const unknown = line.match(
            /^Do not invent (.+); reveal the (\w+) side only as a plain continuation consistent with (Image \d+)\.$/,
          );
          if (unknown) {
            // Unknown side: same prohibitions, and the side is no longer claimed as shown.
            expect(now, label).toContain(
              `The ${unknown[2]} side is not confirmed: do not invent ${unknown[1]}, and do not present the ${unknown[2]} side as an exposed facade`,
            );
            expect(now, label).toContain(`plain continuation consistent with ${unknown[3]}.`);
            continue;
          }
          const party = line.match(
            /^The building is attached to neighbouring buildings on the (\w+) side\./,
          );
          // Scoped party wall: only when the other side is free (open or street), where a
          // global "no side facade" would contradict the site data.
          expect(party, `${label}: unexpected rewrite of\n${line}\n---\n${now}`).not.toBeNull();
          const other = party![1] === "left" ? "right" : "left";
          expect(topology[other], label).toBe("open");
          expect(now, label).toContain(party![0]);
          expect(now, label).toContain(
            `Keep the party walls hidden and attached to the same neighbours; do not expose a facade or windows on the ${party![1]} side. Do not create a setback, yard, gap, passage, or alley on the ${party![1]} side.`,
          );
        }
      }
    }
    expect(verbatim).toBeGreaterThan(10);
    expect(rewritten).toBeGreaterThan(0);
  });

  it("compiles the same prompt from site data synced from unchanged toggles", () => {
    for (const topology of TOPOLOGIES) {
      for (const id of [FRONT_LEFT, FRONT_RIGHT, AERIAL, SIDE_LEFT, REAR]) {
        const legacy = withTopology(topology);
        const synced = withTopology(topology);
        synced.site = siteForEditing(synced);
        const a = compile(legacy, id);
        const b = compile(synced, id);
        const label = `${JSON.stringify(topology)} ${id}`;
        expect(b.positivePrompt, label).toBe(a.positivePrompt);
        expect(b.preservationInstructions, label).toBe(a.preservationInstructions);
        expect(b.negativePrompt, label).toBe(a.negativePrompt);
      }
    }
  });

  it("words the section without a master image and only for exterior cameras", () => {
    const dna = withTopology(MID_BLOCK);
    const aerial = compile(dna, AERIAL, false).preservationInstructions;
    expect(aerial).toContain("Keep the same continuous mid-block street and neighbourhood.");
    expect(aerial).not.toMatch(/Image \d/);
    expect(compile(dna, FRONT_LEFT, false).preservationInstructions).toContain(
      "The building is attached to neighbouring buildings on both sides.",
    );
    const noCamera = compilePrompt({
      project: { id: "PRJ_SITE", name: "Site", projectType: "townhouse" },
      dna,
      references: [],
    });
    expect(noCamera.preservationInstructions).not.toContain(SITE_OCCLUSION_HEADING);
    const interior = compilePrompt({
      project: { id: "PRJ_SITE", name: "Site", projectType: "interior" },
      dna,
      references: [],
      cameraId: FRONT_LEFT,
    });
    expect(interior.preservationInstructions).not.toContain(SITE_OCCLUSION_HEADING);
  });

  it("adds nothing for a detached house seen from its open sides", () => {
    const dna = withTopology({ left: "open", right: "open", cornerLot: false });
    for (const id of [FRONT_LEFT, FRONT_RIGHT, SIDE_LEFT, FRONT])
      expect(compile(dna, id).preservationInstructions, id).not.toContain(SITE_OCCLUSION_HEADING);
  });

  it("covers boundary walls and the rear from the site extension", () => {
    const dna = withTopology(null);
    dna.site = site({
      left: boundary("boundary_wall"),
      right: boundary("open_space"),
      rear: boundary("attached_building"),
    });
    const left = compile(dna, FRONT_LEFT).preservationInstructions;
    expect(left).toContain(
      "A boundary wall runs along the left side: keep the wall and do not expose the left facade behind it.",
    );
    expect(left).toContain("The building is attached to neighbouring buildings on the rear.");
    expect(left).toContain("do not expose a facade or windows on the rear");
  });

  it("is versioned pc-1.7.0 and byte-stable", () => {
    expect(COMPILER_VERSION).toBe("pc-1.7.0");
    const dna = withTopology(CORNER_LEFT);
    expect(JSON.stringify(compile(dna, FRONT_LEFT))).toBe(
      JSON.stringify(compile(structuredClone(dna), FRONT_LEFT)),
    );
  });
});

// ---------------------------------------------------------------- describeCamera

describe("describeCamera never promises an occluded facade", () => {
  const visibilityFor = (s: SiteExtension, cam: CameraDNA) =>
    resolveVisibility(resolveSiteAdjacency({ site: s }), cam);
  const corner: CameraDNA = {
    schemaVersion: 1,
    id: FRONT_LEFT,
    name: "Corner",
    viewType: "exterior_corner",
    azimuthDeg: 45,
    heightM: 1.6,
    isAnchorView: false,
    composition: "two-point perspective showing the front facade and the left side",
    notes: "",
  };

  it("keeps the plain wording without site knowledge or when the side is free", () => {
    expect(describeCamera(corner)).toContain("front-left three-quarter view from eye level");
    const open = visibilityFor(site({ left: boundary("open_space") }), corner);
    expect(describeCamera(corner, open)).toBe(describeCamera(corner));
  });

  it("narrows an attached or walled side to the front facade only", () => {
    for (const kind of ["attached_building", "boundary_wall"] as const) {
      const text = describeCamera(corner, visibilityFor(site({ left: boundary(kind) }), corner));
      expect(text, kind).toContain(
        "viewpoint: front-left oblique view of the front facade only from eye level",
      );
      expect(text, kind).toContain("composition: front facade dominant");
      expect(text, kind).not.toMatch(/three-quarter|left side/);
    }
  });

  it("neither promises nor forbids an unknown side", () => {
    const text = describeCamera(corner, visibilityFor(site({}), corner));
    expect(text).toContain("front-left oblique view centred on the front facade");
    expect(text).not.toMatch(/three-quarter|left side/);
  });

  it("says a side camera's hidden facade is not shown", () => {
    const side: CameraDNA = { ...corner, viewType: "exterior_side", azimuthDeg: 90 };
    const text = describeCamera(
      side,
      visibilityFor(site({ left: boundary("attached_building") }), side),
    );
    expect(text).toContain(
      "viewpoint: left-side viewpoint from eye level; the left facade is not shown",
    );
    expect(text).not.toContain("composition:");
  });
});

// ---------------------------------------------------------------- validator

describe("OCCLUDED_TARGET", () => {
  const run = (dna: ProjectDNA, cameraId: string | null, extraPrompt?: string) =>
    validateShot({ dna, shotIntent: { projectType: "townhouse", cameraId }, extraPrompt });
  const codes = (r: ReturnType<typeof run>) => r.issues.map((i) => `${i.severity}:${i.code}`);

  it("warns when a side camera aims at an unknown or walled side", () => {
    const unknown = run(withTopology(null), SIDE_LEFT);
    expect(codes(unknown)).toEqual(["WARN:OCCLUDED_TARGET"]);
    expect(unknown.issues[0]).toMatchObject({
      path: "cameras[3]",
      params: { source: "camera", facade: "left", kind: "unknown", viewType: "exterior_side" },
      exceptionAllowed: true,
    });
    const walled = withTopology(null);
    walled.site = site({ left: boundary("boundary_wall") });
    expect(codes(run(walled, SIDE_LEFT))).toEqual(["WARN:OCCLUDED_TARGET"]);
    // The derived rear is unknown, so a rear camera is warned too.
    expect(codes(run(withTopology(MID_BLOCK), REAR))).toEqual(["WARN:OCCLUDED_TARGET"]);
  });

  it("leaves attached sides to ADJACENT_BUILDING_CONFLICT and allows free sides", () => {
    expect(codes(run(withTopology(MID_BLOCK), SIDE_LEFT))).toEqual([
      "BLOCK:ADJACENT_BUILDING_CONFLICT",
    ]);
    expect(codes(run(withTopology(CORNER_LEFT), SIDE_LEFT))).toEqual([]);
    // Corner and front cameras target the front facade.
    for (const id of [FRONT_LEFT, FRONT_RIGHT, AERIAL, FRONT])
      expect(codes(run(withTopology(null), id)), id).toEqual([]);
  });

  it("warns when the extra prompt asks for a hidden side or rear facade", () => {
    const unknown = withTopology(null);
    for (const text of ["show the left side facade", "lộ mặt hông trái", "render the rear facade"])
      expect(codes(run(unknown, FRONT, text)), text).toEqual(["WARN:OCCLUDED_TARGET"]);
    expect(run(unknown, FRONT, "render the rear facade").issues[0]!.params).toMatchObject({
      source: "extraPrompt",
      facade: "rear",
    });
    // Free sides are fine; a harmless "behind" is not a rear request.
    const free = withTopology(null);
    free.site = site({ left: boundary("street"), rear: boundary("open_space") });
    for (const text of ["show the left side facade", "show the rear facade", "cây xanh phía sau"])
      expect(codes(run(free, FRONT, text)), text).toEqual([]);
    expect(codes(run(withTopology(MID_BLOCK), FRONT, "cây xanh phía sau"))).toEqual([]);
  });

  it("does not double-report a request that only attached sides could satisfy", () => {
    expect(codes(run(withTopology(MID_BLOCK), FRONT_LEFT, "show the side facade"))).toEqual([
      "BLOCK:ADJACENT_BUILDING_CONFLICT",
    ]);
    // Left attached, right unknown: neither side can be shown; the unknown one is warned.
    const mixedDna = withTopology(null);
    mixedDna.context.siteTopology = { left: "attached", right: "unknown", cornerLot: false };
    const mixed = run(mixedDna, FRONT, "show the side facade");
    expect(codes(mixed)).toEqual(["WARN:OCCLUDED_TARGET"]);
    expect(mixed.issues[0]!.params).toMatchObject({ facade: "right" });
  });

  it("records the warning in the compiled bundle's resolvedWarnings", () => {
    expect(compile(withTopology(null), SIDE_LEFT).resolvedWarnings).toEqual(["OCCLUDED_TARGET"]);
    expect(compile(withTopology(MID_BLOCK), FRONT_LEFT).resolvedWarnings).toEqual([]);
  });
});

// ---------------------------------------------------------------- site sync

describe("site ↔ siteTopology sync", () => {
  it("maps kinds conservatively and derives the corner lot from a street side", () => {
    expect(
      siteTopologyFromSite(
        site({ left: boundary("street"), right: boundary("attached_building") }),
      ),
    ).toEqual({ left: "open", right: "attached", cornerLot: true, cornerSide: "left" });
    expect(
      siteTopologyFromSite(
        site({ left: boundary("boundary_wall"), right: boundary("open_space") }),
      ),
    ).toEqual({ left: "unknown", right: "open", cornerLot: false });
  });

  it("round-trips the ADR-028 toggles through the site extension", () => {
    for (const topology of TOPOLOGIES) {
      // Without attached-neighbour text, so nothing is inferred over the toggles.
      const dna = withTopology(null);
      dna.context.siteTopology = topology;
      const synced = siteTopologyFromSite(siteForEditing(dna));
      expect(synced, JSON.stringify(topology)).toEqual(resolveSiteTopologyShape(topology));
    }
  });

  it("changes one side and drops data that described the previous kind", () => {
    const base = site({
      left: {
        ...boundary("attached_building"),
        heightRelation: "taller",
        neighborObjectId: "OBJ_1",
      },
    });
    const kept = withSiteBoundary(base, "left", { status: "inferred" });
    expect(kept.left).toMatchObject({ kind: "attached_building", heightRelation: "taller" });
    expect(kept.left.evidence.status).toBe("inferred");
    const changed = withSiteBoundary(base, "left", { kind: "street" });
    expect(changed.left).toEqual({ kind: "street", evidence: base.left.evidence });
    expect(base.left.kind).toBe("attached_building");
  });
});

/** What the sync writes back for a toggle set (a corner side is only kept when open). */
function resolveSiteTopologyShape(t: SiteTopology): SiteTopology {
  const corner = t.cornerLot && t.cornerSide && t[t.cornerSide] === "open" ? t.cornerSide : null;
  return {
    left: t.left ?? "unknown",
    right: t.right ?? "unknown",
    cornerLot: corner !== null,
    ...(corner ? { cornerSide: corner } : {}),
  };
}
