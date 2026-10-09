/**
 * Batch dialog logic (pure): turn the dialog choices + one persisted project snapshot into a
 * `BatchCreateRequest` with the anchor / production builders (ADR-018), plus the item count,
 * cost hint and validation messages shown before submitting.
 */
import {
  anchorViews,
  BatchReferenceLimitError,
  buildAnchorBatchItems,
  buildProductionBatchItems,
  MAX_BATCH_ITEMS,
  validateGenerationRequest,
  type BatchCreateRequest,
  type BatchItem,
  type CameraAnchorDTO,
  type GenerationParams,
  type ProviderDescriptorDTO,
} from "@arch/domain";
import type { ProjectBundle } from "../../app/services";
import { knowledge } from "../../lib/knowledge";

export type BatchMode = "anchor" | "production";

export type BatchChoices = {
  mode: BatchMode;
  providerId: string;
  modelId: string;
  /** imageSize / outputCount / seed apply to every item; aspect follows each camera when set. */
  params: GenerationParams;
  /** Production only. */
  cameraIds: readonly string[];
  /** Production only: references beyond master + anchor. */
  extraReferenceIds: readonly string[];
  name?: string;
};

export type BatchPlan = {
  items: BatchItem[];
  request: BatchCreateRequest | null;
  /** Blocking problems (nothing is submitted while any exist). */
  issues: string[];
  /** Provider calls this batch will make (one image per call for remote providers). */
  providerCalls: number;
  costHint: string;
};

export function defaultBatchName(mode: BatchMode, now = new Date()): string {
  const stamp = now.toISOString().slice(0, 16).replace("T", " ");
  return `${mode === "anchor" ? "Anchors" : "Production"} ${stamp}`;
}

export function costHint(
  provider: Pick<ProviderDescriptorDTO, "kind" | "label">,
  items: number,
  outputsPerItem: number,
): { providerCalls: number; text: string } {
  const images = items * outputsPerItem;
  if (provider.kind === "local") {
    return {
      providerCalls: items,
      text: `${images} image${images === 1 ? "" : "s"} · offline provider, no cost.`,
    };
  }
  // Remote providers return one image per call (outputs are sequential calls).
  return {
    providerCalls: images,
    text: `${images} remote call${images === 1 ? "" : "s"} to ${provider.label} (billed per image), run one at a time.`,
  };
}

/** Build the batch from the persisted snapshot `bundle` (compile from saved DNA, ADR-008). */
export function planBatch(
  choices: BatchChoices,
  bundle: ProjectBundle,
  anchors: readonly CameraAnchorDTO[],
  providers: readonly ProviderDescriptorDTO[],
): BatchPlan {
  const issues: string[] = [];
  const provider = providers.find((p) => p.id === choices.providerId);
  const model = provider?.models.find((m) => m.id === choices.modelId);
  const masterId = bundle.project.activeMasterAssetId;
  const empty = (msg: string): BatchPlan => ({
    items: [],
    request: null,
    issues: [msg],
    providerCalls: 0,
    costHint: "",
  });
  if (!provider || !model) return empty("Choose a provider and model.");
  if (!provider.configured) return empty(`${provider.label} needs an API key first.`);
  if (!masterId) return empty("Set and approve a master image first.");

  const { pack } = knowledge.resolve(bundle.project.projectType, bundle.project.subtype);
  const input = {
    project: {
      id: bundle.project.id,
      name: bundle.project.name,
      projectType: bundle.project.projectType,
      subtype: bundle.project.subtype,
    },
    dna: bundle.dna,
    pack,
    assets: bundle.assets.filter((a) => a.status === "ready"),
    masterAssetId: masterId,
    model,
    params: choices.params,
    extraReferenceIds: choices.extraReferenceIds,
  };

  let items: BatchItem[];
  if (choices.mode === "anchor") {
    if (!anchorViews(bundle.dna).length) issues.push("Mark at least one camera as an anchor view.");
    items = buildAnchorBatchItems(input);
  } else {
    if (!choices.cameraIds.length) issues.push("Choose at least one camera.");
    try {
      items = buildProductionBatchItems(input, choices.cameraIds, anchors);
    } catch (err) {
      // Master + anchor do not fit this model: never queue a batch without them.
      if (!(err instanceof BatchReferenceLimitError)) throw err;
      issues.push(err.message);
      items = [];
    }
  }
  if (items.length > MAX_BATCH_ITEMS)
    issues.push(`A batch holds at most ${MAX_BATCH_ITEMS} items (${items.length} chosen).`);
  for (const item of items) {
    const first = validateGenerationRequest(item, model, bundle.assets)[0];
    if (first) {
      issues.push(`${item.label}: ${first.message}`);
      break;
    }
  }
  const cost = costHint(provider, items.length, choices.params.outputCount);
  const request: BatchCreateRequest | null =
    issues.length || !items.length
      ? null
      : {
          projectId: bundle.project.id,
          name: choices.name?.trim() || defaultBatchName(choices.mode),
          providerId: provider.id,
          modelId: model.id,
          purpose: choices.mode,
          priority: 0,
          items,
        };
  return { items, request, issues, providerCalls: cost.providerCalls, costHint: cost.text };
}
