/** Variation inspector acceptance with isolated mock data; no paid provider calls. */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";

const output = process.env.QA_OUTPUT_DIR || (await mkdtemp(resolve(tmpdir(), "ica-variation-")));
await mkdir(output, { recursive: true });
const root = resolve("apps/desktop");
const server = await createServer({
  root,
  configFile: resolve(root, "vite.config.ts"),
  server: { port: 0, strictPort: false },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(server.resolvedUrls.local[0]);
  await page.evaluate(
    async (domainUrl) => {
      const { useStudio, EMPTY_GENERATE_DRAFT } = await import("/src/app/store.ts");
      const { createProject } = await import("/src/app/services.ts");
      const { createMockTransport } = await import("/src/lib/mockBackend.ts");
      const { setTransport } = await import("/src/lib/bridge.ts");
      const { asset } = await import("/tests/helpers.ts");
      const { defaultInteriorDNA, initialInteriorGeneration } = await import(domainUrl);
      const { useLocale } = await import("/src/i18n/index.ts");
      useLocale.setState({ locale: "vi" });
      const db = { projects: {}, dna: {}, assets: {}, versions: [] };
      const base = createMockTransport(db, { generationDelayMs: 5 });
      window.qaSubmits = [];
      setTransport(async (command, args) => {
        if (command === "generation_submit") window.qaSubmits.push(args.request);
        return base(command, args);
      });
      const p = await createProject({
        name: "Kiểm tra Tạo biến thể",
        projectType: "interior",
        subtype: null,
        starter: {},
        interior: defaultInteriorDNA(),
      });
      const blob = await fetch("/previews/style/modern.webp").then((r) => r.blob());
      const photo = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
      for (const id of ["AST_SOURCE", "AST_SECOND"])
        db.assets[id] = asset(p.id, id, {
          role: "regular_image",
          originalName: id === "AST_SOURCE" ? "Ảnh nội thất gốc" : "Ảnh nguồn khác",
          absolutePath: photo,
          thumbnailPath: photo,
        });
      await useStudio.getState().openProject(p.id);
      await useStudio.getState().loadProviders();
      useStudio.getState().setGenerateDraft({
        ...EMPTY_GENERATE_DRAFT,
        providerId: "local_preview",
        modelId: "placeholder-v1",
      });
      useStudio.getState().setShotIntent({
        projectType: "interior",
        interiorGeneration: initialInteriorGeneration({ type: "photo", assetId: "AST_SOURCE" }),
      });
      useStudio.getState().setWorkspaceMode("node");
      useStudio.getState().setModule("generate");
      useStudio.getState().selectAsset("AST_SOURCE");
    },
    "/@fs/" + resolve("packages/domain/src/index.ts").replaceAll("\\", "/"),
  );
  await page.getByRole("button", { name: "Biến thể từ ảnh này", exact: true }).click();
  const panel = page.getByTestId("variation-panel");
  await panel.waitFor();
  assert.equal(await panel.getByRole("group", { name: "Mục tiêu", exact: true }).count(), 0);
  assert.equal(await panel.getByRole("group", { name: "Loại phòng", exact: true }).count(), 0);
  assert.equal(await panel.getByRole("button", { name: "Không gian", exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => window.qaSubmits.length), 0);
  await panel.getByRole("button", { name: "Đổi góc máy", exact: true }).click();
  await panel.getByRole("button", { name: "Góc chéo", exact: true }).click();
  assert.equal(
    await page.evaluate(
      async () =>
        (await import("/src/app/store.ts")).useStudio.getState().workspace.shotIntent
          .interiorGeneration.camera.mode,
    ),
    "diagonal",
  );
  const viewports = [];
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 1280, height: 720 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    const bounds = await page.getByTestId("generate-button").boundingBox();
    assert(bounds && bounds.y >= 0 && bounds.y + bounds.height <= viewport.height);
    viewports.push(viewport);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: resolve(output, "variation-panel-node.png") });
  await panel.getByRole("button", { name: "Mở Camera Studio", exact: true }).click();
  await page.locator(".multi-angle-studio").waitFor();
  await panel.waitFor();
  assert.equal(await page.getByTestId("camera-generation-panel").count(), 0);
  await page.screenshot({ path: resolve(output, "variation-camera-studio.png") });
  await panel.getByRole("button", { name: "Quay lại Tạo ảnh", exact: true }).click();
  await page.getByTestId("interior-generate-flow").waitFor();
  await page.evaluate(async () => {
    const { useStudio } = await import("/src/app/store.ts");
    useStudio.getState().startVariation("AST_SOURCE");
  });
  assert.equal(
    await page.evaluate(
      async () =>
        (await import("/src/app/store.ts")).useStudio.getState().workspace.shotIntent
          .interiorGeneration.camera.mode,
    ),
    "diagonal",
  );
  await page.getByTestId("generate-button").click();
  await page.waitForFunction(() => window.qaSubmits.length === 1);
  const request = await page.evaluate(() => window.qaSubmits[0]);
  assert.equal(request.purpose, "variation");
  assert.equal(request.referenceAssetIds[0], "AST_SOURCE");
  assert.equal(request.cameraId, null);
  assert.equal(request.prompt.shotIntent.interiorGeneration.camera.mode, "diagonal");
  await page.waitForFunction(async () =>
    (await import("/src/app/store.ts")).useStudio
      .getState()
      .workspace.generations.some((g) => g.status === "completed"),
  );
  await panel.getByRole("button", { name: "Quay lại Tạo ảnh", exact: true }).click();
  await page
    .getByTestId("interior-result-actions")
    .getByRole("button", { name: "Tạo biến thể", exact: true })
    .click();
  await panel.waitFor();
  const outputSource = await page.evaluate(
    async () =>
      (await import("/src/app/store.ts")).useStudio.getState().workspace.shotIntent
        .interiorGeneration,
  );
  assert.notEqual(outputSource.input.assetId, "AST_SOURCE");
  assert.equal(outputSource.preserve.camera, true);
  assert.equal(await page.evaluate(() => window.qaSubmits.length), 1);
  assert.deepEqual(errors, []);
  const result = {
    errors,
    viewports,
    generationCalls: 1,
    importedAndAiSources: true,
    cameraWithoutExistingPose: true,
    studioKeepsVariationInspector: true,
  };
  await writeFile(resolve(output, "variation-panel-results.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ output, ...result }, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
