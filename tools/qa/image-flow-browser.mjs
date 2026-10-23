/** Real UI interactions with isolated mock persistence; never calls a paid provider. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
const output = resolve(process.env.QA_OUTPUT_DIR || "docs/reviews/image-flow");
await mkdir(output, { recursive: true });
const root = resolve("apps/desktop");
const server = await createServer({
  root,
  configFile: resolve(root, "vite.config.ts"),
  server: { port: 0 },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({
    headless: true,
    ...(process.env.QA_CHROMIUM_PATH
      ? {
          executablePath: process.env.QA_CHROMIUM_PATH,
          args: [
            "--no-sandbox",
            "--disable-gpu",
            "--disable-software-rasterizer",
            "--no-zygote",
            "--single-process",
          ],
        }
      : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch: true });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(server.resolvedUrls.local[0]);
  await page.evaluate(
    async (domainUrl) => {
      const { useStudio } = await import("/src/app/store.ts");
      const { createProject } = await import("/src/app/services.ts");
      const { createMockTransport } = await import("/src/lib/mockBackend.ts");
      const { setTransport } = await import("/src/lib/bridge.ts");
      const { asset } = await import("/tests/helpers.ts");
      const { useLocale } = await import("/src/i18n/index.ts");
      const { blankCamera, defaultInteriorDNA, initialInteriorGeneration } = await import(
        domainUrl
      );
      const db = { projects: {}, dna: {}, assets: {}, versions: [] };
      const base = createMockTransport(db);
      window.syncCommands = [];
      window.flowSubmissions = [];
      setTransport(async (cmd, args) => {
        window.syncCommands.push(cmd);
        if (cmd === "generation_submit") window.flowSubmissions.push(args.request);
        return base(cmd, args);
      });
      useLocale.setState({ locale: "en" });
      const project = await createProject({
        name: "Camera Sync · Interior",
        projectType: "interior",
        subtype: null,
        starter: {},
        interior: defaultInteriorDNA(),
      });
      window.syncProject = project.id;
      const source =
        "data:image/svg+xml," +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#476274"/><path d="M200 650V200L800 100l600 100v450z" fill="#d6d3c8"/><rect x="400" y="500" width="600" height="150" rx="20" fill="#a28d76"/></svg>',
        );
      db.assets.AST_SYNC = asset(project.id, "AST_SYNC", {
        role: "regular_image",
        absolutePath: source,
        thumbnailPath: source,
      });
      await useStudio.getState().openProject(project.id);
      const cameras = [blankCamera([]), blankCamera(["Camera 1"])].map((c) => ({
        ...c,
        viewType: "interior_wide",
        azimuthDeg: 0,
        elevationDeg: 0,
        distanceM: 5,
      }));
      window.syncCamera = cameras[1].id;
      useStudio.getState().setCameras(cameras);
      useStudio.getState().selectCamera(cameras[1].id);
      useStudio.getState().setShotIntent({
        projectType: "interior",
        interiorGeneration: initialInteriorGeneration({ type: "photo", assetId: "AST_SYNC" }),
      });
      useStudio.getState().setModule("camera");
      useStudio.getState().setCenterView("orbit");
    },
    "/@fs" + resolve("packages/domain/src/index.ts"),
  );
  const panel = page.getByTestId("camera-generation-panel");
  await panel.waitFor();
  await panel.getByRole("combobox", { name: "Image source", exact: true }).selectOption("AST_SYNC");
  await panel.getByRole("combobox", { name: "Provider", exact: true }).selectOption("hhtech");
  const choices = await panel
    .getByRole("combobox", { name: "Model", exact: true })
    .locator("option")
    .evaluateAll((options) => options.map((o) => o.value));
  assert.ok(choices.length > 1);
  await panel.getByRole("combobox", { name: "Model", exact: true }).selectOption(choices[1]);
  assert.equal(
    await page.evaluate(
      async () => (await import("/src/app/store.ts")).useStudio.getState().generateDraft.modelId,
    ),
    choices[1],
  );
  await panel
    .getByRole("combobox", { name: "Provider", exact: true })
    .selectOption("local_preview");
  assert.equal(await panel.getByRole("combobox", { name: "Model", exact: true }).isVisible(), true);
  assert.equal(await page.getByTestId("camera-generate-button").isDisabled(), true);
  await page
    .getByTestId("multi-angle-studio")
    .getByRole("button", { name: "Unlock and use Camera Studio", exact: true })
    .click();
  await page.getByRole("slider", { name: "Rotation", exact: true }).fill("48");
  await page.screenshot({ path: resolve(output, "camera-image-model.png") });
  await page.evaluate(async () => {
    const { useLocale } = await import("/src/i18n/index.ts");
    useLocale.setState({ locale: "vi" });
  });
  await page.screenshot({ path: resolve(output, "camera-image-model-vi.png") });
  await page.evaluate(async () => {
    const { useLocale } = await import("/src/i18n/index.ts");
    useLocale.setState({ locale: "en" });
  });
  await page.getByTestId("camera-generate-button").click();
  await page.waitForFunction(() => window.flowSubmissions.length === 1);
  const request = await page.evaluate(() => window.flowSubmissions[0]);
  assert.equal(request.cameraId, await page.evaluate(() => window.syncCamera));
  assert.deepEqual(request.referenceAssetIds, ["AST_SYNC"]);
  assert.equal(request.modelId, "placeholder-v1");
  assert.match(request.prompt.preservationInstructions, /Reframe the source/);
  assert.match(request.prompt.positivePrompt, /48/);
  await writeFile(
    resolve(output, "camera-prompt.txt"),
    request.prompt.positivePrompt + "\n\n" + request.prompt.preservationInstructions,
  );
  await page.evaluate(async () => {
    const { useStudio } = await import("/src/app/store.ts");
    useStudio.getState().setModule("style");
  });
  await page.screenshot({ path: resolve(output, "style-actions.png") });
  await page
    .locator(".style-next-actions")
    .getByRole("button", { name: "Generate image", exact: true })
    .click();
  const model = page
    .locator(".generate-panel")
    .getByRole("combobox", { name: "Model", exact: true });
  assert.equal(await model.isVisible(), true);
  assert.equal(await page.locator('[data-module="rooms"]').count(), 0);
  assert.equal(await page.locator('[data-module="detail"]').count(), 0);
  await page.screenshot({ path: resolve(output, "generate-model-visible.png") });
  await page
    .getByTestId("interior-generate-flow")
    .getByRole("button", { name: "Generate image", exact: true })
    .click();
  assert.equal(
    await page.getByTestId("generate-button").evaluate((e) => e === document.activeElement),
    true,
  );
  await page.screenshot({ path: resolve(output, "style-next-create.png") });
  await page.setViewportSize({ width: 1100, height: 700 });
  await page.screenshot({ path: resolve(output, "compact-create.png") });
  assert.deepEqual(errors, []);
  const result = {
    passed: true,
    mockBackendOnly: true,
    modelVisible: true,
    styleToGenerate: true,
    duplicateRoomHidden: true,
    interiorArchitectureDetailHidden: true,
    cameraSubmission: {
      source: request.referenceAssetIds,
      camera: request.cameraId,
      model: request.modelId,
    },
    errors,
  };
  await writeFile(resolve(output, "browser-results.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser?.close();
  await server.close();
}
