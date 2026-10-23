/** Isolated browser acceptance: no real project writes or remote provider calls. */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";

const output = process.env.QA_OUTPUT_DIR || (await mkdtemp(resolve(tmpdir(), "ica-interior-")));
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
      const transport = createMockTransport(db, { generationDelayMs: 5 });
      window.qaSubmits = [];
      window.qaAssists = [];
      setTransport(async (command, args) => {
        if (command === "generation_submit") window.qaSubmits.push(args.request);
        if (command === "dna_assist") {
          window.qaAssists.push(args.request);
          return {
            raw: JSON.stringify(
              args.request.scope === "lighting"
                ? { preset: "warm", reason: "Phù hợp đèn hiện có" }
                : {
                    analysis: {
                      room_type: "living room",
                      existing_style: "modern",
                      geometry: "Existing rectangular room",
                      materials: ["wood"],
                      colors: ["white"],
                      lighting: "daylight",
                      strengths: ["open circulation"],
                      weaknesses: ["flat shading"],
                    },
                    recommendations: ["modern", "minimalist", "japandi"].map((style_id) => ({
                      style_id,
                      style_name: style_id,
                      compatibility_score: 90,
                      short_reason: "Phù hợp không gian và kiến trúc hiện có",
                      suggested_lighting: "soft_natural",
                      recommended_change_level: 1,
                    })),
                  },
            ),
            modelId: "mock-chat",
            generationId: "GEN_ADVICE",
            usage: null,
          };
        }
        return transport(command, args);
      });
      const p = await createProject({
        name: "Kiểm tra nội thất",
        projectType: "interior",
        subtype: null,
        starter: {},
        interior: defaultInteriorDNA(),
      });
      // A real bundled room thumbnail provides a readable preview without a paid request.
      const photo = await fetch("/previews/style/modern.webp").then((r) => r.blob());
      const image = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(photo);
      });
      db.assets.AST_SOURCE = asset(p.id, "AST_SOURCE", {
        role: "regular_image",
        originalName: "Phòng hiện trạng",
        absolutePath: image,
        thumbnailPath: image,
      });
      db.assets.AST_REF = asset(p.id, "AST_REF", {
        role: "master_architecture",
        originalName: "Ảnh style",
        absolutePath: image,
        thumbnailPath: image,
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
      useStudio.getState().setModule("generate");
    },
    "/@fs/" + resolve("packages/domain/src/index.ts").replaceAll("\\", "/"),
  );
  const flow = page.getByTestId("interior-generate-flow");
  await flow.waitFor();
  for (const id of ["design_dna", "style", "lighting", "effects"]) {
    assert.equal(await page.locator(`.nav [data-module="${id}"]`).count(), 0);
  }
  await flow.getByRole("button", { name: "Không gian", exact: true }).click();
  const space = page.getByRole("dialog", { name: "Không gian", exact: true });
  await space.getByRole("combobox", { name: "Không gian", exact: true }).selectOption("bedroom");
  await page.screenshot({ path: resolve(output, "interior-space-options.png") });
  await space.getByRole("button", { name: "Đóng", exact: true }).click();
  assert.equal(
    await page.evaluate(
      async () =>
        (await import("/src/app/store.ts")).useStudio.getState().workspace.shotIntent
          .interiorGeneration.room,
    ),
    "bedroom",
  );
  await flow.getByRole("button", { name: "Ánh sáng nội thất", exact: true }).click();
  const light = page.getByRole("dialog", { name: "Ánh sáng nội thất", exact: true });
  await light.getByRole("button", { name: "Ấm áp", exact: true }).click();
  await page.screenshot({ path: resolve(output, "interior-lighting-options.png") });
  await light.getByRole("button", { name: "Đóng", exact: true }).click();
  assert.equal(
    await page.evaluate(
      async () =>
        (await import("/src/app/store.ts")).useStudio.getState().workspace.shotIntent
          .interiorGeneration.lighting.preset,
    ),
    "warm",
  );
  const more = flow
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: "Tùy chỉnh thêm" }) })
    .first();
  assert.equal(await more.getAttribute("open"), null);
  const results = { errors, viewports: [] };
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 1280, height: 720 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    const generate = page.getByTestId("generate-button");
    await generate.waitFor({ state: "visible" });
    const bounds = await generate.boundingBox();
    assert(
      bounds && bounds.y >= 0 && bounds.y + bounds.height <= viewport.height,
      "Generate stays visible",
    );
    const columns = await flow
      .locator(".interior-style-grid")
      .evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length);
    assert(columns >= 2 && columns <= 3);
    results.viewports.push({ ...viewport, columns });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: resolve(output, "interior-workflow.png") });
  await flow.locator(".interior-style-grid").scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(output, "interior-style-grid.png") });
  await more.locator(":scope > summary").click();
  await page.getByTestId("interior-instruction").fill("Đổi sofa thành sofa da nâu");
  assert(await page.getByTestId("generate-button").isDisabled());
  assert((await page.getByTestId("generation-hard-conflict").count()) >= 1);
  await page.screenshot({ path: resolve(output, "interior-lock-conflict.png") });
  // Keep both locks explicitly removes only the conflicting sentence.
  await page.getByRole("button", { name: "Giữ khóa", exact: true }).first().click();
  assert.equal(await page.getByTestId("interior-instruction").inputValue(), "");
  await flow.getByRole("combobox", { name: "Ảnh tham chiếu", exact: true }).selectOption("AST_REF");
  assert(await flow.getByRole("checkbox", { name: "Phong cách", exact: true }).isChecked());
  assert(!(await flow.getByRole("checkbox", { name: "Vật liệu", exact: true }).isChecked()));
  await flow.getByRole("button", { name: "AI gợi ý 3 phong cách", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Tiếp tục", exact: true }).click();
  await flow.getByRole("group", { name: "Phong cách phù hợp" }).waitFor();
  assert.equal(await page.evaluate(() => window.qaSubmits.length), 0);
  assert.equal(await page.evaluate(() => window.qaAssists.length), 1);
  await flow.getByRole("button", { name: "Nhận gợi ý: Hiện đại", exact: true }).click();
  await page.getByTestId("generate-button").click();
  await page.waitForFunction(() => window.qaSubmits.length === 1);
  const request = await page.evaluate(() => window.qaSubmits[0]);
  assert.deepEqual(request.referenceAssetIds, ["AST_SOURCE", "AST_REF"]);
  assert(request.prompt.referenceInstructions.includes("Image 1 is the authoritative source"));
  assert(
    request.prompt.preservationInstructions.includes("viewing direction, horizon and framing"),
  );
  await page.getByTestId("interior-result-actions").waitFor();
  await page.getByRole("button", { name: "Tạo biến thể", exact: true }).last().click();
  assert.equal(
    await page.evaluate(() => window.qaSubmits.length),
    1,
    "result actions prepare a draft only",
  );
  await page.screenshot({ path: resolve(output, "interior-result.png") });
  assert.deepEqual(errors, []);
  results.generationCalls = 1;
  results.analysisCalls = 1;
  await writeFile(
    resolve(output, "interior-generation-results.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(JSON.stringify({ output, ...results }, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
