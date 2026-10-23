/** Real UI interactions with isolated mock persistence; never calls a paid provider. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
const output = resolve(process.env.QA_OUTPUT_DIR || "docs/reviews/camera-sync");
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
      setTransport(async (cmd, args) => {
        window.syncCommands.push(cmd);
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
  const orbit = page.getByTestId("multi-angle-studio");
  await orbit.waitFor();
  await orbit.getByRole("button", { name: "Unlock and use Camera Studio", exact: true }).click();
  const inspector = page.locator(".camera-panel");
  await inspector.getByRole("button", { name: "Diagonal", exact: true }).click();
  assert.equal(await orbit.getByRole("slider", { name: "Rotation" }).inputValue(), "35");
  await page.evaluate(async () => {
    const { useStudio } = await import("/src/app/store.ts");
    useStudio.getState().setModule("generate");
  });
  await page
    .locator(".interior-generate-flow > details")
    .filter({ has: page.locator(":scope > summary", { hasText: "More options" }) })
    .evaluate((e) => {
      e.open = true;
    });
  const flow = page.getByTestId("interior-generate-flow");
  assert.equal(
    await flow.getByRole("button", { name: "Diagonal", exact: true }).getAttribute("aria-pressed"),
    "true",
  );
  await flow.getByRole("button", { name: "Detail", exact: true }).click();
  await flow.getByRole("button", { name: "Open Camera Studio", exact: true }).click();
  await orbit.waitFor();
  assert.equal(await orbit.getByRole("slider", { name: "Rotation" }).inputValue(), "20");
  assert.equal(await orbit.getByRole("slider", { name: "Tilt" }).inputValue(), "-10");
  assert.equal(await orbit.getByRole("slider", { name: "Distance" }).inputValue(), "1.5");
  // Keyboard and a real pointer drag update the same selected DNA object.
  await orbit.getByRole("slider", { name: "Rotation" }).fill("48");
  await orbit.getByRole("slider", { name: "Rotation" }).press("ArrowRight");
  const svg = orbit.locator("svg.multi-angle-viewport");
  const bounds = await svg.boundingBox();
  await page.mouse.move(bounds.x + 100, bounds.y + 100);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 130, bounds.y + 90, { steps: 5 });
  await page.mouse.up();
  assert.equal(
    await inspector
      .getByRole("button", { name: "Camera Studio", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.screenshot({ path: resolve(output, "orbit-linked-en.png") });
  await page.getByRole("tab", { name: "Camera Director", exact: true }).click();
  const mark = page.getByTestId("director-camera").nth(1);
  await mark.focus();
  await page.keyboard.press("ArrowLeft");
  await page.getByRole("tab", { name: "Orbit", exact: true }).click();
  const expected = await page.evaluate(async () => {
    const { useStudio } = await import("/src/app/store.ts");
    const { call } = await import("/src/lib/bridge.ts");
    const { compileFromBundle } = await import("/src/app/services.ts");
    await useStudio.getState().flushDna();
    const state = useStudio.getState();
    const camera = state.workspace.draftDna.cameras.find((c) => c.id === window.syncCamera);
    const bundle = await call("project_get", { projectId: window.syncProject });
    const prompt = compileFromBundle(bundle, {
      referenceAssetIds: ["AST_SYNC"],
      sourceAssetId: "AST_SYNC",
      shotIntent: state.workspace.shotIntent,
    });
    window.syncPrompt = prompt;
    return {
      azimuth: camera.azimuthDeg,
      elevation: camera.elevationDeg,
      distance: camera.distanceM,
      snapshot: prompt.metadata.interiorCameraSnapshot,
      prompt: prompt.positivePrompt,
    };
  });
  assert(expected.prompt.includes(`room-local azimuth ${expected.azimuth} degrees`));
  assert.equal(
    Number(await orbit.getByRole("slider", { name: "Rotation" }).inputValue()),
    expected.azimuth,
  );
  await page.evaluate(async () => {
    const { useStudio } = await import("/src/app/store.ts");
    await useStudio.getState().openProject(window.syncProject);
    useStudio.getState().setModule("camera");
    useStudio.getState().setCenterView("orbit");
  });
  assert.equal(
    Number(await orbit.getByRole("slider", { name: "Rotation" }).inputValue()),
    expected.azimuth,
  );
  await page.evaluate(async () => {
    const { useLocale } = await import("/src/i18n/index.ts");
    useLocale.setState({ locale: "vi" });
  });
  await page.screenshot({ path: resolve(output, "orbit-linked-vi.png") });
  const result = {
    passed: true,
    source: "mock backend only",
    viewport: "1440x900",
    generatePresetToOrbit: true,
    inspectorToGenerate: true,
    orbitAndDirectorToPrompt: true,
    reopenSelectedCamera: true,
    camera: expected.snapshot,
    errors,
    paidCommands: await page.evaluate(() =>
      window.syncCommands.filter((c) => /generation_submit|batch_create|dna_assist/.test(c)),
    ),
  };
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.paidCommands, []);
  await writeFile(resolve(output, "browser-results.json"), JSON.stringify(result, null, 2));
  await writeFile(resolve(output, "compiled-prompt.txt"), expected.prompt);
  console.log(JSON.stringify(result));
} finally {
  await browser?.close();
  await server.close();
}
