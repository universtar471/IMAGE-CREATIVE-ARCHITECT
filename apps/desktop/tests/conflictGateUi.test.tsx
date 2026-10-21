/** ADR-034 P0-B: the Generate panel shows the conflict check and gates its submit button. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ProjectDNASchema } from "@arch/domain";
import { createProject } from "../src/app/services";
import { EMPTY_GENERATE_DRAFT, useStudio } from "../src/app/store";
import { GeneratePanel } from "../src/features/generate/GeneratePanel";
import { call, setTransport } from "../src/lib/bridge";
import { createMockTransport } from "../src/lib/mockBackend";
import { t } from "../src/i18n";
import nhaphoDna from "./fixtures/nhapho-dna.json";
import { asset, confirmAllDna } from "./helpers";

type Db = NonNullable<Parameters<typeof createMockTransport>[0]>;
let db: Db;

beforeEach(() => {
  db = { projects: {}, dna: {}, assets: {}, versions: [] };
  setTransport(createMockTransport(db));
  useStudio.setState({
    route: { name: "hub" },
    workspace: null,
    run: null,
    jobs: [],
    providers: null,
    generateDraft: EMPTY_GENERATE_DRAFT,
  });
});
afterEach(() => {
  cleanup();
  setTransport(null);
});

async function openMidBlock() {
  const project = await createProject({
    name: "Gate UI",
    projectType: "townhouse",
    subtype: "default",
    starter: {},
  });
  const dna = ProjectDNASchema.parse(nhaphoDna);
  dna.context.siteTopology = { left: "attached", right: "attached", cornerLot: false };
  db.dna[project.id] = dna;
  const masterId = `AST_MASTER_${project.id}`;
  db.assets[masterId] = asset(project.id, masterId, { role: "master_architecture" });
  await call("asset_set_master", { projectId: project.id, assetId: masterId });
  await confirmAllDna(project.id, { approveMaster: true });
  await useStudio.getState().openProject(project.id);
  await useStudio.getState().loadProviders();
}

describe("Generate panel conflict gate", () => {
  it("creative findings do not disable Generate; fixing remains optional", async () => {
    await openMidBlock();
    render(<GeneratePanel />);
    const button = screen.getByTestId("generate-button") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(screen.queryByTestId("conflict-panel")).toBeNull();

    fireEvent.change(screen.getByTestId("extra-prompt"), {
      target: { value: "mở mặt hông bên trái" },
    });
    expect(button.disabled).toBe(false);
    const panel = screen.getByTestId("conflict-panel");
    expect(panel.textContent).toContain(t("conflicts.ADJACENT_BUILDING_CONFLICT"));
    expect(screen.getByTestId("conflict-fix").textContent).toContain(t("conflictUi.fix"));
    expect(screen.queryByTestId("conflict-approve")).toBeNull();
    expect(screen.queryByTestId("generate-disabled-reason")).toBeNull();
    expect(panel.textContent).toContain(t("conflictUi.advisoryHint"));
    fireEvent.click(screen.getByTestId("conflict-fix"));
    expect(document.activeElement).toBe(screen.getByTestId("extra-prompt"));
  });

  it("warnings stay advisory before and after optional acknowledgement", async () => {
    await openMidBlock();
    render(<GeneratePanel />);
    const button = screen.getByTestId("generate-button") as HTMLButtonElement;
    fireEvent.change(screen.getByTestId("extra-prompt"), { target: { value: "exactly 5 m wide" } });
    expect(button.disabled).toBe(false);
    fireEvent.click(screen.getByTestId("conflict-approve"));
    expect(screen.queryByTestId("conflict-approve")).toBeNull();
    expect(useStudio.getState().generateDraft.approvedExceptions).toEqual(["UNVERIFIED_GEOMETRY"]);
    expect(button.disabled).toBe(false);
    expect(screen.getByTestId("conflict-panel").textContent).toContain(t("conflictUi.accepted"));

    fireEvent.change(screen.getByTestId("extra-prompt"), { target: { value: "exactly 6 m wide" } });
    expect(button.disabled).toBe(false);
  });
});
