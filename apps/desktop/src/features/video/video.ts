/**
 * Pure helpers of the Video module (ADR-043): which images can start a clip, which provider
 * and model are picked by default, and why "Create video" is disabled.
 */
import {
  isVideoAsset,
  modelDurations,
  type AssetDTO,
  type ModelCapabilities,
  type ProviderDescriptorDTO,
} from "@arch/domain";

export type VideoChoice = {
  providerId: string | null;
  modelId: string | null;
  durationSec: number | null;
  aspectRatio: string | null;
};

export type VideoForm = {
  providers: ProviderDescriptorDTO[];
  provider: ProviderDescriptorDTO | null;
  model: ModelCapabilities | null;
  durations: number[];
  durationSec: number | null;
  aspectRatio: string | null;
};

/** Ready images that can be a first frame, newest first. */
export function videoSources(assets: readonly AssetDTO[]): AssetDTO[] {
  return assets
    .filter((asset) => asset.status === "ready" && !isVideoAsset(asset))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

/** Clips of the project, newest first. */
export function projectVideos(assets: readonly AssetDTO[]): AssetDTO[] {
  return assets
    .filter((asset) => isVideoAsset(asset))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

/**
 * The default first frame: the selected image; for a selected clip, the image it came from;
 * else the master; else the newest image.
 */
export function defaultVideoSource(
  assets: readonly AssetDTO[],
  selectedId: string | null,
  masterId: string | null,
): AssetDTO | null {
  const sources = videoSources(assets);
  const selected = assets.find((asset) => asset.id === selectedId);
  const fromSelection = selected
    ? isVideoAsset(selected)
      ? selected.parentAssetId
      : selected.id
    : null;
  return (
    sources.find((asset) => asset.id === fromSelection) ??
    sources.find((asset) => asset.id === masterId) ??
    sources[0] ??
    null
  );
}

export function resolveVideoForm(
  all: readonly ProviderDescriptorDTO[],
  choice: VideoChoice,
): VideoForm {
  const providers = all.filter((provider) => provider.outputKind === "video");
  const provider =
    providers.find((p) => p.id === choice.providerId) ??
    providers.find((p) => p.configured) ??
    providers[0] ??
    null;
  const model = provider
    ? (provider.models.find((m) => m.id === choice.modelId) ?? provider.models[0] ?? null)
    : null;
  const durations = model ? modelDurations(model) : [];
  const durationSec =
    choice.durationSec !== null && durations.includes(choice.durationSec)
      ? choice.durationSec
      : (durations[0] ?? null);
  const aspectRatio =
    model && choice.aspectRatio && model.aspectRatios.includes(choice.aspectRatio)
      ? choice.aspectRatio
      : null;
  return { providers, provider, model, durations, durationSec, aspectRatio };
}

export type VideoDisabledReason =
  "reasonReadOnly" | "reasonNoSource" | "reasonNoProvider" | "reasonBusy" | null;

export function videoDisabledReason(
  form: VideoForm,
  source: AssetDTO | null,
  state: { readOnly: boolean; submitting: boolean },
): VideoDisabledReason {
  if (state.readOnly) return "reasonReadOnly";
  if (state.submitting) return "reasonBusy";
  if (!source) return "reasonNoSource";
  if (!form.provider?.configured || !form.model || form.durationSec === null)
    return "reasonNoProvider";
  return null;
}
