/** Reference UI regression with an isolated backend; no remote AI requests. */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";

const output = process.env.QA_OUTPUT_DIR || (await mkdtemp(resolve(tmpdir(), "ica-references-")));
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
  await page.evaluate(async () => {
    const { useLocale } = await import("/src/i18n/index.ts");
    useLocale.setState({ locale: "en" });
    const { setTransport } = await import("/src/lib/bridge.ts");
    const { createMockTransport } = await import("/src/lib/mockBackend.ts");
    const db = { projects: {}, dna: {}, assets: {}, versions: [] };
    const base = createMockTransport(db);
    window.qaAssists = [];
    setTransport(async (command, args) => {
      if (command === "dna_assist") {
        window.qaAssists.push(args.request);
        return {
          raw: JSON.stringify({
            fields: [
              {
                path: "building.architecturalStyle",
                value: "japandi",
                confidence: 0.9,
                reason: "Reference style",
              },
            ],
          }),
          modelId: "mock",
          generationId: "GEN_REF",
          usage: null,
        };
      }
      return base(command, args);
    });
  });
  await page.getByRole("button", { name: "New Project", exact: true }).click();
  const wizard = page.getByRole("dialog", { name: "New Project", exact: true });
  assert.equal(await wizard.getByRole("textbox").count(), 1);
  assert.equal(await wizard.locator(".choice").count(), 2);
  await wizard.getByRole("textbox", { name: "Project name" }).fill("Reference UI QA");
  await wizard.getByRole("button", { name: "Architecture", exact: true }).click();
  await wizard.getByRole("button", { name: "Create project", exact: true }).click();
  await page.locator('[data-module="references"]').click();
  const panel = page.getByTestId("property-panel");
  await panel.getByRole("button", { name: "Import images", exact: true }).waitFor();
  // Import after the control mounted: references must be selected on opening AI.
  await page.evaluate(async () => {
    const { useStudio } = await import("/src/app/store.ts");
    const { asset } = await import("/tests/helpers.ts");
    const ws = useStudio.getState().workspace;
    useStudio.setState({
      workspace: {
        ...ws,
        assets: [
          asset(ws.project.id, "AST_REF", {
            originalName: "Facade reference",
            absolutePath: "/previews/style/modern.webp",
            thumbnailPath: "/previews/style/modern.webp",
          }),
        ],
      },
    });
  });
  await panel.getByRole("button", { name: "AI assist", exact: true }).click();
  await panel.getByRole("button", { name: "From reference images", exact: true }).click();
  assert(await panel.getByRole("checkbox", { name: "Facade reference" }).isChecked());
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".assist-reference-option img")].every(
      (img) => img.complete && img.naturalWidth > 0,
    ),
  );
  const viewports = [];
  for (const width of [1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    const bounds = await panel.locator(".assist-popover").evaluate((el) => ({
      right: el.getBoundingClientRect().right,
      panelRight: el.closest("aside").getBoundingClientRect().right,
      width: el.getBoundingClientRect().width,
    }));
    assert(bounds.width > 0 && bounds.right <= bounds.panelRight + 1);
    viewports.push({ viewportWidth: width, ...bounds });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: resolve(output, "architecture-reference-assist.png") });
  await panel.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Confirm cost" })
    .getByRole("button", { name: "Create images", exact: true })
    .click();
  await panel.getByText("Reference style", { exact: true }).waitFor();
  const request = await page.evaluate(() => window.qaAssists[0]);
  assert.equal(request.scope, "building");
  assert.deepEqual(request.referenceAssetIds, ["AST_REF"]);
  assert(!request.catalog.fields.some((f) => f.path.startsWith("interior.")));
  await panel.getByRole("button", { name: "Apply 1 items", exact: true }).click();
  await page.waitForFunction(
    async () =>
      (await import("/src/app/store.ts")).useStudio.getState().workspace.draftDna.building
        .architecturalStyle === "japandi",
  );
  await page.evaluate(
    async (domainUrl) => {
      const { useStudio } = await import("/src/app/store.ts");
      const { createProject } = await import("/src/app/services.ts");
      const { defaultInteriorDNA } = await import(domainUrl);
      const { useLocale } = await import("/src/i18n/index.ts");
      useLocale.setState({ locale: "vi" });
      const project = await createProject({
        name: "Kiểm tra Style gọn",
        projectType: "interior",
        subtype: null,
        starter: {},
        interior: defaultInteriorDNA(),
      });
      await useStudio.getState().openProject(project.id);
      useStudio.getState().setModule("style");
    },
    "/@fs/" + resolve("packages/domain/src/index.ts").replaceAll("\\", "/"),
  );
  await panel.locator(".style-thumbnail").first().waitFor();
  assert.equal(await panel.locator(".style-thumbnail").count(), 6);
  await page.waitForFunction(() => {
    const images = [...document.querySelectorAll(".style-panel .style-thumbnail img")];
    return images.length === 6 && images.every((img) => img.complete && img.naturalWidth > 0);
  });
  await page.screenshot({ path: resolve(output, "interior-style-menu-compact.png") });
  await panel.getByRole("button", { name: "Xem tất cả", exact: true }).click();
  assert(
    (await page
      .getByRole("dialog", { name: "Xem tất cả", exact: true })
      .locator(".style-thumbnail")
      .count()) > 6,
  );
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(output, "reference-assist-results.json"),
    JSON.stringify({ viewports, analysisCalls: 1, errors }, null, 2),
  );
  console.log(JSON.stringify({ output, viewports, analysisCalls: 1, errors }, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
