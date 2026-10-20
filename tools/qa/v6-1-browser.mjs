/** Browser acceptance checks against an isolated mock backend. No real provider calls. */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";

const output = process.env.QA_OUTPUT_DIR || (await mkdtemp(resolve(tmpdir(), "ica-v61-")));
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(server.resolvedUrls.local[0]);
  await page.evaluate(async () => {
    const { useStudio } = await import("/src/app/store.ts");
    const { createProject } = await import("/src/app/services.ts");
    const { createMockTransport } = await import("/src/lib/mockBackend.ts");
    const { setTransport } = await import("/src/lib/bridge.ts");
    const { asset } = await import("/tests/helpers.ts");
    const { useLocale } = await import("/src/i18n/index.ts");
    useLocale.setState({ locale: "en" });
    const db = { projects: {}, dna: {}, assets: {}, versions: [] };
    const transport = createMockTransport(db);
    window.qaWrites = [];
    setTransport(async (command, args) => {
      if (
        /^(generation_submit|dna_update|asset_|job_retry|job_cancel|canvas_layout_save)/.test(
          command,
        )
      )
        window.qaWrites.push(command);
      return transport(command, args);
    });
    const p = await createProject({
      name: "V6.1 regression",
      projectType: "villa",
      subtype: "tropical",
      starter: { floors: 2 },
    });
    const image =
      "data:image/svg+xml," +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#183c5b"/><path d="M300 650V350L800 100l500 250v300z" fill="#d9e7eb"/><text x="600" y="800" fill="white" font-size="50">Kiến trúc Việt Nam</text></svg>',
      );
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    const stream = canvas.captureStream(10);
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
    const chunks = [];
    const recorded = new Promise((resolve) => {
      recorder.ondataavailable = (event) => chunks.push(event.data);
      recorder.onstop = () =>
        resolve(URL.createObjectURL(new Blob(chunks, { type: "video/webm" })));
    });
    recorder.start();
    const ctx = canvas.getContext("2d");
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = i % 2 ? "#225577" : "#336688";
      ctx.fillRect(0, 0, 320, 180);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    recorder.stop();
    const video = await recorded;
    stream.getTracks().forEach((track) => track.stop());
    for (const [id, extra] of [
      ["AST_IMG", { role: "regular_image" }],
      ["AST_REF", { role: "material_reference" }],
      [
        "AST_CLIP",
        {
          role: "regular_image",
          mediaKind: "video",
          mimeType: "video/webm",
          absolutePath: video,
          parentAssetId: "AST_IMG",
          durationMs: 1200,
          posterSource: "source",
        },
      ],
    ])
      db.assets[id] = asset(p.id, id, { absolutePath: image, thumbnailPath: image, ...extra });
    await useStudio.getState().openProject(p.id);
    useStudio.setState((s) => ({
      workspace: {
        ...s.workspace,
        generations: [
          {
            id: "GEN_QA",
            projectId: p.id,
            providerId: "local_preview",
            modelId: "placeholder-v1",
            purpose: "video",
            status: "completed",
            referenceAssetIds: ["AST_IMG", "AST_REF"],
            parentAssetId: "AST_IMG",
            outputAssetIds: ["AST_CLIP"],
            prompt: { positivePrompt: "Mock QA", shotIntent: { presetIds: [] } },
            createdAt: "2026-01-01T00:00:00Z",
            error: null,
          },
        ],
      },
    }));
    useStudio.getState().setWorkspaceMode("node");
    useStudio.getState().setModule("generate");
    window.qaWrites = [];
  });
  await page.getByTestId("branch-canvas").waitFor();
  await page.evaluate(async () => {
    await document.fonts.load('400 14px "Be Vietnam Pro"');
    await document.fonts.ready;
  });
  assert(await page.evaluate(() => document.fonts.check('400 14px "Be Vietnam Pro"')));
  const result = { fontLoaded: true, selection: [], resize: [] };
  for (const [id, module, kind] of [
    ["AST_CLIP", "video", "video"],
    ["AST_REF", "references", "reference"],
    ["AST_IMG", "generate", "image"],
  ]) {
    await page.locator(`[data-node="asset:${id}"]`).click();
    await page.waitForFunction(
      async (expected) =>
        (await import("/src/app/store.ts")).useStudio.getState().activeModule === expected,
      module,
    );
    assert.equal(await page.getByTestId("context-toolbar").getAttribute("data-selection"), kind);
    if (kind === "video") await page.getByTestId("video-panel").waitFor();
    result.selection.push({ id, module, toolbar: kind });
    await page.screenshot({ path: resolve(output, `r2-node-${kind}.png`) });
  }
  await page.evaluate(async () => {
    const s = (await import("/src/app/store.ts")).useStudio.getState();
    s.setWorkspaceMode("studio");
    s.setGenerateDraft({ extraPrompt: "Giữ nguyên bản nháp" });
  });
  for (const [width, height] of [
    [1920, 1080],
    [1280, 720],
    [1000, 768],
    [800, 600],
    [960, 540],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width, height });
    await page.waitForFunction((width) => {
      const shell = document.querySelector('[data-testid="workspace"]');
      return (
        shell?.dataset.tier ===
        (width >= 1600 ? "wide" : width >= 1280 ? "regular" : width >= 1000 ? "compact" : "narrow")
      );
    }, width);
    const measured = await page.evaluate(async () => {
      const s = (await import("/src/app/store.ts")).useStudio.getState();
      return {
        horizontalScroll: document.documentElement.scrollWidth > innerWidth,
        draft: s.generateDraft.extraPrompt,
        selection: s.selectedAssetId,
      };
    });
    assert.equal(measured.horizontalScroll, false);
    assert.equal(measured.draft, "Giữ nguyên bản nháp");
    assert.equal(measured.selection, "AST_IMG");
    result.resize.push({ width, height, ...measured });
    await page.screenshot({ path: resolve(output, `r2-resize-${width}x${height}.png`) });
  }
  // Real scroll in Chromium, rather than a jsdom property assignment.
  await page.evaluate(() => {
    document.querySelector(".panel-body").scrollTop = 160;
  });
  const scroll = await page.locator(".panel-body").evaluate((el) => el.scrollTop);
  assert(scroll > 0);
  await page.setViewportSize({ width: 800, height: 600 });
  await page.setViewportSize({ width: 1920, height: 1080 });
  assert.equal(await page.locator(".panel-body").evaluate((el) => el.scrollTop), scroll);
  await page.getByTestId("preview-expand").click();
  await page.getByRole("button", { name: "Enter fullscreen", exact: true }).click();
  await page.waitForFunction(() => !!document.fullscreenElement);
  result.fullscreenEntered = true;
  await page.screenshot({ path: resolve(output, "r2-viewer-fullscreen.png") });
  await page.getByRole("button", { name: "Exit fullscreen", exact: true }).click();
  await page.waitForFunction(() => !document.fullscreenElement);
  await page.getByTestId("viewer-close").click();
  assert.equal(await page.locator(".panel-body").evaluate((el) => el.scrollTop), scroll);
  result.inspectorScrollKept = scroll;
  // A playing workspace video is paused before the viewer's separate player opens.
  await page.evaluate(async () => {
    const s = (await import("/src/app/store.ts")).useStudio.getState();
    s.selectAsset("AST_CLIP");
  });
  await page.getByTestId("video-player").waitFor();
  await page.locator('[data-testid="video-player"] video').evaluate(async (video) => {
    video.loop = true;
    await Promise.race([
      video.play(),
      new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `Video did not play: readyState=${video.readyState}, networkState=${video.networkState}, error=${video.error?.message}`,
              ),
            ),
          10000,
        ),
      ),
    ]);
  });
  assert.equal(
    await page.locator('[data-testid="video-player"] video').evaluate((video) => video.paused),
    false,
  );
  await page.getByTestId("preview-expand").click();
  assert(
    await page.locator('[data-testid="video-player"] video').evaluate((video) => video.paused),
  );
  const clip = page.locator('[data-testid="viewer-video"] video');
  assert(await clip.evaluate((video) => video.paused));
  await clip.evaluate(async (video) => {
    await Promise.race([
      video.play(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Viewer video did not play")), 10000),
      ),
    ]);
  });
  await page.getByTestId("viewer-close").click();
  assert.equal(
    await page.locator("video").evaluateAll((videos) => videos.filter((v) => !v.paused).length),
    0,
  );
  result.videoPlaybackStops = true;
  assert.deepEqual(await page.evaluate(() => window.qaWrites), []);
  result.noWrites = true;
  await writeFile(resolve(output, "r2-measurements.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ passed: true, output, ...result }, null, 2));
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) await page.screenshot({ path: resolve(output, "failure.png") });
  console.error(`Browser QA artifacts: ${output}`);
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
