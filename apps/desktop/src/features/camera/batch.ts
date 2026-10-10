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
  costHintText,
  MAX_BATCH_ITEMS,
  validateGenerationRequest,
  type BatchCreateRequest,
  type BatchItem,
  type CameraAnchorDTO,
  type GenerationDTO,
  type GenerationParams,
  type ProviderDescriptorDTO,
} from "@arch/domain";
import type { ProjectBundle } from "../../app/services";
import { knowledge } from "../../lib/knowledge";
import { t } from "../../i18n";
import { translateDomainMessage } from "../../i18n/domain";

export type BatchMode = "anchor" | "production";

export type BatchChoices = {
  mode: BatchMode;
  providerId: string;
  modelId: string;
  /** imageSize / outputCount / seed apply to every item; aspect follows each camera when set. */
  params: GenerationParams;
  /** Production only. */
  cameraIds: readonly string[];
  /** Anchor dialog sets this so an empty list means the user deliberately unticked all. */
  cameraSelectionExplicit?: boolean;
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

/** Re-run one camera with the immutable provider/model/params/prompt snapshot of its source. */
export function anchorRerunRequest(
  source: Pick<
    GenerationDTO,
    "projectId" | "providerId" | "modelId" | "prompt" | "referenceAssetIds" | "params"
  >,
  cameraId: string,
  cameraName: string,
  batchName: string,
): BatchCreateRequest {
  return {
    projectId: source.projectId,
    providerId: source.providerId,
    modelId: source.modelId,
    purpose: "anchor",
    name: batchName,
    priority: 0,
    items: [
      {
        cameraId,
        label: cameraName,
        prompt: source.prompt,
        referenceAssetIds: source.referenceAssetIds,
        params: source.params,
      },
    ],
  };
}

export function defaultBatchName(mode: BatchMode, now = new Date()): string {
  const stamp = now.toISOString().slice(0, 16).replace("T", " ");
  return `${mode === "anchor" ? t("batch.defaultAnchors") : t("batch.defaultProduction")} ${stamp}`;
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
      text: t("batch.costOffline", { count: images }),
    };
  }
  // Remote providers return one image per call (outputs are sequential calls).
  return {
    providerCalls: images,
    text: t("batch.costRemote", { count: images, provider: provider.label }),
  };
}

/** The domain's reference-limit error in the UI language (built from its fields). */
function referenceLimitMessage(err: BatchReferenceLimitError, modelLabel: string): string {
  const params = {
    camera: err.cameraName,
    model: modelLabel,
    required: err.required,
    max: err.max,
  };
  const withAnchor = err.required > 1;
  if (err.max === 0)
    return withAnchor
      ? t("validation.batchNeedsMasterAndAnchor", params)
      : t("validation.batchNeedsMaster", params);
  return withAnchor
    ? t("validation.batchTooFewSlotsAnchor", params)
    : t("validation.batchTooFewSlots", params);
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
  if (!provider || !model) return empty(t("batch.chooseProvider"));
  if (!provider.configured) return empty(t("batch.needsKey", { provider: provider.label }));
  if (!masterId) return empty(t("batch.needsMaster"));

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
    if (!anchorViews(bundle.dna).length) issues.push(t("batch.needsAnchorView"));
    if (choices.cameraSelectionExplicit && !choices.cameraIds.length)
      issues.push(t("batch.needsCamera"));
    const chosen = new Set(choices.cameraIds);
    items = buildAnchorBatchItems(input).filter(
      (item) => !choices.cameraSelectionExplicit || (item.cameraId && chosen.has(item.cameraId)),
    );
  } else {
    if (!choices.cameraIds.length) issues.push(t("batch.needsCamera"));
    try {
      items = buildProductionBatchItems(input, choices.cameraIds, anchors);
    } catch (err) {
      // Master + anchor do not fit this model: never queue a batch without them.
      if (!(err instanceof BatchReferenceLimitError)) throw err;
      issues.push(referenceLimitMessage(err, model.label));
      items = [];
    }
  }
  if (items.length > MAX_BATCH_ITEMS)
    issues.push(t("batch.tooMany", { max: MAX_BATCH_ITEMS, count: items.length }));
  for (const item of items) {
    const first = validateGenerationRequest(item, model, bundle.assets)[0];
    if (first) {
      issues.push(`${item.label}: ${translateDomainMessage(first.message)}`);
      break;
    }
  }
  const cost = costHint(provider, items.length, choices.params.outputCount);
  // Priced models (HHTECH) add the estimated total: images × tier price.
  const total = costHintText(
    model,
    choices.params.imageSize,
    items.length * choices.params.outputCount,
  );
  if (total && items.length) cost.text = `${cost.text} ${translateDomainMessage(total)}.`;
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
