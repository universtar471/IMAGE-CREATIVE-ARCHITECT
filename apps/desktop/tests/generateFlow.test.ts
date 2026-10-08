import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AssetDTO, ProviderDescriptorDTO } from "@arch/domain";
import { createProject } from "../src/app/services";
import { EMPTY_GENERATE_DRAFT, useStudio, type GenerationInput } from "../src/app/store";
import { generateDisabledReason, resolveGenerateForm } from "../src/features/generate/form";
import { buildVersionTree } from "../src/features/versions/tree";
import { call, setTransport, type VersionDTO } from "../src/lib/bridge";
import { createMockTransport, MOCK_PROVIDERS } from "../src/lib/mockBackend";

type Db = NonNullable<Parameters<typeof createMockTransport>[0]>;
let db: Db;

function useMock(delayMs: number) {
  db = { projects: {}, dna: {}, assets: {}, versions: [] };
  setTransport(createMockTransport(db, { generationDelayMs: delayMs }));
}

beforeEach(() => {
  useMock(0);
  useStudio.setState({
    route: { name: "hub" },
    workspace: null,
    run: null,
    providers: null,
    generateDraft: EMPTY_GENERATE_DRAFT,
  });
});
afterEach(() => setTransport(null));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function asset(projectId: string, id: string, over: Partial<AssetDTO> = {}): AssetDTO {
  return {
    id,
    projectId,
    source: "external",
    role: "architecture_reference",
    status: "ready",
    originalName: `${id}.jpg`,
    managedRelPath: `assets/original/${id}.jpg`,
    absolutePath: `blob:${id}`,
    thumbnailPath: `data:${id}`,
    mimeType: "image/jpeg",
    fileSizeBytes: 10,
    widthPx: 1600,
    heightPx: 1000,
    sha256: id,
    parentAssetId: null,
    operation: "import",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

/** Project with a master (+ its import version) seeded straight into the mock db. */
async function projectWithMaster(name = "Gen flow") {
  const p = await createProject({
    name,
    projectType: "villa",
    subtype: "tropical",
    starter: { floors: 2 },
  });
  const masterId = `AST_M_${p.id}`;
  db.assets[masterId] = asset(p.id, masterId, { role: "regular_image" });
  db.versions.push({
    id: `VER_M_${p.id}`,
    projectId: p.id,
    assetId: masterId,
    parentVersionId: null,
    label: null,
    operation: "import",
    generationId: null,
    createdAt: "2026-01-01T00:00:00Z",
  });
  await call("asset_set_master", { projectId: p.id, assetId: masterId });
  return { project: p, masterId };
}

const localInput = (projectId: string, refs: string[]): GenerationInput => ({
  projectId,
  providerId: "local_preview",
  modelId: "placeholder-v1",
  purpose: "hero",
  referenceAssetIds: refs,
  params: { aspectRatio: "16:9", imageSize: "1K", outputCount: 2, seed: null },
});

describe("generation flow through the store", () => {
  it("submit → assets, versions and history are refreshed and the output is selected", async () => {
    const { project, masterId } = await projectWithMaster();
    await useStudio.getState().openProject(project.id);
    const g = await useStudio.getState().submitGeneration(localInput(project.id, [masterId]));

    expect(g?.status).toBe("completed");
    const s = useStudio.getState();
    expect(s.run).toMatchObject({ status: "done", projectId: project.id });
    expect(s.workspace!.generations.map((x) => x.id)).toEqual([g!.id]);
    expect(s.workspace!.assets.filter((a) => a.source === "ai_generated")).toHaveLength(2);
    expect(s.selectedAssetId).toBe(g!.outputAssetIds[0]);
    // The prompt was compiled with exactly the chosen references, master as Image 1.
    expect(g!.prompt.referenceInstructions).toMatch(/^Image 1 \(.*\) is the MASTER/);
    expect(g!.prompt.metadata.referenceCount).toBe(1);

    const versions = await call("version_list", { projectId: project.id });
    const tree = buildVersionTree(versions);
    expect(tree[0]).toMatchObject({ depth: 0, childCount: 2 });
    expect(tree.slice(1).every((n) => n.depth === 1 && n.version.generationId === g!.id)).toBe(
      true,
    );
  });

  it("a [fail] prompt lands as a failed history entry", async () => {
    const { project } = await projectWithMaster();
    await useStudio.getState().openProject(project.id);
    useStudio.getState().editDna("building.notes", "please [fail] now");
    const g = await useStudio.getState().submitGeneration(localInput(project.id, []));
    expect(g?.status).toBe("failed");
    expect(useStudio.getState().workspace!.generations[0]!.error?.kind).toBe("bad_response");
    expect((await call("dna_get", { projectId: project.id })).building.notes).toBe(
      "please [fail] now",
    );
  });

  it("PROVIDER_NOT_CONFIGURED becomes a run error that names the provider", async () => {
    const { project } = await projectWithMaster();
    await useStudio.getState().openProject(project.id);
    const g = await useStudio.getState().submitGeneration({
      ...localInput(project.id, []),
      providerId: "gemini",
      modelId: "gemini-nano-banana-2.1",
      params: { aspectRatio: null, imageSize: null, outputCount: 1, seed: null },
    });
    expect(g).toBeUndefined();
    expect(useStudio.getState().run).toMatchObject({
      status: "error",
      code: "PROVIDER_NOT_CONFIGURED",
      needsKeyFor: "gemini",
    });
  });

  it("ignores a result that arrives after switching to another project", async () => {
    useMock(80);
    const a = await projectWithMaster("Project A");
    const b = await projectWithMaster("Project B");
    await useStudio.getState().openProject(a.project.id);
    const pending = useStudio.getState().submitGeneration(localInput(a.project.id, [a.masterId]));
    await sleep(5);
    expect(useStudio.getState().run?.status).toBe("running");

    await useStudio.getState().openProject(b.project.id);
    const bAssetsBefore = useStudio.getState().workspace!.assets.map((x) => x.id);
    const g = await pending;

    const s = useStudio.getState();
    expect(g?.status).toBe("completed");
    expect(s.workspace!.project.id).toBe(b.project.id);
    expect(s.workspace!.assets.map((x) => x.id)).toEqual(bAssetsBefore);
    expect(s.workspace!.generations).toEqual([]);
    expect(s.selectedAssetId).not.toBe(g!.outputAssetIds[0]);

    // Back in A the result is there (loaded from the backend).
    await useStudio.getState().openProject(a.project.id);
    expect(useStudio.getState().workspace!.generations[0]!.id).toBe(g!.id);
  });

  it("only one generation runs at a time", async () => {
    useMock(30);
    const { project, masterId } = await projectWithMaster();
    await useStudio.getState().openProject(project.id);
    const first = useStudio.getState().submitGeneration(localInput(project.id, [masterId]));
    await sleep(5);
    expect(await useStudio.getState().submitGeneration(localInput(project.id, []))).toBeUndefined();
    expect((await first)?.status).toBe("completed");
  });

  it("reuse settings loads the generation into the Generate draft", async () => {
    const { project, masterId } = await projectWithMaster();
    await useStudio.getState().openProject(project.id);
    const g = (await useStudio.getState().submitGeneration(localInput(project.id, [masterId])))!;
    useStudio.getState().reuseGeneration(g);
    const s = useStudio.getState();
    expect(s.activeModule).toBe("generate");
    expect(s.generateDraft).toMatchObject({
      providerId: "local_preview",
      modelId: "placeholder-v1",
      referenceAssetIds: [masterId],
      params: g.params,
    });
  });
});

describe("Generate form derivation", () => {
  const providers = (geminiConfigured: boolean): ProviderDescriptorDTO[] =>
    MOCK_PROVIDERS.map((p) => ({
      ...p,
      configured: p.requiresApiKey ? geminiConfigured : true,
      keySource: p.requiresApiKey && geminiConfigured ? "keychain" : null,
    }));
  const assets = [
    asset("P", "AST_ref"),
    asset("P", "AST_master", { role: "master_architecture" }),
    asset("P", "AST_gen", { role: "regular_image", source: "ai_generated" }),
    asset("P", "AST_missing", { status: "missing_file", role: "material_reference" }),
  ];
  const ctx = { readOnly: false, running: false, dnaInvalid: false, assets };

  it("defaults to the first configured provider, hero with a master, master-first references", () => {
    const f = resolveGenerateForm(EMPTY_GENERATE_DRAFT, providers(false), assets, "AST_master");
    expect(f.provider?.id).toBe("local_preview");
    expect(f.purpose).toBe("hero");
    expect(f.referenceIds).toEqual(["AST_master", "AST_ref"]);
    expect(f.candidates.map((a) => a.id)[0]).toBe("AST_master");
    expect(generateDisabledReason(f, ctx)).toBeNull();

    const configured = resolveGenerateForm(EMPTY_GENERATE_DRAFT, providers(true), assets, null);
    expect(configured.provider?.id).toBe("gemini");
    expect(configured.model?.id).toBe("gemini-nano-banana-2.1");
    expect(configured.purpose).toBe("variation");
    expect(configured.params).toMatchObject({ imageSize: "1K", seed: null });
  });

  it("explains why Generate is disabled", () => {
    const draft = { ...EMPTY_GENERATE_DRAFT, providerId: "gemini" };
    const f = resolveGenerateForm(draft, providers(false), assets, null);
    expect(generateDisabledReason(f, ctx)).toMatch(/needs an API key/);
    const ok = resolveGenerateForm(EMPTY_GENERATE_DRAFT, providers(false), assets, null);
    expect(generateDisabledReason(ok, { ...ctx, readOnly: true })).toMatch(/archived/);
    expect(generateDisabledReason(ok, { ...ctx, running: true })).toMatch(/already running/);
    const tooMany = resolveGenerateForm(
      {
        ...EMPTY_GENERATE_DRAFT,
        providerId: "gemini",
        modelId: "gemini-2.5-flash-image",
        referenceAssetIds: ["AST_ref", "AST_master", "AST_gen", "AST_x"],
      },
      providers(true),
      [...assets, asset("P", "AST_x")],
      null,
    );
    expect(
      generateDisabledReason(tooMany, { ...ctx, assets: [...assets, asset("P", "AST_x")] }),
    ).toMatch(/at most 3/);
  });

  it("defaults the aspect ratio to the master's shape, else the first reference's", () => {
    // Seeded assets are 1600×1000 (1.6) → closest Gemini ratio is 3:2.
    const withMaster = resolveGenerateForm(
      EMPTY_GENERATE_DRAFT,
      providers(true),
      [
        ...assets,
        asset("P", "AST_tall", { role: "context_reference", widthPx: 900, heightPx: 1600 }),
      ],
      "AST_master",
    );
    expect(withMaster.params.aspectRatio).toBe("3:2");

    const tallFirst = resolveGenerateForm(
      { ...EMPTY_GENERATE_DRAFT, referenceAssetIds: ["AST_tall"] },
      providers(true),
      [asset("P", "AST_tall", { widthPx: 900, heightPx: 1600 })],
      null,
    );
    expect(tallFirst.params.aspectRatio).toBe("9:16");

    const none = resolveGenerateForm(EMPTY_GENERATE_DRAFT, providers(true), [], null);
    expect(none.params.aspectRatio).toBe("1:1");
  });

  it("legacy model without image sizes sends imageSize null", () => {
    const f = resolveGenerateForm(
      { ...EMPTY_GENERATE_DRAFT, providerId: "gemini", modelId: "gemini-2.5-flash-image" },
      providers(true),
      assets,
      null,
    );
    expect(f.params.imageSize).toBeNull();
  });
});

describe("version tree", () => {
  const v = (id: string, parent: string | null, createdAt: string): VersionDTO => ({
    id,
    projectId: "P",
    assetId: `A_${id}`,
    parentVersionId: parent,
    label: null,
    operation: parent ? "generate" : "import",
    generationId: parent ? "G" : null,
    createdAt,
  });

  it("nests children under parents and treats orphans as roots", () => {
    const tree = buildVersionTree([
      v("c2", "r1", "2026-01-03"),
      v("r1", null, "2026-01-01"),
      v("c1", "r1", "2026-01-02"),
      v("g1", "c1", "2026-01-04"),
      v("orphan", "gone", "2026-01-05"),
    ]);
    expect(tree.map((n) => [n.version.id, n.depth])).toEqual([
      ["r1", 0],
      ["c1", 1],
      ["g1", 2],
      ["c2", 1],
      ["orphan", 0],
    ]);
  });
});
