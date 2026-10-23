/** M1 acceptance with isolated mock storage. No credentials or paid services. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";

const output = resolve(process.env.QA_OUTPUT_DIR || "docs/reviews/multi-angle-m1");
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
  let launch = { headless: true };
  if (process.env.QA_CHROMIUM_MODULE) {
    const { default: portable } = await import(process.env.QA_CHROMIUM_MODULE);
    launch = {
      ...launch,
      executablePath: process.env.QA_CHROMIUM_PATH || (await portable.executablePath()),
      args: [
        "--no-sandbox",
        "--disable-gpu",
        "--disable-software-rasterizer",
        "--no-zygote",
        "--single-process",
      ],
    };
  }
  browser = await chromium.launch(launch);
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch: true });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(server.resolvedUrls.local[0]);
  await page.evaluate(async (domainPath) => {
    const { useStudio } = await import("/src/app/store.ts");
    const { createProject } = await import("/src/app/services.ts");
    const { createMockTransport } = await import("/src/lib/mockBackend.ts");
    const { setTransport } = await import("/src/lib/bridge.ts");
    const { useLocale } = await import("/src/i18n/index.ts");
    const transport = createMockTransport({ projects: {}, dna: {}, assets: {}, versions: [] });
    window.qaDomainPath = domainPath;
    window.qaCommands = [];
    setTransport(async (command, args) => {
      window.qaCommands.push(command);
      return transport(command, args);
    });
    useLocale.setState({ locale: "en" });
    const project = await createProject({
      name: "Multi-Angle · Building",
      projectType: "villa",
      subtype: null,
      starter: { floors: 2 },
    });
    window.qaProject = project.id;
    await useStudio.getState().openProject(project.id);
    useStudio.getState().setModule("camera");
    useStudio.getState().setCenterView("orbit");
  }, resolve("packages/domain/src/index.ts"));
  await page.getByRole("button", { name: "Add camera", exact: true }).click();
  const studio = page.getByTestId("multi-angle-studio");
  await studio.waitFor();
  await studio.getByRole("button", { name: "Left 45°", exact: true }).click();
  const distanceBox = await studio.getByRole("slider", { name: "Distance" }).boundingBox();
  const bodyBox = await page.locator(".center-body").boundingBox();
  assert(
    distanceBox.y + distanceBox.height <= bodyBox.y + bodyBox.height,
    "all Orbit controls fit the center viewport: " + JSON.stringify({ distanceBox, bodyBox }),
  );
  await page.screenshot({ path: resolve(output, "building-en.png") });
  const svg = studio.locator("svg.multi-angle-viewport");
  const box = await svg.boundingBox();
  const rotation = studio.getByRole("slider", { name: "Rotation" });
  const before = await rotation.inputValue();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 - 25, { steps: 8 });
  await page.mouse.up();
  assert.notEqual(await rotation.inputValue(), before);
  const after = await rotation.inputValue();
  await rotation.focus();
  await page.keyboard.press("ArrowRight");
  assert.notEqual(await rotation.inputValue(), after);
  const saved = await rotation.inputValue();
  await studio.getByRole("button", { name: "Help: Camera pose" }).click();
  await page.getByRole("note").waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("note").count(), 0);
  // Cancellation must release the drag; subsequent pointer moves cannot edit DNA.
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await svg.dispatchEvent("pointercancel", { pointerId: 1 });
  await page.mouse.move(box.x + 140, box.y + 130);
  await page.mouse.up();
  assert.equal(await rotation.inputValue(), saved);
  await page.evaluate(async () => {
    const { useStudio } = await import("/src/app/store.ts");
    await useStudio.getState().flushDna();
    await useStudio.getState().openProject(window.qaProject);
    useStudio.getState().setModule("camera");
    useStudio.getState().setCenterView("orbit");
  });
  assert.equal(await rotation.inputValue(), saved);
  await page.getByRole("tab", { name: "Director" }).click();
  await page.getByTestId("camera-director").waitFor();
  await page.getByRole("tab", { name: "Orbit" }).click();
  await studio.waitFor();
  await page.evaluate(async () => {
    const { useStudio } = await import("/src/app/store.ts");
    useStudio.getState().setModule("lighting");
  });
  assert.equal(await page.getByRole("tab", { name: "Orbit" }).count(), 0);
  await page.evaluate(async () => {
    const { useStudio } = await import("/src/app/store.ts");
    const { createProject } = await import("/src/app/services.ts");
    const { defaultInteriorDNA } = await import("/@fs" + window.qaDomainPath);
    const p = await createProject({
      name: "Multi-Angle · Nội thất",
      projectType: "interior",
      subtype: null,
      starter: {},
      interior: defaultInteriorDNA(),
    });
    await useStudio.getState().openProject(p.id);
    useStudio.getState().setModule("camera");
    useStudio.getState().setCenterView("orbit");
    const { useLocale } = await import("/src/i18n/index.ts");
    useLocale.setState({ locale: "vi" });
  });
  await page.getByRole("button", { name: "Thêm camera", exact: true }).click();
  assert.equal(await studio.getAttribute("data-camera-scope"), "interior");
  await studio.getByRole("button", { name: "Góc chéo", exact: true }).click();
  assert.equal(await studio.getByRole("button", { name: "Flycam" }).count(), 0);
  await page.screenshot({ path: resolve(output, "interior-vi.png") });
  const touchBox = await svg.boundingBox();
  const touchRotation = studio.getByRole("slider", { name: "Xoay", exact: true });
  const touchBefore = await touchRotation.inputValue();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: touchBox.x + 100, y: touchBox.y + 100 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: touchBox.x + 160, y: touchBox.y + 120 }],
  });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  assert.notEqual(await touchRotation.inputValue(), touchBefore);
  const paid = await page.evaluate(() =>
    window.qaCommands.filter((c) =>
      /generation_submit|batch_create|vision_analyze|asset_import|asset_remove/.test(c),
    ),
  );
  assert.deepEqual(paid, []);
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(output, "browser-results.json"),
    JSON.stringify(
      {
        passed: true,
        viewport: "1440x900",
        drag: true,
        touch: true,
        keyboard: true,
        cancellation: true,
        saveReopen: "mock transport",
        helpEscape: true,
        scopeAndLocale: true,
        paidCommands: paid,
        errors,
      },
      null,
      2,
    ),
  );
  console.log("M1 browser acceptance passed; screenshots: " + output);
} finally {
  await browser?.close();
  await server.close();
}
