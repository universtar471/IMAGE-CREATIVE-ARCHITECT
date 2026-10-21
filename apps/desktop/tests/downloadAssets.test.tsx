import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DownloadAssets } from "../src/features/assets/DownloadAssets";
import { setTransport, type Transport } from "../src/lib/bridge";
import { asset } from "./helpers";
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: vi.fn(),
  convertFileSrc: (path: string) => path,
}));
afterEach(() => {
  cleanup();
  setTransport(null);
});
it("downloads selected ready originals in one native request, including video", async () => {
  const transport = vi.fn(async () => ["C:/Downloads/image.png", "C:/Downloads/clip.mp4"]);
  setTransport(transport as Transport);
  render(
    <DownloadAssets
      assets={[
        asset("PRJ_X", "AST_I"),
        asset("PRJ_X", "AST_V", { mediaKind: "video", mimeType: "video/mp4" }),
        asset("PRJ_X", "AST_M", { status: "missing_file" }),
      ]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Download 2 files" }));
  await waitFor(() =>
    expect(transport).toHaveBeenCalledWith("asset_download", {
      request: { projectId: "PRJ_X", assetIds: ["AST_I", "AST_V"] },
    }),
  );
  await screen.findByText("Saved 2 files");
});
it("reports an export failure and allows retry", async () => {
  setTransport(
    vi.fn(async () => {
      throw { code: "IO_ERROR", message: "Folder unavailable" };
    }) as Transport,
  );
  render(<DownloadAssets assets={[asset("PRJ_X", "AST_I")]} />);
  fireEvent.click(screen.getByRole("button", { name: "Download 1 files" }));
  await screen.findByText("Folder unavailable");
  expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(false);
});
