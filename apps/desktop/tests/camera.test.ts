/** Phase 3 camera module: geometry, stand-in domain helpers, batch planning, Contact Sheet. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  blankCamera,
  cameraFromPreset,
  CameraDNASchema,
  compilePrompt,
  newCameraId,
  type CameraDNA,
  type GenerationDTO,
  type JobDTO,
  type ProviderDescriptorDTO,
} from "@arch/domain";
import { createProject, type ProjectBundle } from "../src/app/services";
import { EMPTY_GENERATE_DRAFT, useStudio } from "../src/app/store";
import { anchorRerunRequest, costHint, planBatch } from "../src/features/camera/batch";
import { groupContactSheet } from "../src/features/camera/contactGroups";
import {
  cameraPlacement,
  cameraToPlan,
  footprintOf,
  horizontalFovDeg,
  normalizeAzimuth,
  nudge,
  planToCamera,
  snapPosition,
} from "../src/features/camera/geometry";
import { call, setTransport } from "../src/lib/bridge";
import { knowledge } from "../src/lib/knowledge";
import { createMockTransport, MOCK_PROVIDERS } from "../src/lib/mockBackend";
import { asset, confirmAllDna } from "./helpers";

const cam = (over: Partial<CameraDNA> = {}): CameraDNA => ({
  ...blankCamera(),
  name: "Cam",
  ...over,
});

describe("camera geometry", () => {
  it.each([
    [0, 20],
    [40, 24],
    [-40, 24],
    [90, 15],
    [-90, 15],
    [135, 30],
    [180, 12],
    [-179, 8],
  ])("azimuth %d° / %d m round-trips through plan coordinates", (az, d) => {
    const back = planToCamera(cameraToPlan(az, d));
    expect(back.azimuthDeg).toBeCloseTo(normalizeAzimuth(az), 9);
    expect(back.distanceM).toBeCloseTo(d, 9);
  });

  it("puts the front camera below the footprint and +azimuth to the left", () => {
    expect(cameraToPlan(0, 10)).toEqual({ x: 0, y: 10 });
    const left = cameraToPlan(90, 10);
    expect(left.x).toBeCloseTo(-10);
    expect(left.y).toBeCloseTo(0);
    expect(cameraToPlan(180, 10).y).toBeCloseTo(-10);
  });

  it("normalizes azimuth into (-180, 180]", () => {
    expect(normalizeAzimuth(270)).toBe(-90);
    expect(normalizeAzimuth(-180)).toBe(180);
    expect(normalizeAzimuth(360)).toBe(0);
  });

  it("snaps a drag position to whole degrees and half metres, at least 1 m", () => {
    expect(snapPosition(cameraToPlan(33.4, 17.26))).toEqual({ azimuthDeg: 33, distanceM: 17.5 });
    expect(snapPosition({ x: 0, y: 0.2 }).distanceM).toBe(1);
  });

  it("nudges with the arrow keys", () => {
    const p = { azimuthDeg: 178, distanceM: 10 };
    expect(nudge(p, "ArrowLeft", false)).toEqual({ azimuthDeg: -177, distanceM: 10 });
    expect(nudge(p, "ArrowRight", true)).toEqual({ azimuthDeg: 177, distanceM: 10 });
    expect(nudge(p, "ArrowUp", false)).toEqual({ azimuthDeg: 178, distanceM: 11 });
    expect(nudge({ azimuthDeg: 0, distanceM: 1.2 }, "ArrowDown", false)?.distanceM).toBe(1);
    expect(nudge(p, "Enter", false)).toBeNull();
  });

  it("sizes the footprint from the DNA or a default; places unset cameras at a default", () => {
    const withDims = (dimensions: object) =>
      ({ building: { dimensions } }) as unknown as Parameters<typeof footprintOf>[0];
    const dna = withDims({ widthM: 20, depthM: 8 });
    expect(footprintOf(dna)).toEqual({ widthM: 20, depthM: 8, fromDna: true });
    const none = withDims({ widthM: 20 });
    expect(footprintOf(none)).toMatchObject({ widthM: 20, depthM: 10, fromDna: false });
    const pos = cameraPlacement(cam(), footprintOf(dna));
    expect(pos).toMatchObject({ azimuthDeg: 0, placed: false });
    expect(pos.distanceM).toBeGreaterThan(20);
    expect(horizontalFovDeg(18)).toBeGreaterThan(horizontalFovDeg(50));
  });
});

describe("camera presets in the Camera module", () => {
  it("every bundled pack offers presets that become valid, uniquely named cameras", () => {
    for (const type of ["villa", "townhouse", "interior", "single_storey_house"] as const) {
      const presets = knowledge.cameraPresets(type);
      expect(presets.length, type).toBeGreaterThanOrEqual(4);
      expect(presets.filter((p) => p.anchorRecommended).length, type).toBeGreaterThanOrEqual(2);
      const first = cameraFromPreset(presets[0]!, []);
      const second = cameraFromPreset(presets[0]!, [first.name]);
      expect(second.name).not.toBe(first.name);
      expect(CameraDNASchema.safeParse(second).success).toBe(true);
    }
    expect(newCameraId()).toMatch(/^CAM_[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
  });
});

// ------------------------------------------------------------------ batch planning

type Db = NonNullable<Parameters<typeof createMockTransport>[0]>;
let db: Db;

beforeEach(() => {
  db = { projects: {}, dna: {}, assets: {}, versions: [] };
  setTransport(createMockTransport(db, { generationDelayMs: 0 }));
  useStudio.setState({
    route: { name: "hub" },
    workspace: null,
    run: null,
    jobs: [],
    generateDraft: EMPTY_GENERATE_DRAFT,
  });
});
afterEach(() => setTransport(null));

const providers = (gemini: boolean): ProviderDescriptorDTO[] =>
  MOCK_PROVIDERS.map((p) => ({
    ...p,
    configured: !p.requiresApiKey || gemini,
    keySource: p.requiresApiKey && gemini ? "keychain" : null,
  }));

async function bundleWithCameras(): Promise<ProjectBundle> {
  const p = await createProject({
    name: "Cams",
    projectType: "villa",
    subtype: "tropical",
    starter: { floors: 2 },
  });
  for (const [id, role] of [
    ["AST_M", "master_architecture"],
    ["AST_A1", "regular_image"],
    ["AST_MAT", "material_reference"],
    ["AST_CTX", "context_reference"],
  ] as const)
    db.assets[id] = asset(p.id, id, { role });
  db.projects[p.id]!.activeMasterAssetId = "AST_M";
  await confirmAllDna(p.id, { approveMaster: true });
  const cameras = [
    cam({
      id: newCameraId(),
      name: "Front",
      isAnchorView: true,
      azimuthDeg: 0,
      aspectRatio: "3:2",
    }),
    cam({ id: newCameraId(), name: "Corner", isAnchorView: true, azimuthDeg: 40 }),
    cam({ id: newCameraId(), name: "Aerial", elevationDeg: 35, aspectRatio: "16:9" }),
  ];
  await call("dna_update", { projectId: p.id, dna: { ...db.dna[p.id]!, cameras } });
  return call("project_get", { projectId: p.id });
}

const params = { aspectRatio: "1:1", imageSize: "1K", outputCount: 2, seed: null, quality: null };

describe("batch dialog planning", () => {
  it("anchor batch: one item per anchor view, master only, camera aspect and section", async () => {
    const b = await bundleWithCameras();
    const plan = planBatch(
      {
        mode: "anchor",
        providerId: "local_preview",
        modelId: "placeholder-v1",
        params,
        cameraIds: [],
        extraReferenceIds: ["AST_MAT"],
      },
      b,
      [],
      providers(false),
    );
    expect(plan.issues).toEqual([]);
    expect(plan.items.map((i) => i.label)).toEqual(["Front — anchor", "Corner — anchor"]);
    expect(plan.items.every((i) => i.referenceAssetIds.join() === "AST_M")).toBe(true);
    expect(plan.items[0]!.params.aspectRatio).toBe("3:2"); // camera's own ratio
    expect(plan.items[1]!.params.aspectRatio).toBe("1:1"); // fallback
    expect(plan.items[0]!.prompt.positivePrompt).toMatch(/Camera: exterior|Camera: custom/);
    expect(plan.request).toMatchObject({ purpose: "anchor", providerId: "local_preview" });
    expect(plan.costHint).toMatch(/4 images · offline/);
  });

  it("anchor camera untick keeps only the explicitly selected camera", async () => {
    const b = await bundleWithCameras();
    const selected = b.dna.cameras.find((camera) => camera.name === "Corner")!;
    const plan = planBatch(
      {
        mode: "anchor",
        providerId: "local_preview",
        modelId: "placeholder-v1",
        params,
        cameraIds: [selected.id],
        cameraSelectionExplicit: true,
        extraReferenceIds: [],
      },
      b,
      [],
      providers(false),
    );
    expect(plan.issues).toEqual([]);
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]!.cameraId).toBe(selected.id);
  });

  it("re-runs one anchor with exactly the source provider, model and params", async () => {
    const b = await bundleWithCameras();
    const sourcePlan = planBatch(
      {
        mode: "anchor",
        providerId: "local_preview",
        modelId: "placeholder-v1",
        params,
        cameraIds: [],
        extraReferenceIds: [],
      },
      b,
      [],
      providers(false),
    );
    const source = sourcePlan.request!;
    const item = source.items[0]!;
    const rerun = anchorRerunRequest(
      {
        projectId: source.projectId,
        providerId: source.providerId,
        modelId: source.modelId,
        prompt: item.prompt,
        referenceAssetIds: item.referenceAssetIds,
        params: item.params,
      },
      item.cameraId!,
      "Front",
      "Re-run Front",
    );
    expect(rerun.items).toHaveLength(1);
    expect(rerun).toMatchObject({
      providerId: source.providerId,
      modelId: source.modelId,
      purpose: "anchor",
      items: [{ cameraId: item.cameraId, params: item.params }],
    });
  });

  it("production batch: master, then that camera's anchor, then extras, capped", async () => {
    const b = await bundleWithCameras();
    const [front, corner, aerial] = b.dna.cameras;
    const anchors = [
      { projectId: b.project.id, cameraId: front!.id, assetId: "AST_A1", approvedAt: "" },
    ];
    const plan = planBatch(
      {
        mode: "production",
        providerId: "gemini",
        modelId: "gemini-2.5-flash-image", // max 3 references
        params: { aspectRatio: "1:1", imageSize: null, outputCount: 1, seed: null, quality: null },
        cameraIds: [aerial!.id, front!.id],
        extraReferenceIds: ["AST_CTX", "AST_MAT"],
      },
      b,
      anchors,
      providers(true),
    );
    expect(plan.issues).toEqual([]);
    // DNA order, not click order; the corner camera was not chosen.
    expect(plan.items.map((i) => i.cameraId)).toEqual([front!.id, aerial!.id]);
    expect(plan.items.some((i) => i.cameraId === corner!.id)).toBe(false);
    expect(plan.items[0]!.referenceAssetIds).toEqual(["AST_M", "AST_A1", "AST_MAT"]);
    expect(plan.items[1]!.referenceAssetIds).toEqual(["AST_M", "AST_MAT", "AST_CTX"]);
    expect(plan.items[0]!.prompt.referenceInstructions.split("\n")[1]).toMatch(
      /^Image 2 .*APPROVED ANCHOR/,
    );
    expect(plan.providerCalls).toBe(2);
    expect(plan.costHint).toMatch(/2 remote calls to Google Gemini/);
  });

  it("priced models (HHTECH) add the estimated total: images × tier price", async () => {
    const b = await bundleWithCameras();
    const plan = planBatch(
      {
        mode: "production",
        providerId: "hhtech",
        modelId: "gpt-image-2",
        params: {
          aspectRatio: "16:9",
          imageSize: "4K",
          outputCount: 2,
          seed: null,
          quality: "high",
        },
        cameraIds: b.dna.cameras.map((c) => c.id),
        extraReferenceIds: [],
      },
      b,
      [],
      providers(true),
    );
    expect(plan.issues).toEqual([]);
    expect(plan.items).toHaveLength(3);
    expect(plan.items.every((i) => i.params.quality === "high")).toBe(true);
    // 3 cameras × 2 images × 800đ (GPT Image 2, 4K).
    expect(plan.costHint).toMatch(/6 remote calls to HHTECH .* ≈ 4\.800đ\.$/);
  });

  it("blocks with a reason when something is missing", async () => {
    const b = await bundleWithCameras();
    const choices = {
      mode: "production" as const,
      providerId: "gemini",
      modelId: "gemini-nano-banana-2.1",
      params,
      cameraIds: [],
      extraReferenceIds: [],
    };
    expect(planBatch(choices, b, [], providers(false)).issues[0]).toMatch(/API key/);
    const none = planBatch(
      { ...choices, providerId: "local_preview", modelId: "placeholder-v1" },
      b,
      [],
      providers(false),
    );
    expect(none.issues[0]).toMatch(/at least one camera/);
    expect(none.request).toBeNull();
  });

  it("asks for another model instead of dropping a camera's anchor", async () => {
    const b = await bundleWithCameras();
    const [front] = b.dna.cameras;
    const anchors = [
      { projectId: b.project.id, cameraId: front!.id, assetId: "AST_A1", approvedAt: "" },
    ];
    const oneRef = providers(true).map((p) => ({
      ...p,
      models: p.models.map((m) => ({ ...m, maxReferenceImages: 1 })),
    }));
    const plan = planBatch(
      {
        mode: "production",
        providerId: "gemini",
        modelId: "gemini-2.5-flash-image",
        params: { aspectRatio: "1:1", imageSize: null, outputCount: 1, seed: null, quality: null },
        cameraIds: [front!.id],
        extraReferenceIds: [],
      },
      b,
      anchors,
      oneRef,
    );
    expect(plan.request).toBeNull();
    expect(plan.items).toEqual([]);
    expect(plan.issues[0]).toMatch(/Front needs the master and its approved anchor/);
    expect(plan.issues[0]).toMatch(/Choose another model/);
  });

  it("states remote calls per image and local renders as free", () => {
    expect(costHint({ kind: "remote", label: "G" }, 3, 2)).toMatchObject({ providerCalls: 6 });
    expect(costHint({ kind: "local", label: "L" }, 3, 2).text).toMatch(/no cost/);
  });

  it("a batch queued through the store opens the Contact Sheet", async () => {
    const b = await bundleWithCameras();
    await useStudio.getState().openProject(b.project.id);
    const plan = planBatch(
      {
        mode: "anchor",
        providerId: "local_preview",
        modelId: "placeholder-v1",
        params,
        cameraIds: [],
        extraReferenceIds: [],
      },
      b,
      [],
      providers(false),
    );
    const batch = await useStudio.getState().createBatch(plan.request!);
    const s = useStudio.getState();
    expect(s.centerView).toBe("contact");
    expect(s.contactBatchId).toBe(batch!.id);
    expect(s.workspace!.batches[0]!.id).toBe(batch!.id);
    expect(s.workspace!.generations.filter((g) => g.batchId === batch!.id)).toHaveLength(2);
  });
});

describe("camera prompt section (compiler pc-1.1.0)", () => {
  it("adds the camera section after context and is deterministic", async () => {
    const b = await bundleWithCameras();
    const input = {
      project: { id: b.project.id, name: "n", projectType: b.project.projectType },
      dna: b.dna,
      references: [{ assetId: "AST_M", role: "master_architecture" as const }],
      cameraId: b.dna.cameras[2]!.id,
    };
    const one = compilePrompt(input);
    expect(one).toEqual(compilePrompt(input));
    const sections = one.metadata.sections as string[];
    expect(sections.indexOf("camera")).toBe(sections.indexOf("context") + 1);
    expect(one.metadata.cameraId).toBe(b.dna.cameras[2]!.id);
    expect(one.positivePrompt).toMatch(
      /^Camera: .*viewpoint: view from an aerial viewpoint, about 35° down/m,
    );
  });
});

describe("anchors in the mock backend", () => {
  it("drives status master_approved → anchor_generation → production", async () => {
    const b = await bundleWithCameras();
    const pid = b.project.id;
    await call("project_approve_master", { projectId: pid, approved: true });
    expect((await call("project_get", { projectId: pid })).project.status).toBe(
      "anchor_generation",
    );
    const [front, corner, aerial] = b.dna.cameras;
    await expect(
      call("camera_anchor_set", { projectId: pid, cameraId: aerial!.id, assetId: "AST_A1" }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await call("camera_anchor_set", { projectId: pid, cameraId: front!.id, assetId: "AST_A1" });
    expect((await call("project_get", { projectId: pid })).project.status).toBe(
      "anchor_generation",
    );
    const anchors = await call("camera_anchor_set", {
      projectId: pid,
      cameraId: corner!.id,
      assetId: "AST_MAT",
    });
    expect(anchors).toHaveLength(2);
    expect((await call("project_get", { projectId: pid })).project.status).toBe("production");

    // Removing a camera from the DNA drops its anchor; removing an asset cascades.
    const dna = (await call("project_get", { projectId: pid })).dna;
    await call("dna_update", {
      projectId: pid,
      dna: { ...dna, cameras: dna.cameras.filter((c) => c.id !== corner!.id) },
    });
    expect(await call("camera_anchor_list", { projectId: pid })).toHaveLength(1);
    await call("asset_remove", { projectId: pid, assetId: "AST_A1" });
    expect(await call("camera_anchor_list", { projectId: pid })).toEqual([]);
    expect((await call("project_get", { projectId: pid })).project.status).toBe(
      "anchor_generation",
    );
  });

  it("the store's setAnchor updates anchors and the status badge source", async () => {
    const b = await bundleWithCameras();
    await call("project_approve_master", { projectId: b.project.id, approved: true });
    await useStudio.getState().openProject(b.project.id);
    expect(useStudio.getState().workspace!.project.status).toBe("anchor_generation");
    const [front, corner] = b.dna.cameras;
    await useStudio.getState().setAnchor(front!.id, "AST_A1");
    await useStudio.getState().setAnchor(corner!.id, "AST_MAT");
    const ws = useStudio.getState().workspace!;
    expect(ws.anchors.map((a) => a.cameraId).sort()).toEqual([front!.id, corner!.id].sort());
    expect(ws.project.status).toBe("production");
    await useStudio.getState().clearAnchor(corner!.id);
    expect(useStudio.getState().workspace!.project.status).toBe("anchor_generation");
  });
});

describe("Contact Sheet grouping", () => {
  const gen = (id: string, cameraId: string | null, createdAt: string, batchId = "B1") =>
    ({ id, cameraId, batchId, createdAt }) as GenerationDTO;
  const job = (generationId: string): JobDTO =>
    ({ generationId, id: `J_${generationId}` }) as JobDTO;
  const cameras = [cam({ id: "C1", name: "One" }), cam({ id: "C2", name: "Two" })];

  it("groups a batch's generations per camera in DNA order, oldest first", () => {
    const groups = groupContactSheet(
      { id: "B1" },
      [
        gen("g3", "C1", "2026-01-03"),
        gen("g1", "C2", "2026-01-01"),
        gen("g2", "C1", "2026-01-02"),
        gen("gx", "C1", "2026-01-01", "OTHER"),
        gen("g4", "C9", "2026-01-04"),
      ],
      [job("g2")],
      cameras,
    );
    expect(groups.map((g) => [g.cameraId, g.camera?.name ?? null])).toEqual([
      ["C1", "One"],
      ["C2", "Two"],
      ["C9", null],
    ]);
    expect(groups[0]!.entries.map((e) => [e.generation.id, e.job?.id ?? null])).toEqual([
      ["g2", "J_g2"],
      ["g3", null],
    ]);
  });
});
