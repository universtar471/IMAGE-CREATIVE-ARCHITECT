import { useCallback, useState } from "react";
import type { AssetRole, AssetSource } from "@arch/domain";
import { useStudio } from "../../app/store";
import { BridgeError, call, toBridgeError } from "../../lib/bridge";
import { fileNameOf, pickImages } from "../../lib/files";

export type DuplicatePrompt = {
  fileName: string;
  message: string;
  resolve: (keep: boolean) => void;
};

/**
 * Import one or more files sequentially. Each failure is reported per file and does not
 * stop the batch. Duplicate binaries ask the user before keeping a second logical copy.
 */
export function useAssetImport() {
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [duplicate, setDuplicate] = useState<DuplicatePrompt | null>(null);

  const importPaths = useCallback(
    async (
      paths: string[],
      role: AssetRole = "regular_image",
      source: AssetSource = "external",
    ) => {
      const ws = useStudio.getState().workspace;
      if (!ws || !paths.length) return;
      const { notify, selectAsset, adoptAssets } = useStudio.getState();
      let imported = 0;
      let lastId: string | null = null;
      setBusy({ done: 0, total: paths.length });

      for (const [i, path] of paths.entries()) {
        // Only the first file may claim the master role in a multi-import.
        const fileRole: AssetRole =
          role === "master_architecture" && i > 0 ? "architecture_reference" : role;
        try {
          const asset = await importOne(ws.project.id, path, fileRole, source, setDuplicate);
          if (asset) {
            imported++;
            lastId = asset.id;
          }
        } catch (err) {
          notify("error", `${fileNameOf(path)}: ${toBridgeError(err).message}`);
        }
        setBusy({ done: i + 1, total: paths.length });
      }

      setBusy(null);
      if (imported) {
        const assets = await call("asset_list", { projectId: ws.project.id });
        await adoptAssets(assets);
        if (lastId) selectAsset(lastId);
        notify("success", `Imported ${imported} image${imported > 1 ? "s" : ""}.`);
      }
    },
    [],
  );

  const pickAndImport = useCallback(
    async (role?: AssetRole) => {
      try {
        const paths = await pickImages();
        await importPaths(paths, role);
      } catch (err) {
        useStudio.getState().notify("error", toBridgeError(err).message);
      }
    },
    [importPaths],
  );

  return { busy, duplicate, importPaths, pickAndImport };
}

async function importOne(
  projectId: string,
  sourcePath: string,
  role: AssetRole,
  source: AssetSource,
  ask: (p: DuplicatePrompt | null) => void,
) {
  try {
    return await call("asset_import", { projectId, sourcePath, source, role });
  } catch (err) {
    if (!(err instanceof BridgeError) || err.code !== "DUPLICATE_ASSET") throw err;
    const keep = await new Promise<boolean>((resolve) =>
      ask({ fileName: fileNameOf(sourcePath), message: err.message, resolve }),
    );
    ask(null);
    if (!keep) return null;
    return call("asset_import", { projectId, sourcePath, source, role, allowDuplicate: true });
  }
}
