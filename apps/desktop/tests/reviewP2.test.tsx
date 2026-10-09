/**
 * Regression tests for docs/agent-reviews/p2-ui.md (Codex review of the Phase 2 UI),
 * applied to the Phase 3 code paths.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { COMPILER_VERSION, type GenerationDTO } from "@arch/domain";
import { createProject } from "../src/app/services";
import { EMPTY_GENERATE_DRAFT, startBackendSync, useStudio } from "../src/app/store";
import { ConfirmDialog, Dialog } from "../src/components/common/Dialog";
import { GenerationResult } from "../src/features/generate/GenerationResult";
import { ProviderSettingsDialog } from "../src/features/providers/ProviderSettingsDialog";
import { call, eventsReady, setTransport, type Transport } from "../src/lib/bridge";
import { createMockTransport } from "../src/lib/mockBackend";
import { asset, deferredTransport, settled, sleep, waitFor } from "./helpers";

type Db = NonNullable<Parameters<typeof createMockTransport>[0]>;
let db: Db;
let base: Transport;
let ctl: ReturnType<typeof deferredTransport>;
let stopSync: (() => void) | null = null;

function useMock(delayMs = 0) {
  db = { projects: {}, dna: {}, assets: {}, versions: [] };
  base = createMockTransport(db, { generationDelayMs: delayMs });
  ctl = deferredTransport(base);
  setTransport(ctl.transport);
}

beforeEach(() => {
  useMock();
  useStudio.setState({
    route: { name: "hub" },
    workspace: null,
    run: null,
    jobs: [],
    providers: null,
    providersError: null,
    providerDialog: null,
    generateDraft: EMPTY_GENERATE_DRAFT,
  });
});
afterEach(() => {
  cleanup();
  stopSync?.();
  stopSync = null;
  setTransport(null);
});

async function projectWithMaster(name: string) {
  const p = await createProject({
    name,
    projectType: "villa",
    subtype: "tropical",
    starter: { floors: 2 },
  });
  const masterId = `AST_M_${name.replace(/\W/g, "")}`;
  db.assets[masterId] = asset(p.id, masterId, { role: "master_architecture" });
  db.projects[p.id]!.activeMasterAssetId = masterId;
  return { project: p, masterId };
}

const input = (projectId: string, refs: string[]) => ({
  projectId,
  providerId: "local_preview",
  modelId: "placeholder-v1",
  purpose: "hero" as const,
  referenceAssetIds: refs,
  params: { aspectRatio: "16:9", imageSize: "1K", outputCount: 1, seed: null, quality: null },
});

describe("PHẢI SỬA 2 — submit is bound to its project", () => {
  it("keeps A's references when B is opened while the DNA flush is pending", async () => {
    const a = await projectWithMaster("A");
    const b = await projectWithMaster("B");
    await useStudio.getState().openProject(a.project.id);
    useStudio.getState().editDna("building.notes", "edit in A");
    ctl.hold("dna_update");
    const pending = useStudio.getState().submitGeneration(input(a.project.id, [a.masterId]));
    await waitFor(() => ctl.pending("dna_update") === 1, "dna_update in flight");

    await useStudio.getState().openProject(b.project.id);
    ctl.release("dna_update");
    const g = await pending;

    expect(g).toBeDefined();
    expect(g!.projectId).toBe(a.project.id);
    expect(g!.referenceAssetIds).toEqual([a.masterId]);
    expect(g!.prompt.referenceInstructions).toMatch(/^Image 1 .* MASTER/);
    expect((await call("dna_get", { projectId: a.project.id })).building.notes).toBe("edit in A");
    // B is untouched.
    expect(useStudio.getState().workspace!.project.id).toBe(b.project.id);
    expect(useStudio.getState().workspace!.generations).toEqual([]);
  });

  it("reports a reference that no longer exists instead of dropping it", async () => {
    const a = await projectWithMaster("A");
    await useStudio.getState().openProject(a.project.id);
    const g = await useStudio
      .getState()
      .submitGeneration(input(a.project.id, [a.masterId, "AST_gone"]));
    expect(g).toBeUndefined();
    expect(useStudio.getState().run).toMatchObject({
      status: "error",
      message: expect.stringMatching(/no longer exists/),
    });
    expect(await call("generation_list", { projectId: a.project.id })).toEqual([]);
  });
});

describe("PHẢI SỬA 3 — asset lists only land in their own project", () => {
  it("ignores a late asset_set_master result after switching to B", async () => {
    const a = await projectWithMaster("A");
    const b = await projectWithMaster("B");
    db.assets["AST_A2"] = asset(a.project.id, "AST_A2");
    await useStudio.getState().openProject(a.project.id);
    ctl.hold("asset_set_master");
    const late = call("asset_set_master", { projectId: a.project.id, assetId: "AST_A2" }).then(
      (list) => useStudio.getState().adoptAssets(a.project.id, list),
    );
    await waitFor(() => ctl.pending("asset_set_master") === 1, "asset_set_master in flight");
    await useStudio.getState().openProject(b.project.id);
    const before = useStudio.getState().workspace!.assets;
    ctl.release("asset_set_master");
    await late;
    expect(useStudio.getState().workspace!.project.id).toBe(b.project.id);
    expect(useStudio.getState().workspace!.assets).toBe(before);
    // Also an empty list for A never clears B.
    await useStudio.getState().adoptAssets(a.project.id, []);
    expect(useStudio.getState().workspace!.assets).toBe(before);
  });
});

describe("PHẢI SỬA 4 — reopening a project while its generation finishes", () => {
  it("reloads when a generation event arrives during the open", async () => {
    useMock(30);
    stopSync = startBackendSync();
    await eventsReady();
    const a = await projectWithMaster("A");
    await useStudio.getState().openProject(a.project.id);
    const g = (await useStudio.getState().submitGeneration(input(a.project.id, [a.masterId])))!;
    await useStudio.getState().goToHub();

    ctl.hold("project_get");
    ctl.hold("generation_list");
    const opening = useStudio.getState().openProject(a.project.id);
    await settled(a.project.id, g.id); // finishes while the first snapshot is held
    ctl.release("project_get");
    ctl.release("generation_list");
    await opening;

    const ws = useStudio.getState().workspace!;
    expect(ws.generations.find((x) => x.id === g.id)?.status).toBe("completed");
    expect(ws.assets.some((x) => x.source === "ai_generated")).toBe(true);
  });
});

describe("NÊN SỬA 1 — result card after its output was deleted", () => {
  it("shows the removal and disables the actions", async () => {
    const a = await projectWithMaster("A");
    await useStudio.getState().openProject(a.project.id);
    const gen: GenerationDTO = {
      id: "GEN_1",
      projectId: a.project.id,
      providerId: "local_preview",
      modelId: "placeholder-v1",
      purpose: "hero",
      status: "completed",
      prompt: {
        compilerVersion: COMPILER_VERSION,
        positivePrompt: "x",
        negativePrompt: "",
        referenceInstructions: "",
        preservationInstructions: "",
        metadata: {},
      },
      referenceAssetIds: [],
      params: { aspectRatio: null, imageSize: null, outputCount: 1, seed: null, quality: null },
      parentAssetId: null,
      outputAssetIds: ["AST_DELETED"],
      error: null,
      cameraId: null,
      batchId: null,
      jobId: null,
      createdAt: "2026-10-08T00:00:00Z",
      startedAt: "2026-10-08T00:00:00Z",
      finishedAt: "2026-10-08T00:00:01Z",
      durationMs: 1000,
    };
    const ws = useStudio.getState().workspace!;
    useStudio.setState({
      run: { status: "tracking", projectId: a.project.id, generation: gen },
      workspace: { ...ws, generations: [gen] },
    });
    render(<GenerationResult />);
    expect(screen.getByText(/outputs of this generation were removed/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: /Use as master/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe("NÊN SỬA 2 — a stale provider_list never overwrites Save/Clear", () => {
  it("drops a list that was requested before the key was saved", async () => {
    ctl.hold("provider_list");
    const loading = useStudio.getState().loadProviders();
    await waitFor(() => ctl.pending("provider_list") === 1, "provider_list in flight");
    const saved = await call("provider_set_api_key", { providerId: "gemini", apiKey: "k" });
    useStudio.getState().adoptProvider(saved);
    ctl.release("provider_list");
    await loading;
    expect(useStudio.getState().providers?.find((p) => p.id === "gemini")?.configured).toBe(true);
  });
});

describe("NÊN SỬA 3 — mock: archiving during a call", () => {
  it("fails the generation as interrupted and stores no outputs", async () => {
    useMock(30);
    const a = await projectWithMaster("A");
    const g = await call("generation_submit", {
      ...input(a.project.id, []),
      cameraId: null,
      prompt: {
        compilerVersion: COMPILER_VERSION,
        positivePrompt: "x",
        negativePrompt: "",
        referenceInstructions: "",
        preservationInstructions: "",
        metadata: {},
      },
    });
    await sleep(10);
    await call("project_set_archived", { projectId: a.project.id, archived: true });
    const done = await settled(a.project.id, g.id);
    expect(done.status).toBe("failed");
    expect(done.error).toMatchObject({ kind: "interrupted", retryable: false });
    expect(done.outputAssetIds).toEqual([]);
    expect((await call("asset_list", { projectId: a.project.id })).length).toBe(1);
  });
});

describe("NÊN SỬA 4 — dialog focus management", () => {
  it("focuses inside, traps Tab in the topmost dialog and restores focus on close", () => {
    const opener = document.createElement("button");
    opener.textContent = "opener";
    document.body.appendChild(opener);
    opener.focus();

    const { rerender, unmount } = render(
      <Dialog title="Outer" onClose={() => {}}>
        <button>first</button>
        <button>last</button>
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);

    // Tab from the last focusable wraps to the first; Shift+Tab from the first wraps back.
    const focusables = dialog.querySelectorAll<HTMLElement>("button");
    const last = focusables[focusables.length - 1]!;
    last.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(focusables[0]);
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);

    // A nested confirm owns Tab while open.
    rerender(
      <Dialog title="Outer" onClose={() => {}}>
        <button>first</button>
        <button>last</button>
        <ConfirmDialog
          title="Inner"
          message="?"
          confirmLabel="OK"
          onConfirm={() => {}}
          onCancel={() => {}}
        />
      </Dialog>,
    );
    const inner = screen.getAllByRole("dialog").at(-1)!;
    expect(inner.contains(document.activeElement)).toBe(true);
    const innerButtons = inner.querySelectorAll<HTMLElement>("button");
    innerButtons[innerButtons.length - 1]!.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(inner.contains(document.activeElement)).toBe(true);

    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});

describe("NÊN SỬA 5 — the real provider key input", () => {
  const SECRET = "sk-review-0123456789-never-kept";

  it("clears the password input on Save (success and failure) and keeps no copy", async () => {
    useStudio.getState().openProviderDialog("gemini");
    render(<ProviderSettingsDialog />);
    const box = (await screen.findByLabelText("Google Gemini API key")) as HTMLInputElement;

    fireEvent.change(box, { target: { value: SECRET } });
    fireEvent.submit(box.closest("form")!);
    expect(box.value).toBe("");
    await waitFor(
      () => useStudio.getState().providers?.find((p) => p.id === "gemini")?.configured,
      "gemini configured",
    );

    // A failing save also clears the input.
    setTransport(async (command, args) => {
      if (command === "provider_set_api_key") throw { code: "IO_ERROR", message: "keychain down" };
      return base(command, args);
    });
    const again = (await screen.findByLabelText("Google Gemini API key")) as HTMLInputElement;
    fireEvent.change(again, { target: { value: `${SECRET}-2` } });
    fireEvent.submit(again.closest("form")!);
    expect(again.value).toBe("");
    await waitFor(
      () => useStudio.getState().toasts.some((t) => /keychain down/.test(t.message)),
      "error toast",
    );

    const everything = JSON.stringify(useStudio.getState()) + JSON.stringify(db);
    expect(everything).not.toContain(SECRET);
    expect(localStorage.getItem("arch-studio-mock-db-v1") ?? "").not.toContain(SECRET);
    expect(document.body.innerHTML).not.toContain(SECRET);

    // Closing and reopening shows an empty box.
    useStudio.getState().closeProviderDialog();
    useStudio.getState().openProviderDialog("gemini");
    const reopened = (await screen.findByLabelText("Google Gemini API key")) as HTMLInputElement;
    expect(reopened.value).toBe("");
  });
});
