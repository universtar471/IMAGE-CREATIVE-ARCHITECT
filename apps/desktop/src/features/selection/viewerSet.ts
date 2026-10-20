import { isVideoAsset, type AssetDTO, type GenerationDTO } from "@arch/domain";

/**
 * The assets the large viewer steps through for `assetId` (ADR-044): the outputs of the run
 * that made it when that run made several, otherwise the project's ready assets of the same
 * media kind, in tray order. Always one project, always containing `assetId`.
 */
export function viewerSetFor(
  assetId: string,
  assets: readonly AssetDTO[],
  generations: readonly GenerationDTO[],
): string[] {
  const asset = assets.find((a) => a.id === assetId);
  if (!asset) return [assetId];
  const known = new Set(assets.map((a) => a.id));
  const run = generations.find((g) => g.outputAssetIds.includes(assetId));
  const outputs = run?.outputAssetIds.filter((id) => known.has(id)) ?? [];
  if (outputs.length > 1) return outputs;
  const video = isVideoAsset(asset);
  const same = assets
    .filter((a) => (a.status === "ready" || a.id === assetId) && isVideoAsset(a) === video)
    .map((a) => a.id);
  return same.includes(assetId) ? same : [assetId];
}
