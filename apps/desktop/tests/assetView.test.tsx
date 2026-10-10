import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useStudio, type WorkspaceData } from "../src/app/store";
import { BottomTray } from "../src/features/assets/BottomTray";
import {
  ASSET_LIST_COLUMNS,
  ASSET_VIEW_STORAGE_KEY,
  readAssetViewMode,
  writeAssetViewMode,
} from "../src/features/assets/viewMode";

describe("asset tray view preference", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("switches the tray between thumbnail and list views", () => {
    const dna = { cameras: [] } as unknown as WorkspaceData["draftDna"];
    useStudio.setState({
      trayTab: "assets",
      trayCollapsed: false,
      workspace: {
        project: {
          id: "P",
          name: "Project",
          projectType: "villa",
          subtype: null,
          status: "draft",
          activeMasterAssetId: null,
          archivedAt: null,
          createdAt: "now",
          updatedAt: "now",
        } as WorkspaceData["project"],
        persistedDna: dna,
        draftDna: dna,
        assets: [],
        generations: [],
        anchors: [],
        batches: [],
        workflow: { steps: [] },
      },
    });
    render(<BottomTray />);
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    expect(screen.getByRole("table", { name: "Project assets" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "List" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("columnheader", { name: "Name" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Role" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Model" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Size" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Date" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Status" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Large images" }));
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("switches views and persists the selected view", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    expect(readAssetViewMode(storage)).toBe("small");
    writeAssetViewMode("large", storage);
    expect(readAssetViewMode(storage)).toBe("large");
    writeAssetViewMode("list", storage);
    expect(values.get(ASSET_VIEW_STORAGE_KEY)).toBe("list");
    expect(readAssetViewMode(storage)).toBe("list");
  });

  it("defines the six list columns requested for each asset", () => {
    expect(ASSET_LIST_COLUMNS).toEqual(["name", "role", "model", "size", "date", "status"]);
  });

  it("keeps batch selection and enhance comparison available in list rows", () => {
    const dna = { cameras: [] } as unknown as WorkspaceData["draftDna"];
    const source = {
      id: "SOURCE",
      projectId: "P",
      originalName: "source.png",
      role: "regular_image",
      status: "ready",
      createdAt: "now",
    };
    const output = { ...source, id: "OUTPUT", originalName: "output.png" };
    useStudio.setState({
      trayTab: "assets",
      trayCollapsed: false,
      selectedAssetId: "OUTPUT",
      workspace: {
        project: {
          id: "P",
          name: "Project",
          projectType: "villa",
          subtype: null,
          status: "draft",
          activeMasterAssetId: null,
          archivedAt: null,
          createdAt: "now",
          updatedAt: "now",
        } as WorkspaceData["project"],
        persistedDna: dna,
        draftDna: dna,
        assets: [source, output] as never,
        generations: [
          {
            id: "GEN",
            projectId: "P",
            purpose: "enhance",
            status: "completed",
            outputAssetIds: ["OUTPUT"],
            referenceAssetIds: ["SOURCE"],
            providerId: "local",
            modelId: "test",
          },
        ] as never,
        anchors: [],
        batches: [],
        workflow: { steps: [] },
      },
    });
    render(<BottomTray />);
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    const select = screen.getAllByRole("checkbox", { name: "Select" })[0]!;
    fireEvent.click(select);
    expect((select as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getAllByRole("checkbox", { name: "Select" })[1]!);
    expect(screen.getByRole("button", { name: /batch enhance/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /compare with original/i })).toBeTruthy();
  });

  it("falls back safely when browser storage throws", () => {
    const storage = {
      getItem: () => {
        throw new Error("storage disabled");
      },
      setItem: () => {
        throw new Error("storage disabled");
      },
    };
    expect(readAssetViewMode(storage)).toBe("small");
    expect(() => writeAssetViewMode("large", storage)).not.toThrow();
  });
});
