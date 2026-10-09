import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { COMPILER_VERSION, type GenerationSubmitRequest, type PromptBundle } from "@arch/domain";
import { createProject } from "../src/app/services";
import {
  BridgeError,
  call,
  providerNeedingKey,
  setTransport,
  type Transport,
} from "../src/lib/bridge";
import { createMockTransport } from "../src/lib/mockBackend";
import { settled } from "./helpers";

const SECRET = "sk-test-0123456789-should-never-be-stored";
let transport: Transport;
let db: Parameters<typeof createMockTransport>[0] & object;

beforeEach(() => {
  db = { projects: {}, dna: {}, assets: {}, versions: [] };
  transport = createMockTransport(db, { generationDelayMs: 0 });
  setTransport(transport);
});

afterEach(() => setTransport(null));

const prompt = (positivePrompt = "A tropical villa"): PromptBundle => ({
  compilerVersion: COMPILER_VERSION,
  positivePrompt,
  negativePrompt: "blurry",
  referenceInstructions: "",
  preservationInstructions: "",
  metadata: {},
});

async function newProject() {
  return createProject({
    name: "Gen test",
    projectType: "villa",
    subtype: "tropical",
    starter: { floors: 2 },
  });
}

const request = (projectId: string, over: Partial<GenerationSubmitRequest> = {}) =>
  ({
    projectId,
    providerId: "local_preview",
    modelId: "placeholder-v1",
    purpose: "variation",
    prompt: prompt(),
    referenceAssetIds: [],
    params: { aspectRatio: "16:9", imageSize: "1K", outputCount: 2, seed: 3, quality: null },
    cameraId: null,
    ...over,
  }) satisfies GenerationSubmitRequest;

async function errorOf(p: Promise<unknown>): Promise<BridgeError> {
  try {
    await p;
  } catch (e) {
    return e as BridgeError;
  }
  throw new Error("expected the call to fail");
}

describe("bridge parsing of Phase 2 responses", () => {
  it("rejects a malformed provider list as VALIDATION_ERROR", async () => {
    setTransport(async () => [{ id: "x", label: "X" }]);
    const err = await errorOf(call("provider_list", {}));
    expect(err).toBeInstanceOf(BridgeError);
    expect(err.code).toBe("VALIDATION_ERROR");
  });

  it("parses versions with a generationId", async () => {
    setTransport(async () => [
      {
        id: "VER_1",
        projectId: "P",
        assetId: "A",
        parentVersionId: null,
        label: null,
        operation: "import",
        generationId: null,
        createdAt: "2026-10-08T00:00:00Z",
      },
    ]);
    const [v] = await call("version_list", { projectId: "P" });
    expect(v!.generationId).toBeNull();
  });

  it("turns PROVIDER_NOT_CONFIGURED into the provider that needs a key", () => {
    const err = new BridgeError({
      code: "PROVIDER_NOT_CONFIGURED",
      message: "no key",
      details: { providerId: "gemini" },
    });
    expect(providerNeedingKey(err, "other")).toBe("gemini");
    expect(
      providerNeedingKey(new BridgeError({ code: "PROVIDER_NOT_CONFIGURED", message: "" }), "x"),
    ).toBe("x");
    expect(providerNeedingKey(new BridgeError({ code: "NOT_FOUND", message: "" }), "x")).toBeNull();
  });
});

describe("mock providers", () => {
  it("lists gemini, openai and hhtech (unconfigured) and local_preview (always configured)", async () => {
    const list = await call("provider_list", {});
    expect(list.map((p) => [p.id, p.configured, p.keySource])).toEqual([
      ["gemini", false, null],
      ["openai", false, null],
      ["hhtech", false, null],
      ["local_preview", true, null],
    ]);
  });

  it("stores only a boolean for a key, never the string", async () => {
    const p = await call("provider_set_api_key", { providerId: "gemini", apiKey: SECRET });
    expect(p.configured).toBe(true);
    expect(p.keySource).toBe("keychain");
    expect(JSON.stringify(db)).not.toContain(SECRET);
    expect(JSON.stringify(p)).not.toContain(SECRET);
    expect(localStorage.getItem("arch-studio-mock-db-v1") ?? "").not.toContain(SECRET);

    expect((await call("provider_test", { providerId: "gemini" })).ok).toBe(true);
    const cleared = await call("provider_clear_api_key", { providerId: "gemini" });
    expect(cleared.configured).toBe(false);
    const test = await call("provider_test", { providerId: "gemini" });
    expect(test).toEqual({ ok: false, message: expect.stringMatching(/No API key/) });
  });

  it("rejects an empty key", async () => {
    const err = await errorOf(call("provider_set_api_key", { providerId: "gemini", apiKey: " " }));
    expect(err.code).toBe("VALIDATION_ERROR");
  });
});

describe("mock generation_submit", () => {
  it("creates outputs, versions with lineage and a history entry", async () => {
    const p = await newProject();
    // Seed a master asset directly (browser file import needs a real Image decoder).
    db.assets["AST_M"] = {
      id: "AST_M",
      projectId: p.id,
      source: "external",
      role: "master_architecture",
      status: "ready",
      originalName: "master.jpg",
      managedRelPath: "assets/original/AST_M.jpg",
      absolutePath: "blob:master",
      thumbnailPath: "data:thumb",
      mimeType: "image/jpeg",
      fileSizeBytes: 10,
      widthPx: 1600,
      heightPx: 900,
      sha256: "x",
      parentAssetId: null,
      operation: "import",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    db.versions.push({
      id: "VER_M",
      projectId: p.id,
      assetId: "AST_M",
      parentVersionId: null,
      label: "master.jpg",
      operation: "import",
      generationId: null,
      createdAt: "2026-01-01T00:00:00Z",
    });

    const queued = await call(
      "generation_submit",
      request(p.id, { purpose: "hero", referenceAssetIds: ["AST_M"] }),
    );
    expect(queued).toMatchObject({ status: "queued", startedAt: null, outputAssetIds: [] });
    const g = await settled(p.id, queued.id);
    expect(g.status).toBe("completed");
    expect(g.parentAssetId).toBe("AST_M");
    expect(g.outputAssetIds).toHaveLength(2);
    expect(g.durationMs).not.toBeNull();

    const assets = await call("asset_list", { projectId: p.id });
    const out = assets.find((a) => a.id === g.outputAssetIds[0])!;
    expect(out).toMatchObject({
      source: "ai_generated",
      role: "regular_image",
      operation: "generate",
      parentAssetId: "AST_M",
      widthPx: 1024,
      heightPx: 576,
    });

    const versions = await call("version_list", { projectId: p.id });
    const outVersions = versions.filter((v) => v.generationId === g.id);
    expect(outVersions).toHaveLength(2);
    expect(outVersions.every((v) => v.parentVersionId === "VER_M")).toBe(true);

    const history = await call("generation_list", { projectId: p.id });
    expect(history.map((h) => h.id)).toEqual([g.id]);
    expect((await call("generation_get", { projectId: p.id, generationId: g.id })).status).toBe(
      "completed",
    );
  });

  it("returns a failed generation (not an error) for a [fail] prompt", async () => {
    const p = await newProject();
    const q = await call("generation_submit", request(p.id, { prompt: prompt("x [fail] y") }));
    const g = await settled(p.id, q.id);
    expect(g.status).toBe("failed");
    expect(g.error).toMatchObject({ kind: "bad_response", retryable: true });
    expect(g.outputAssetIds).toEqual([]);
    expect((await call("generation_list", { projectId: p.id }))[0]!.status).toBe("failed");
  });

  it("rejects an unconfigured provider with PROVIDER_NOT_CONFIGURED and records nothing", async () => {
    const p = await newProject();
    const err = await errorOf(
      call(
        "generation_submit",
        request(p.id, {
          providerId: "gemini",
          modelId: "gemini-2.5-flash-image",
          params: { aspectRatio: null, imageSize: null, outputCount: 1, seed: null, quality: null },
        }),
      ),
    );
    expect(err.code).toBe("PROVIDER_NOT_CONFIGURED");
    expect(providerNeedingKey(err, "?")).toBe("gemini");
    expect(await call("generation_list", { projectId: p.id })).toEqual([]);
  });

  it.each([
    ["empty prompt", { prompt: prompt(" ") }, "VALIDATION_ERROR"],
    [
      "too many outputs",
      { params: { aspectRatio: null, imageSize: null, outputCount: 5, seed: null, quality: null } },
      "VALIDATION_ERROR",
    ],
    ["unknown provider", { providerId: "nope" }, "NOT_FOUND"],
    ["unknown model", { modelId: "nope" }, "NOT_FOUND"],
    ["unknown reference", { referenceAssetIds: ["AST_nope"] }, "NOT_FOUND"],
    // Review p2-ui PHẢI SỬA 1: a model without size/ratio lists only accepts null.
    [
      "an image size for a model without sizes",
      {
        providerId: "gemini",
        modelId: "gemini-2.5-flash-image",
        params: { aspectRatio: "16:9", imageSize: "8K", outputCount: 1, seed: null, quality: null },
      },
      "VALIDATION_ERROR",
    ],
    [
      "an aspect ratio the model does not offer",
      {
        modelId: "placeholder-v1",
        params: { aspectRatio: "7:5", imageSize: "1K", outputCount: 1, seed: null, quality: null },
      },
      "VALIDATION_ERROR",
    ],
  ] as const)("rejects %s", async (_n, over, code) => {
    const p = await newProject();
    const req = request(p.id, over as Partial<GenerationSubmitRequest>);
    expect((await errorOf(call("generation_submit", req))).code).toBe(code);
  });

  it("rejects generation in an archived project", async () => {
    const p = await newProject();
    await call("project_set_archived", { projectId: p.id, archived: true });
    expect((await errorOf(call("generation_submit", request(p.id)))).code).toBe("INVALID_STATE");
  });
});
