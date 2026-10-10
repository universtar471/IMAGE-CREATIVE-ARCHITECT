import { describe, expect, it } from "vitest";
import {
  buildRegionEditPrompt,
  buildRegionGenerationRequest,
  featherMask,
  isRegionResponseCurrent,
  maskCoveragePct,
  newRegionId,
  newSceneObjectId,
  rasterizeMask,
  type RegionShape,
} from "../src/lib/regions";
import { createMockTransport } from "../src/lib/mockBackend";

describe("region contract helpers", () => {
  it("creates contract ids and rasterises all shape kinds with a union", () => {
    expect(newRegionId()).toMatch(/^RGN_[0-9A-Z]{26}$/);
    expect(newSceneObjectId()).toMatch(/^OBJ_[0-9A-Z]{26}$/);
    const shapes: RegionShape[] = [
      { type: "rect", x: 0, y: 0, w: 0.5, h: 0.5 },
      {
        type: "polygon",
        points: [
          [0.5, 0.5],
          [1, 0.5],
          [1, 1],
        ],
      },
      {
        type: "brush",
        strokes: [
          {
            points: [
              [0, 1],
              [1, 1],
            ],
            radius: 0.1,
          },
        ],
      },
    ];
    const mask = rasterizeMask(shapes, 4, 4);
    expect(mask).toHaveLength(16);
    expect([...mask].some((v) => v === 255)).toBe(true);
    expect([...mask].every((v) => v === 0 || v === 255)).toBe(true);
  });

  it("feathers a hard mask without changing its dimensions", () => {
    const mask = new Uint8Array([
      0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0,
    ]);
    const feathered = featherMask(mask, 5, 5, 1);
    expect(feathered).toHaveLength(mask.length);
    expect(feathered[12]).toBeGreaterThan(0);
    expect(feathered[0]).toBeLessThan(feathered[12]!);
  });

  it("reports unfeathered mask coverage as a percent rounded to one decimal", () => {
    expect(maskCoveragePct(new Uint8Array([255, 0, 0]))).toBe(33.3);
    expect(maskCoveragePct(new Uint8Array([255, 255, 0, 0]))).toBe(50);
  });

  it("builds native and secondary-image prompts from selected regions", () => {
    const prompt = buildRegionEditPrompt({
      dna: {
        scene: {
          schemaVersion: 1,
          objects: [{ id: "OBJ_X", name: "Wall", category: "wall", relations: [] }],
        },
      },
      regions: [{ id: "RGN_X", label: "Facade", kind: "material", objectId: "OBJ_X" }],
      params: {
        regionIds: ["RGN_X"],
        instruction: "Make it brick",
        mode: "material_replace",
        material: "brick",
      },
      nativeMask: false,
    });
    expect(prompt.positivePrompt).toContain("Facade");
    expect(prompt.positivePrompt).toContain("brick");
    expect(prompt.positivePrompt).toContain("white-on-black");
    expect(prompt.preservationInstructions).toContain("outside");
    expect(prompt.metadata).toMatchObject({ nativeMask: false, maskCoveragePct: 0 });
  });

  it("uses exactly one source reference and params.region in both mask modes", () => {
    const params = {
      regionIds: ["RGN_X"],
      instruction: "Keep the geometry",
      mode: "edit" as const,
    };
    const native = buildRegionGenerationRequest({
      projectId: "p",
      providerId: "openai",
      modelId: "gpt-image-2",
      sourceAssetId: "a",
      params,
      dna: {},
      regions: [],
      nativeMask: true,
    });
    const secondary = buildRegionGenerationRequest({
      projectId: "p",
      providerId: "gemini",
      modelId: "gemini-3-pro-image",
      sourceAssetId: "a",
      params,
      dna: {},
      regions: [],
      nativeMask: false,
    });
    expect(native).toMatchObject({
      purpose: "region_edit",
      referenceAssetIds: ["a"],
      params: { region: params },
    });
    expect(native.prompt.preservationInstructions).toContain("native mask");
    expect(secondary.prompt.preservationInstructions).toContain("white-on-black");
  });

  it("rejects stale region responses", () => {
    expect(isRegionResponseCurrent("p", "a", "p", "a")).toBe(true);
    expect(isRegionResponseCurrent("p", "a", "old", "a")).toBe(false);
    expect(isRegionResponseCurrent("p", "a", "p", "b")).toBe(false);
  });

  it("persists regions through the mock command contract", async () => {
    const transport = createMockTransport({
      projects: {
        p: {
          id: "p",
          name: "P",
          projectType: "custom",
          subtype: null,
          status: "master_approved",
          activeMasterAssetId: "a",
          masterApprovedAt: "2026-01-01T00:00:00Z",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
          archivedAt: null,
        } as never,
      },
      dna: {
        p: {
          schemaVersion: 1,
          building: {},
          context: {},
          cameras: [],
          locks: {
            building: false,
            context: false,
            camera: false,
            lighting: false,
            weather: false,
            mood: false,
            colorGrade: false,
            objectIds: [],
          },
        } as never,
      },
      assets: {
        a: {
          id: "a",
          projectId: "p",
          status: "ready",
          mimeType: "image/png",
          widthPx: 4,
          heightPx: 4,
        } as never,
      },
      versions: [],
      workflow: {
        p: ["dna.building", "dna.context", "dna.references", "dna.camera", "dna.lighting"].map(
          (stepId) => ({ stepId, status: "confirmed", confirmedAt: "2026-01-01T00:00:00Z" }),
        ) as never,
      },
    });
    const saved = await transport("region_save", {
      request: {
        projectId: "p",
        assetId: "a",
        region: {
          label: "Facade",
          kind: "zone",
          objectId: null,
          shape: { type: "rect", x: 0, y: 0, w: 0.5, h: 0.5 },
        },
      },
    });
    expect(saved).toMatchObject({
      id: expect.stringMatching(/^RGN_/),
      label: "Facade",
      assetId: "a",
    });
    const listed = await transport("region_list", { request: { projectId: "p", assetId: "a" } });
    expect(listed).toHaveLength(1);
  });

  it("stores native-mask and known union coverage metadata on mock region outputs", async () => {
    const database = {
      projects: {
        p: {
          id: "p",
          name: "P",
          projectType: "custom",
          subtype: null,
          status: "master_approved",
          activeMasterAssetId: "a",
          masterApprovedAt: "2026-01-01T00:00:00Z",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
          archivedAt: null,
        },
      },
      dna: { p: { schemaVersion: 1, cameras: [] } },
      assets: {
        a: {
          id: "a",
          projectId: "p",
          source: "external",
          role: "master_architecture",
          status: "ready",
          originalName: "source.png",
          managedRelPath: "assets/source.png",
          absolutePath: "mock://source.png",
          thumbnailPath: null,
          mimeType: "image/png",
          fileSizeBytes: 1,
          widthPx: 4,
          heightPx: 4,
          sha256: null,
          parentAssetId: null,
          operation: "import",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      },
      versions: [],
      regions: [
        {
          id: "RGN_01J00000000000000000000001",
          projectId: "p",
          assetId: "a",
          label: "Left half",
          kind: "zone",
          objectId: null,
          shape: { type: "rect", x: 0, y: 0, w: 0.5, h: 1 },
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ],
    } as never;
    const transport = createMockTransport(database, { generationDelayMs: 0 });
    const request = buildRegionGenerationRequest({
      projectId: "p",
      providerId: "local_preview",
      modelId: "placeholder-v1",
      sourceAssetId: "a",
      params: {
        regionIds: ["RGN_01J00000000000000000000001"],
        instruction: "Change it",
        mode: "edit",
      },
      dna: {} as never,
      regions: [],
      nativeMask: false,
      maskCoveragePct: 50,
    });
    const queued = (await transport("generation_submit", { request })) as { id: string };
    await new Promise((resolve) => setTimeout(resolve, 20));
    const generation = (await transport("generation_get", {
      request: { projectId: "p", generationId: queued.id },
    })) as { outputAssetIds: string[] };
    const output = (
      database as { assets: Record<string, { operationJson?: unknown; meta?: unknown }> }
    ).assets[generation.outputAssetIds[0]!]!;
    expect(output.operationJson).toMatchObject({ nativeMask: false, maskCoveragePct: 50 });
    expect(output.meta).toEqual({ nativeMask: false, maskCoveragePct: 50 });
  });
});
