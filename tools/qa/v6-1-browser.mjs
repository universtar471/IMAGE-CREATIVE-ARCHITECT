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
        /^(generation_submit|dna_update|asset_(import|update_role|set_master|remove)|job_retry|job_cancel|canvas_layout_save)/.test(
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
    let image =
      "data:image/svg+xml," +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#183c5b"/><path d="M300 650V350L800 100l500 250v300z" fill="#d9e7eb"/><text x="600" y="800" fill="white" font-size="50">Kiến trúc Việt Nam</text></svg>',
      );
    const png = async (source) => {
      const img = new Image();
      img.src = source;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext("2d").drawImage(img, 0, 0);
      return c.toDataURL("image/png");
    };
    image = await png(image);
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
    let portrait =
      "data:image/svg+xml," +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="1600"><rect width="480" height="1600" fill="white"/><rect width="480" height="80" fill="#20bfff"/><path d="M80 1400V400L240 220l160 180v1000z" fill="#1c3d5a"/><rect y="1520" width="480" height="80" fill="#d45cff"/></svg>',
      );
    portrait = await png(portrait);
    db.assets.AST_TALL = asset(p.id, "AST_TALL", {
      role: "regular_image",
      source: "external",
      widthPx: 480,
      heightPx: 1600,
      absolutePath: portrait,
      thumbnailPath: portrait,
    });
    await useStudio.getState().openProject(p.id);
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
  await page.waitForFunction(
    () => {
      const flow = document.querySelector(".branch-flow");
      const nodes = [...flow.querySelectorAll(".react-flow__node")];
      const box = flow.getBoundingClientRect();
      return (
        nodes.length === 4 &&
        nodes.every((node) => {
          const r = node.getBoundingClientRect();
          return r.width > 0 && r.top >= box.top - 1 && r.bottom <= box.bottom + 1;
        })
      );
    },
    null,
    { timeout: 3000 },
  );
  const initialNodesFit = await page.locator(".branch-flow").evaluate((flow) => {
    const box = flow.getBoundingClientRect();
    return [...flow.querySelectorAll(".react-flow__node")].every((node) => {
      const r = node.getBoundingClientRect();
      return (
        r.top >= box.top - 1 &&
        r.bottom <= box.bottom + 1 &&
        r.left >= box.left - 1 &&
        r.right <= box.right + 1
      );
    });
  });
  assert(initialNodesFit, "Initial graph must fit imported nodes after layout loads");
  result.initialNodesFit = true;
  // No generations and no master: ordinary imports must still exist in Node mode.
  await page.locator('[data-node="asset:AST_TALL"]').waitFor();
  await page.locator('[data-testid="asset-thumb"][title="AST_TALL.jpg"]').click();
  assert.deepEqual(
    await page.evaluate(
      async () => (await import("/src/app/store.ts")).useStudio.getState().canvasSelection,
    ),
    ["asset:AST_TALL"],
  );
  result.standaloneImportsVisible = true;
  result.traySelectsNode = true;
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
    await page.waitForFunction(() => {
      const shell = document.querySelector('[data-testid="workspace"]');
      const panel = document.querySelector('[data-testid="property-panel"]');
      return (
        !shell.hasAttribute("data-drawer") ||
        shell.hasAttribute("data-inspector-open") ||
        getComputedStyle(panel).visibility === "hidden"
      );
    });
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
    const cards = await page.getByTestId("asset-thumb").evaluateAll((tiles) =>
      tiles.map((tile) => {
        const r = tile.getBoundingClientRect();
        const strip = tile.closest(".asset-strip").getBoundingClientRect();
        const image = tile.querySelector(".asset-thumb-img").getBoundingClientRect();
        return {
          fits: r.bottom <= strip.bottom + 1,
          visibleImage: image.height > 0,
          contain: getComputedStyle(tile.querySelector("img")).objectFit === "contain",
        };
      }),
    );
    assert(cards.every((card) => card.fits && card.visibleImage && card.contain));
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
  // Imported images unlock editing without approving/promoting a Master.
  await page.evaluate(async () =>
    (await import("/src/app/store.ts")).useStudio.getState().setModule("enhance"),
  );
  assert.equal(await page.locator('[data-testid="enhance-panel"] .btn-primary').isEnabled(), true);
  await page.evaluate(async () =>
    (await import("/src/app/store.ts")).useStudio.getState().setModule("mood_grade"),
  );
  assert.equal(await page.locator('[data-step-id="post.grade"] fieldset').isDisabled(), false);
  assert.equal(
    await page.evaluate(
      async () =>
        (await import("/src/app/store.ts")).useStudio.getState().workspace.project
          .activeMasterAssetId,
    ),
    null,
  );
  result.editingWithoutMaster = true;
  result.trayPortraitFits = true;
  await page.screenshot({ path: resolve(output, "imported-image-editing.png") });
  await page.evaluate(async () =>
    (await import("/src/app/store.ts")).useStudio.getState().setModule("generate"),
  );
  await page.evaluate(async () => {
    const s = (await import("/src/app/store.ts")).useStudio.getState();
    s.setGenerateDraft({ source: "sketch", referenceAssetIds: ["AST_IMG"] });
  });
  assert.equal(await page.locator(".generate-btn").isEnabled(), true);
  result.importedSourceCanGenerate = true;
  assert.equal(await page.getByTestId("generate-mode-advanced").count(), 0);
  const providerPicker = page.getByRole("combobox", { name: "Provider", exact: true });
  await providerPicker.selectOption("gemini");
  await page
    .getByRole("combobox", { name: "Model", exact: true })
    .selectOption("gemini-2.5-flash-image");
  assert.equal(
    await page.locator(".generate-btn").isDisabled(),
    true,
    "Missing API key still blocks submission",
  );
  await providerPicker.selectOption("local_preview");
  await page.evaluate(async () => {
    const s = (await import("/src/app/store.ts")).useStudio.getState();
    s.setGenerateDraft({ source: "dna", referenceAssetIds: [] });
  });
  assert.equal(await page.locator(".generate-btn").isEnabled(), true);
  assert.equal(
    await page.evaluate(async () =>
      (await import("/src/app/store.ts")).useStudio
        .getState()
        .workflowView.steps.some((step) => step.status === "locked"),
    ),
    false,
  );
  result.simpleModelSelection = true;
  result.dnaOnlyWithoutConfirmation = true;
  await page.screenshot({ path: resolve(output, "free-generation-models.png") });
  // The owner's preset combination raises a motion finding but must remain generatable.
  await page.evaluate(async () => {
    const s = (await import("/src/app/store.ts")).useStudio.getState();
    s.setGenerateDraft({ source: "sketch", referenceAssetIds: ["AST_IMG"] });
  });
  for (const name of ["Dawn", "City car", "Vehicle light trails"])
    await page.getByRole("button", { name, exact: true }).click();
  assert.equal(await page.locator(".generate-btn").isEnabled(), true);
  const creativeHint = page.getByTestId("conflict-panel");
  assert.match(await creativeHint.innerText(), /You can generate with the current choices/);
  assert.equal(await creativeHint.getAttribute("role"), "status");
  await creativeHint.scrollIntoViewIfNeeded();
  result.creativeConflictDoesNotBlock = true;
  await page.screenshot({ path: resolve(output, "advisory-creative-conflicts.png") });
  await page.evaluate(async () => {
    const s = (await import("/src/app/store.ts")).useStudio.getState();
    s.setGenerateDraft({ source: "sketch", purpose: "variation", referenceAssetIds: ["AST_IMG"] });
    s.setShotIntent({ projectType: "villa" });
  });
  await page.getByTestId("variation-source").waitFor();
  assert.equal(await page.locator(".panel-body").evaluate((el) => el.scrollTop), 0);
  assert.equal(await page.locator('[data-preset="render.sketch_to_photo"]').count(), 0);
  assert.equal(await page.locator('[data-preset="camera.detail"]').count(), 1);
  await page.screenshot({ path: resolve(output, "variation-settings.png") });
  await page.evaluate(async () => {
    const s = (await import("/src/app/store.ts")).useStudio.getState();
    s.selectAsset("AST_IMG", { keepView: true });
    s.setWorkspaceMode("node");
    s.setModule("video");
  });
  await page.getByTestId("video-panel").waitFor();
  assert.equal(await page.getByRole("combobox", { name: "Model", exact: true }).count(), 1);
  await page.locator('[data-node="draft"]').filter({ hasText: "Create video" }).waitFor();
  assert.equal(await page.locator(".motion-chip svg").count(), 8);
  await page.screenshot({ path: resolve(output, "video-model-and-draft.png") });
  await page.evaluate(async () =>
    (await import("/src/app/store.ts")).useStudio.getState().setModule("enhance"),
  );
  await page.getByTestId("enhance-panel").waitFor();
  assert.equal(await page.locator('[data-testid="enhance-mode-strict"] svg').count(), 1);
  await page.screenshot({ path: resolve(output, "enhance-icons.png") });
  result.variationVideoEnhance = true;
  // A playing workspace video is paused before the viewer's separate player opens.
  await page.evaluate(async () => {
    const s = (await import("/src/app/store.ts")).useStudio.getState();
    s.setWorkspaceMode("studio");
    s.selectAsset("AST_CLIP");
    s.setModule("generate");
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
  for (const kind of ["diagram", "export"]) {
    await page.evaluate(async (module) => {
      const s = (await import("/src/app/store.ts")).useStudio.getState();
      s.setWorkspaceMode("studio");
      s.selectAsset("AST_IMG");
      s.setModule(module);
    }, kind);
    const testId = kind === "diagram" ? "diagram-ai-panel" : "publishing-ai-panel";
    await page.getByTestId(testId).waitFor();
    assert.equal(await page.getByRole("combobox", { name: "Model", exact: true }).count(), 1);
    await page.screenshot({ path: resolve(output, `${kind}-ai-controls.png`) });
  }
  assert.deepEqual(await page.evaluate(() => window.qaWrites), []);
  await page.evaluate(async () => {
    const s = (await import("/src/app/store.ts")).useStudio.getState();
    const { call } = await import("/src/lib/bridge.ts");
    await call("canvas_layout_save", {
      projectId: s.workspace.project.id,
      layout: { version: 1, positions: { "asset:AST_IMG": { x: 6000, y: 4000 } } },
    });
    s.setNodeViewport(s.workspace.project.id, { x: -1430, y: -900, zoom: 0.25 });
    s.setModule("generate");
    s.setWorkspaceMode("node");
  });
  const distantNode = page.locator('[data-node="asset:AST_IMG"]');
  await distantNode.waitFor();
  await page.waitForTimeout(300);
  const viewportBefore = await page.locator(".react-flow__viewport").getAttribute("style");
  const nodeBox = await distantNode.boundingBox();
  assert(nodeBox && nodeBox.width > 0);
  await page.mouse.move(nodeBox.x + nodeBox.width / 2, nodeBox.y + nodeBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(nodeBox.x + nodeBox.width / 2 + 90, nodeBox.y + nodeBox.height / 2 + 40, {
    steps: 12,
  });
  await page.mouse.up();
  await page.waitForFunction(async () => {
    const s = (await import("/src/app/store.ts")).useStudio.getState();
    const { call } = await import("/src/lib/bridge.ts");
    const dto = await call("canvas_layout_get", { projectId: s.workspace.project.id });
    return dto.layout.positions["asset:AST_IMG"].x > 6300;
  });
  assert.equal(
    await page.locator(".react-flow__viewport").getAttribute("style"),
    viewportBefore,
    "dragging a distant node must not pan the canvas",
  );
  assert((await page.evaluate(() => window.qaWrites)).every((c) => c === "canvas_layout_save"));
  result.distantNodeDrag = true;
  result.aiDiagramAndPublishing = true;
  await page.screenshot({ path: resolve(output, "distant-node-drag.png") });
  // The dashed draft is a movable node too, including at a distant viewport.
  await page.evaluate(async () => {
    const s = (await import("/src/app/store.ts")).useStudio.getState();
    s.setGenerateDraft({ source: "sketch", referenceAssetIds: ["AST_IMG"] });
    const { call } = await import("/src/lib/bridge.ts");
    await call("canvas_layout_save", {
      projectId: s.workspace.project.id,
      layout: { version: 1, positions: { draft: { x: 6000, y: 4000 } } },
    });
    s.setWorkspaceMode("studio");
  });
  await page.locator(".branch-flow").waitFor({ state: "detached" });
  await page.evaluate(async () =>
    (await import("/src/app/store.ts")).useStudio.getState().setWorkspaceMode("node"),
  );
  const draft = page.locator('[data-node="draft"]');
  await draft.waitFor();
  await page.waitForTimeout(350);
  const draftBox = await draft.boundingBox();
  assert(draftBox && draftBox.width > 0);
  const draftViewport = await page.locator(".react-flow__viewport").getAttribute("style");
  await page.mouse.move(draftBox.x + draftBox.width / 2, draftBox.y + draftBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    draftBox.x + draftBox.width / 2 + 45,
    draftBox.y + draftBox.height / 2 + 20,
    { steps: 10 },
  );
  await page.mouse.up();
  await page.waitForFunction(async () => {
    const s = (await import("/src/app/store.ts")).useStudio.getState();
    const { call } = await import("/src/lib/bridge.ts");
    return (
      (await call("canvas_layout_get", { projectId: s.workspace.project.id })).layout.positions
        .draft?.x > 6100
    );
  });
  assert.equal(await page.locator(".react-flow__viewport").getAttribute("style"), draftViewport);
  result.draftDrag = true;
  for (const module of ["diagram", "export"]) {
    await page.evaluate(async (module) => {
      const s = (await import("/src/app/store.ts")).useStudio.getState();
      s.setModule(module);
      s.setWorkspaceMode("node");
    }, module);
    await page.locator(".branch-flow").waitFor();
    assert.equal(await page.getByRole("button", { name: "Node", exact: true }).isEnabled(), true);
  }
  result.sheetNodeAccess = true;
  await page.evaluate(async () => {
    const s = (await import("/src/app/store.ts")).useStudio.getState();
    s.setWorkspaceMode("studio");
    s.selectAsset("AST_TALL");
    s.setModule("regions");
  });
  const rectangle = page.getByRole("button", { name: "Rectangle", exact: true });
  await rectangle.click();
  assert((await rectangle.getAttribute("class")).includes("is-active"));
  const overlay = page.getByTestId("region-overlay");
  const rect = await overlay.boundingBox();
  assert(rect && rect.width > 0);
  await page.mouse.move(rect.x + rect.width * 0.2, rect.y + rect.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width * 0.6, rect.y + rect.height * 0.5, { steps: 8 });
  await page.mouse.up();
  await page.locator(".region-list-row").waitFor();
  const shape = await page.evaluate(async () => {
    const s = (await import("/src/app/store.ts")).useStudio.getState();
    const { call } = await import("/src/lib/bridge.ts");
    return (
      await call("region_list", { projectId: s.workspace.project.id, assetId: "AST_TALL" })
    )[0].shape;
  });
  assert(Math.abs(shape.x - 0.2) < 0.02 && Math.abs(shape.y - 0.2) < 0.02);
  assert(Math.abs(shape.w - 0.4) < 0.02 && Math.abs(shape.h - 0.3) < 0.02);
  result.regionDrawingAndPanelSync = true;
  await page.screenshot({ path: resolve(output, "regions-working.png") });
  await page.evaluate(async () => {
    const s = (await import("/src/app/store.ts")).useStudio.getState();
    s.setModule("mood_grade");
    s.editDna("colorGrade", {
      schemaVersion: 1,
      exposure: 45,
      contrast: 0,
      highlights: 0,
      shadows: 0,
      whites: 0,
      blacks: 0,
      temperature: 0,
      tint: 0,
      vibrance: 0,
      saturation: 0,
      clarity: 0,
      dehaze: 0,
    });
  });
  const checkSplitPixels = async (surface) => {
    const canvas = surface.locator("canvas");
    await canvas.waitFor();
    await page.waitForFunction(() =>
      [...document.querySelectorAll('[data-testid="grade-preview"] canvas')].every(
        (c) => c.width > 300,
      ),
    );
    const pixels = () =>
      canvas.evaluate((c) => {
        const ctx = c.getContext("2d");
        return [0.25, 0.75].map((x) => [
          ...ctx.getImageData(Math.floor(c.width * x), Math.floor(c.height * 0.5), 1, 1).data,
        ]);
      });
    // Grading runs in animation-frame chunks; a full 1600px image can need more
    // than 300ms on the Windows runner. Wait for the asserted pixels, not a timer.
    const waitForPixels = async (ready, message) => {
      const deadline = Date.now() + 10_000;
      let value;
      do {
        value = await pixels();
        if (ready(value)) return value;
        await page.waitForTimeout(50);
      } while (Date.now() < deadline);
      assert(ready(value), message);
      return value;
    };
    await surface.getByRole("button", { name: "Before", exact: true }).click();
    await page.waitForTimeout(150);
    const before = await pixels();
    await surface.getByRole("button", { name: "After", exact: true }).click();
    const after = await waitForPixels(
      (value) => JSON.stringify(value) !== JSON.stringify(before),
      "The chosen grade must finish rendering different preview pixels",
    );
    assert.notDeepEqual(before, after, "The chosen grade must change the preview pixels");
    await surface.getByRole("button", { name: "Split", exact: true }).click();
    const split = await waitForPixels(
      (value) =>
        JSON.stringify(value[0]) === JSON.stringify(before[0]) &&
        JSON.stringify(value[1]) === JSON.stringify(after[1]),
      "Split must finish restoring original pixels on the left and graded pixels on the right",
    );
    assert.deepEqual(split[0], before[0], "Split left shows the original");
    assert.deepEqual(split[1], after[1], "Split right shows the graded result");
    assert.equal(await surface.getByTestId("grade-preview-error").count(), 0);
  };
  const grade = page.getByTestId("grade-preview");
  await checkSplitPixels(grade);
  const bounds = await grade.evaluate((el) => {
    const a = el.getBoundingClientRect(),
      b = el.closest(".center-body").getBoundingClientRect();
    return { top: a.top >= b.top, bottom: a.bottom <= b.bottom + 1 };
  });
  assert(bounds.top && bounds.bottom, "Grade preview stays inside the workspace");
  await grade.getByRole("button", { name: "Split", exact: true }).click();
  assert.equal(await grade.getAttribute("data-mode"), "split");
  await page.screenshot({ path: resolve(output, "grade-contained.png") });
  result.gradeContained = true;
  await page.getByRole("button", { name: "Batch colour grade", exact: true }).click();
  const dialog = page.locator(".batch-grade-dialog");
  await dialog.waitFor();
  await dialog.locator(".batch-grade-toolbar select").selectOption("all");
  const gridHeight = await dialog
    .locator(".batch-grade-grid")
    .evaluate((el) => el.getBoundingClientRect().height);
  assert(gridHeight >= 150);
  assert.equal(
    await dialog.locator(".batch-grade-grid").evaluate((el) => getComputedStyle(el).resize),
    "vertical",
  );
  await dialog.locator(".batch-grade-settings select").selectOption("current");
  const preview = dialog.getByTestId("grade-preview");
  await checkSplitPixels(preview);
  await preview.getByRole("button", { name: "Split", exact: true }).click();
  assert.equal(await preview.getAttribute("data-mode"), "split");
  await preview.scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(output, "batch-grade-split.png") });
  result.batchGridResizable = true;
  await dialog.getByRole("button", { name: "Close", exact: true }).last().click();
  const downloadEvent = page.waitForEvent("download");
  await page
    .locator(".asset-select-wrap")
    .first()
    .getByRole("button", { name: "Download 1 files", exact: true })
    .click();
  const download = await downloadEvent;
  assert(download.suggestedFilename().length > 0);
  result.originalDownload = true;
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
