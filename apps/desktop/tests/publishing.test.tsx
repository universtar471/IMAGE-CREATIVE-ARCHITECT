/** SRS P5b (ADR-038): Publishing Studio helpers, rendering geometry, storage and the UI. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  PUBLICATION_STYLES,
  PublicationDocumentSchema,
  randomize,
  type AssetDTO,
  type CaptionPageSlot,
  type ImageSlot,
  type Publication,
  type PublicationFact,
} from "@arch/domain";
import vector from "../../../packages/domain/test-vectors/publication-document.json";
import { createProject } from "../src/app/services";
import { useStudio } from "../src/app/store";
import { useLocale } from "../src/i18n";
import { call, setTransport, type Transport } from "../src/lib/bridge";
import { createMockTransport } from "../src/lib/mockBackend";
import { PublishingPanel } from "../src/features/publishing/PublishingPanel";
import { PublishingStudio } from "../src/features/publishing/PublishingStudio";
import {
  applyAiCaptions,
  approveCaption,
  defaultSettings,
  exportGate,
  planFromSettings,
  publicationIssues,
  publishableAssets,
  replaceImage,
  setCaptionText,
  setSentenceFact,
  settingsForStyle,
  swapImages,
  toggleLock,
  toPublicationAsset,
} from "../src/features/publishing/publishing";
import {
  exportPixelSize,
  fitImage,
  neededSourceEdge,
  pageDrawOps,
  wrapText,
} from "../src/features/publishing/render";
import { usePublishing } from "../src/features/publishing/store";
import { WORKSPACE_MODULES } from "../src/features/workspace/modules";
import { en } from "../src/i18n/en";
import { vi as viDict } from "../src/i18n/vi";
import { asset } from "./helpers";

const P = "PRJ_PUB";
const images: AssetDTO[] = [
  asset(P, "AST_M", { role: "master_architecture", widthPx: 4000, heightPx: 3000 }),
  asset(P, "AST_2", { role: "regular_image", widthPx: 4000, heightPx: 3000 }),
  asset(P, "AST_3", { role: "regular_image", widthPx: 4000, heightPx: 3000 }),
  asset(P, "AST_REF", { role: "material_reference" }),
  asset(P, "AST_GONE", { role: "regular_image", status: "missing_file" }),
];
const fact: PublicationFact = {
  id: "FACT_1",
  text: "Completed in 2024",
  status: "user_declared",
  sourceAssetIds: [],
};

function plan(overrides: Partial<ReturnType<typeof defaultSettings>> = {}): Publication {
  return planFromSettings({ ...defaultSettings(images), ...overrides }, images);
}

const captions = (pub: Publication) =>
  pub.pages.flatMap((page) =>
    page.slots
      .filter((slot): slot is CaptionPageSlot => slot.type === "caption")
      .map((slot) => ({ pageId: page.id, slot })),
  );
const imageSlots = (pub: Publication) =>
  pub.pages.flatMap((page) =>
    page.slots
      .filter((slot): slot is ImageSlot => slot.type === "image")
      .map((slot) => ({ pageId: page.id, slot })),
  );

describe("publishing helpers", () => {
  it("offers only ready, hashed project images (no references or missing files)", () => {
    expect(publishableAssets(images).map((a) => a.id)).toEqual(["AST_M", "AST_2", "AST_3"]);
    expect(toPublicationAsset(images[0]!)).toMatchObject({
      assetId: "AST_M",
      sourceHash: "AST_M",
      importance: 1,
    });
  });

  it("plans exactly targetPageCount pages, pinning every image by hash", () => {
    for (const targetPageCount of [1, 2, 5]) {
      const pub = plan({ targetPageCount });
      expect(pub.pages).toHaveLength(targetPageCount);
      expect(pub.assetPins.map((p) => p.assetId)).toEqual(["AST_M", "AST_2", "AST_3"]);
    }
  });

  it("switches the type with the style picked in the gallery", () => {
    const next = settingsForStyle(defaultSettings(images), "magazine_retro_modern");
    expect(next).toMatchObject({ type: "magazine", styleId: "magazine_retro_modern" });
    expect(PUBLICATION_STYLES).toHaveLength(16);
  });

  it("swaps images between frames and never touches a locked page", () => {
    const pub = plan({ type: "portfolio", styleId: "portfolio_minimal_white", targetPageCount: 2 });
    const [a, , c] = imageSlots(pub);
    const swapped = swapImages(
      pub,
      { pageId: a!.pageId, slotId: a!.slot.id },
      { pageId: c!.pageId, slotId: c!.slot.id },
    );
    const after = imageSlots(swapped);
    expect(after[0]!.slot.assetId).toBe(c!.slot.assetId);
    expect(after[2]!.slot.assetId).toBe(a!.slot.assetId);
    expect(after[0]!.slot.rect).toEqual(a!.slot.rect);

    const locked = toggleLock(pub, c!.pageId);
    expect(
      swapImages(
        locked,
        { pageId: a!.pageId, slotId: a!.slot.id },
        { pageId: c!.pageId, slotId: c!.slot.id },
      ),
    ).toBe(locked);
    const shuffled = randomize(locked, "smart", 99);
    expect(shuffled.pages.find((p) => p.id === c!.pageId)).toEqual(
      locked.pages.find((p) => p.id === c!.pageId),
    );
  });

  it("replaces an image with a new pin and unselects the image it replaced", () => {
    const pub = plan({ selectedImageIds: ["AST_M", "AST_2"] });
    const target = imageSlots(pub).find((s) => s.slot.assetId === "AST_2")!;
    const next = replaceImage(
      pub,
      { pageId: target.pageId, slotId: target.slot.id },
      toPublicationAsset(images[2]!),
    );
    expect(imageSlots(next).map((s) => s.slot.assetId)).toContain("AST_3");
    expect(next.selectedImageIds).toEqual(["AST_M", "AST_3"]);
    expect(next.assetPins).toContainEqual({ assetId: "AST_3", sourceHash: "AST_3" });
    expect(publicationIssues(next, images, [], []).issues.map((i) => i.code)).not.toContain(
      "REQUIRED_IMAGE_MISSING",
    );
  });

  it("marks an unbacked claim for review and clears it when a fact is linked", () => {
    const pub = plan();
    const { pageId, slot } = captions(pub)[0]!;
    const ref = { pageId, slotId: slot.id };
    const written = setCaptionText(pub, ref, "Hoàn thành năm 2024. Ánh sáng dịu.", [fact]);
    const caption = captions(written)[0]!.slot.caption;
    expect(caption.sentences.map((s) => s.needs_review)).toEqual([true, false]);
    let validation = publicationIssues(written, images, [fact], []);
    expect(exportGate(validation).status).toBe("blocked");
    expect(validation.issues.map((i) => i.code)).toContain("UNVERIFIED_PUBLICATION_FACT");

    const linked = setSentenceFact(written, ref, 0, "FACT_1", [fact]);
    expect(captions(linked)[0]!.slot.caption.sentences[0]).toMatchObject({
      factRef: "FACT_1",
      needs_review: false,
    });
    validation = publicationIssues(linked, images, [fact], []);
    expect(validation.issues.map((i) => i.code)).not.toContain("UNVERIFIED_PUBLICATION_FACT");
  });

  it("lands AI captions as needs_review until approved, and rejects a bad answer", () => {
    const pub = plan();
    const { slot } = captions(pub)[0]!;
    const raw =
      'Here you go:\n```json\n{"slots":[{"slotId":"' +
      slot.id +
      '","sentences":[{"text":"Ánh sáng trải đều.","factRef":null}]},{"slotId":"NOPE","sentences":[]}]}\n```';
    const result = applyAiCaptions(pub, raw, [fact])!;
    expect(result.filled).toBe(1);
    expect(result.ignoredSlotIds).toEqual(["NOPE"]);
    const drafted = captions(result.publication)[0]!;
    expect(drafted.slot.caption.needs_review).toBe(true);
    expect(drafted.slot.caption.sentences[0]!.needs_review).toBe(true);
    const validation = publicationIssues(result.publication, images, [fact], []);
    expect(validation.issues).toContainEqual(
      expect.objectContaining({
        code: "UNVERIFIED_PUBLICATION_FACT",
        params: { reason: "needs_review" },
      }),
    );
    expect(exportGate(validation).status).toBe("blocked");

    const approved = approveCaption(
      result.publication,
      { pageId: drafted.pageId, slotId: drafted.slot.id },
      [fact],
    );
    expect(captions(approved)[0]!.slot.caption.needs_review).toBe(false);
    expect(applyAiCaptions(pub, "no json here", [fact])).toBeNull();
    expect(applyAiCaptions(pub, '{"slots":"x"}', [fact])).toBeNull();
  });

  it("asks for confirmation on readability warnings, refuses BLOCK issues", () => {
    const small = images.map((a) => ({ ...a, widthPx: 400, heightPx: 300 }));
    const pub = planFromSettings({ ...defaultSettings(small), paper: "A3" }, small);
    const validation = publicationIssues(pub, small, [], []);
    expect(validation.issues.map((i) => i.code)).toContain("PRINT_READABILITY_LOW");
    expect(exportGate(validation).status).toBe("confirm");
    expect(exportGate(publicationIssues(pub, small, [], ["PRINT_READABILITY_LOW"])).status).toBe(
      "ready",
    );
    const missing = { ...pub, pages: pub.pages.slice(0, 0) };
    expect(exportGate(publicationIssues(missing, small, [], [])).status).toBe("blocked");
  });
});

describe("page rendering geometry", () => {
  const measure = (text: string) => text.length * 10;

  it("renders print papers at 150 dpi and 16:9 at 1920 × 1080", () => {
    expect(exportPixelSize("A4")).toEqual({ width: 1240, height: 1754 });
    expect(exportPixelSize("A3")).toEqual({ width: 1754, height: 2480 });
    expect(exportPixelSize("16:9")).toEqual({ width: 1920, height: 1080 });
  });

  it("draws background, every image frame and the written text", () => {
    const pub = plan();
    const { pageId, slot } = captions(pub)[0]!;
    const withText = setCaptionText(pub, { pageId, slotId: slot.id }, "Ánh sáng dịu.", []);
    const size = exportPixelSize(pub.paper, 0.25);
    const ops = pageDrawOps(withText, withText.pages[0]!, size, measure);
    expect(ops[0]).toMatchObject({ kind: "fill", box: { x: 0, y: 0, w: size.width } });
    expect(ops.filter((op) => op.kind === "image")).toHaveLength(3);
    const text = ops.find((op) => op.kind === "text");
    expect(text && text.kind === "text" && text.lines.join(" ")).toBe("Ánh sáng dịu.");
  });

  it("wraps words, breaks long words and crops cover images around the center", () => {
    expect(wrapText("one two three", 75, "f", measure)).toEqual(["one two", "three"]);
    expect(wrapText("abcdefghij", 40, "f", measure)).toEqual(["abcd", "efgh", "ij"]);
    expect(
      fitImage({ width: 400, height: 100 }, { x: 0, y: 0, w: 100, h: 100 }, "cover").source,
    ).toEqual({ x: 150, y: 0, w: 100, h: 100 });
    expect(
      fitImage({ width: 400, height: 100 }, { x: 0, y: 0, w: 100, h: 100 }, "contain").target,
    ).toEqual({ x: 0, y: 37.5, w: 100, h: 25 });
    expect(
      neededSourceEdge({ width: 8000, height: 6000 }, { x: 0, y: 0, w: 800, h: 600 }, "cover"),
    ).toBe(800);
    expect(
      neededSourceEdge({ width: 100, height: 50 }, { x: 0, y: 0, w: 800, h: 600 }, "cover"),
    ).toBe(256);
  });
});

describe("publication storage contract", () => {
  it("the shared test vector is a valid stored document", () => {
    expect(PublicationDocumentSchema.safeParse(vector).success).toBe(true);
  });

  it("the mock backend saves, lists, reopens and deletes a book", async () => {
    setTransport(createMockTransport({ projects: {}, dna: {}, assets: {}, versions: [] }));
    const project = await createProject({
      name: "Books",
      projectType: "villa",
      subtype: "default",
      starter: {},
    });
    const doc = PublicationDocumentSchema.parse(vector);
    const saved = await call("publication_save", {
      projectId: project.id,
      publicationId: null,
      publication: doc.publication,
      facts: doc.facts,
    });
    expect(saved.id).toMatch(/^PUB_/);
    const list = await call("publication_list", { projectId: project.id });
    expect(list).toEqual([
      expect.objectContaining({ id: saved.id, type: "portfolio", paper: "A4", targetPageCount: 2 }),
    ]);
    const got = await call("publication_get", { projectId: project.id, publicationId: saved.id });
    expect(got.publication).toEqual(doc.publication);
    await expect(
      call("publication_save", {
        projectId: project.id,
        publicationId: saved.id,
        publication: { ...doc.publication, targetPageCount: 0 },
        facts: [],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await call("publication_delete", { projectId: project.id, publicationId: saved.id });
    expect(await call("publication_list", { projectId: project.id })).toEqual([]);
    setTransport(null);
  });
});

describe("module registry and dictionaries", () => {
  it("opens the export module as the Publishing Studio", () => {
    const mod = WORKSPACE_MODULES.find((m) => m.id === "export")!;
    expect(mod.availableIn).toBeNull();
    expect(en.modules.export.label).toBe("Publishing Studio");
    expect(viDict.modules.export.label).toBe("Studio xuất bản");
    expect(viDict.publishing.needsReview).toBe("Cần duyệt");
    for (const value of [
      viDict.publishing.plan,
      viDict.publishing.exportPdf,
      viDict.publishing.check,
    ])
      expect(value).toMatch(/[À-ỹ]/);
  });
});

// ---------------------------------------------------------------- UI

type Db = NonNullable<Parameters<typeof createMockTransport>[0]>;
let db: Db;
let sent: { command: string; request: unknown }[];

async function openStudio() {
  const project = await createProject({
    name: "Villa book",
    projectType: "villa",
    subtype: "default",
    starter: {},
  });
  for (const item of images) db.assets[item.id] = { ...item, projectId: project.id };
  await useStudio.getState().openProject(project.id);
  useStudio.setState({ activeModule: "export" });
  render(
    <>
      <PublishingStudio />
      <PublishingPanel />
    </>,
  );
  return project;
}

describe("Publishing Studio UI", () => {
  beforeEach(() => {
    useLocale.setState({ locale: "en" });
    db = { projects: {}, dna: {}, assets: {}, versions: [] };
    sent = [];
    const base = createMockTransport(db);
    const spy: Transport = async (command, args) => {
      sent.push({ command, request: args.request });
      return base(command, args);
    };
    spy.connectEvents = base.connectEvents;
    setTransport(spy);
    useStudio.setState({ route: { name: "hub" }, workspace: null, providers: [] });
    usePublishing.setState({ projectId: null });
  });
  afterEach(() => {
    cleanup();
    setTransport(null);
  });

  it("plans, edits a caption, links a fact and saves the book", async () => {
    await openStudio();
    expect(screen.getByTestId("publishing-empty")).toBeTruthy();
    expect(screen.queryByTestId("pub-ai-captions")).toBeNull();

    fireEvent.change(screen.getByTestId("pub-page-count"), { target: { value: "2" } });
    fireEvent.click(screen.getByTestId("pub-plan"));
    await waitFor(() => screen.getByTestId("publishing-studio"));
    expect(screen.getAllByTestId(/^pub-thumb-/)).toHaveLength(2);

    const captionSlot = usePublishing
      .getState()
      .publication!.pages[0]!.slots.find((slot) => slot.type === "caption")!;
    fireEvent.click(screen.getByTestId(`pub-slot-${captionSlot.id}`));
    const box = screen.getByTestId("pub-caption");
    fireEvent.change(box, { target: { value: "Completed in 2024." } });
    fireEvent.blur(box);
    await waitFor(() => screen.getByTestId("pub-review-badge"));
    expect(screen.getByTestId("pub-review-badge").textContent).toBe("Needs review");
    expect(screen.getByTestId("pub-export-blocked")).toBeTruthy();
    expect((screen.getByTestId("pub-export-pdf") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByTestId("pub-fact-input"), {
      target: { value: "Completed in 2024" },
    });
    fireEvent.click(screen.getByTestId("pub-fact-add"));
    const sentence = screen.getByTestId("pub-sentence-0");
    fireEvent.change(within(sentence).getByRole("combobox"), { target: { value: "FACT_1" } });
    await waitFor(() => screen.getByTestId("pub-fact-badge"));
    expect(screen.queryByTestId("pub-export-blocked")).toBeNull();
    expect((screen.getByTestId("pub-export-pdf") as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByTestId("pub-save"));
    await waitFor(() => expect(sent.some((s) => s.command === "publication_save")).toBe(true));
    await waitFor(() => expect(usePublishing.getState().records).toHaveLength(1));
    const request = sent.find((s) => s.command === "publication_save")!.request as {
      publication: Publication;
      facts: PublicationFact[];
    };
    expect(request.publication.pages).toHaveLength(2);
    expect(request.facts).toEqual([
      expect.objectContaining({ id: "FACT_1", status: "user_declared" }),
    ]);

    // No raw i18n keys anywhere in the studio.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const raw: string[] = [];
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent?.trim() ?? "";
      if (/^[a-z]+(\.[a-zA-Z0-9_:]+){1,}$/.test(text)) raw.push(text);
    }
    expect(raw).toEqual([]);
  });

  it("randomizes with a visible seed and keeps a locked page", async () => {
    await openStudio();
    fireEvent.change(screen.getByTestId("pub-page-count"), { target: { value: "3" } });
    fireEvent.click(screen.getByTestId("pub-plan"));
    await waitFor(() => screen.getByTestId("publishing-studio"));
    fireEvent.click(screen.getByTestId("pub-lock"));
    const before = usePublishing.getState().publication!;
    expect(before.lockedPageIds).toEqual(["PAGE_1"]);
    expect((screen.getByTestId("pub-plan") as HTMLButtonElement).disabled).toBe(true);

    const seed = screen.getByTestId("pub-seed") as HTMLInputElement;
    fireEvent.change(seed, { target: { value: "4242" } });
    fireEvent.click(screen.getByTestId("pub-random-smart"));
    const after = usePublishing.getState().publication!;
    expect(after.seed).toBe(4242);
    expect(after.pages[0]).toEqual(before.pages[0]);
    expect(seed.value).toBe("4242");
  });

  it("shows the AI caption button only for a configured text provider and lands drafts for review", async () => {
    const project = await openStudio();
    await call("provider_set_api_key", { providerId: "hhtech", apiKey: "test-not-real" });
    await useStudio.getState().loadProviders();
    fireEvent.click(screen.getByTestId("pub-plan"));
    await waitFor(() => screen.getByTestId("pub-ai-captions"));
    fireEvent.click(screen.getByTestId("pub-ai-captions"));
    // The spend confirmation is the gate before the paid call.
    const confirm = await screen.findByRole("button", { name: en.spend.create });
    expect(sent.some((s) => s.command === "publication_caption_draft")).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(
        captions(usePublishing.getState().publication!)[0]!.slot.caption.sentences,
      ).toHaveLength(1),
    );
    const call0 = sent.find((s) => s.command === "publication_caption_draft")!.request as {
      projectId: string;
      prompt: string;
    };
    expect(call0.projectId).toBe(project.id);
    expect(call0.prompt).toContain("You are an architectural editor.");
    const drafted = captions(usePublishing.getState().publication!);
    expect(drafted.every((c) => c.slot.caption.needs_review)).toBe(true);
    expect(screen.getByTestId("pub-export-blocked")).toBeTruthy();
  });
});
