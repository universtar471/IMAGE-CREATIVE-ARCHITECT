import { useState } from "react";
import { Anchor, Clapperboard, KeyRound } from "lucide-react";
import {
  anchorViews,
  defaultGenerationParams,
  orderReferences,
  type GenerationParams,
} from "@arch/domain";
import { useStudio } from "../../app/store";
import { Dialog } from "../../components/common/Dialog";
import { FieldGroup, SelectField, TextField } from "../../components/panels/fields";
import { RoleBadge } from "../../components/common/StatusBadge";
import { call, toBridgeError } from "../../lib/bridge";
import { QualityField } from "../generate/QualityField";
import { planBatch, type BatchMode } from "./batch";

/**
 * "Generate anchors" (one item per anchor view, master as reference) and "Render cameras"
 * (chosen cameras, master + each camera's anchor + chosen extras). The plan shown here is
 * computed from saved data; on submit the DNA is flushed and the batch is built again from
 * a fresh persisted snapshot.
 */
export function BatchDialog({ mode, onClose }: { mode: BatchMode; onClose: () => void }) {
  const ws = useStudio((s) => s.workspace!);
  const providers = useStudio((s) => s.providers ?? []);
  const flushDna = useStudio((s) => s.flushDna);
  const createBatch = useStudio((s) => s.createBatch);
  const openProviderDialog = useStudio((s) => s.openProviderDialog);
  const notify = useStudio((s) => s.notify);

  const cameras = ws.draftDna.cameras;
  const master = ws.assets.find((a) => a.id === ws.project.activeMasterAssetId) ?? null;
  const firstProvider = providers.find((p) => p.configured) ?? providers[0] ?? null;
  const [providerId, setProviderId] = useState(firstProvider?.id ?? "");
  const provider = providers.find((p) => p.id === providerId) ?? firstProvider;
  const [modelId, setModelId] = useState<string | null>(null);
  const model = provider?.models.find((m) => m.id === modelId) ?? provider?.models[0] ?? null;
  const [paramsDraft, setParams] = useState<GenerationParams | null>(null);
  const params: GenerationParams = model
    ? {
        ...defaultGenerationParams(model, master),
        ...paramsDraft,
        seed: model.supportsSeed ? (paramsDraft?.seed ?? null) : null,
        quality:
          paramsDraft?.quality && model.qualityOptions.includes(paramsDraft.quality)
            ? paramsDraft.quality
            : null,
      }
    : { aspectRatio: null, imageSize: null, outputCount: 1, seed: null, quality: null };
  const [name, setName] = useState<string | undefined>(undefined);
  const [cameraIds, setCameraIds] = useState<string[]>(() =>
    mode === "anchor" ? [] : cameras.map((c) => c.id),
  );
  const [extraIds, setExtraIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const extras = orderReferences(
    ws.assets.filter((a) => a.status === "ready" && a.id !== master?.id),
  );
  const anchorAssetIds = new Set(ws.anchors.map((a) => a.assetId));
  const choices = {
    mode,
    providerId: provider?.id ?? "",
    modelId: model?.id ?? "",
    params,
    cameraIds,
    extraReferenceIds: extraIds.filter((id) => !anchorAssetIds.has(id)),
    name,
  };
  // Preview from what is saved (the DNA is flushed before the real build).
  const plan = planBatch(
    choices,
    { project: ws.project, dna: ws.persistedDna, assets: ws.assets },
    ws.anchors,
    providers,
  );
  const unsaved = ws.draftDna !== ws.persistedDna;

  const submit = async () => {
    setBusy(true);
    try {
      if (!(await flushDna())) {
        notify("error", "Fix the invalid Design DNA fields before rendering.");
        return;
      }
      const bundle = await call("project_get", { projectId: ws.project.id });
      const fresh = planBatch(choices, bundle, ws.anchors, providers);
      if (!fresh.request) {
        notify("error", fresh.issues[0] ?? "Nothing to render.");
        return;
      }
      if (await createBatch(fresh.request)) onClose();
    } catch (err) {
      notify("error", toBridgeError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (list: string[], id: string, on: boolean) =>
    on ? [...list, id] : list.filter((x) => x !== id);
  const views = anchorViews(ws.draftDna);

  return (
    <Dialog
      title={mode === "anchor" ? "Generate anchors" : "Render cameras"}
      onClose={onClose}
      footer={
        <>
          <span className="field-hint batch-summary" data-testid="batch-summary">
            {plan.items.length} item{plan.items.length === 1 ? "" : "s"}
            {plan.costHint ? ` · ${plan.costHint}` : ""}
          </span>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || !plan.request}
            onClick={() => void submit()}
            data-testid="batch-submit"
          >
            {mode === "anchor" ? <Anchor size={14} /> : <Clapperboard size={14} />}
            {busy
              ? "Queuing…"
              : `Queue ${plan.items.length} item${plan.items.length === 1 ? "" : "s"}`}
          </button>
        </>
      }
    >
      <div className="batch-dialog">
        <p className="field-hint" style={{ marginTop: 0 }}>
          {mode === "anchor"
            ? "One render per anchor view, with the approved master as the only reference. Approve the best result of each camera on the Contact Sheet."
            : "One render per chosen camera. Each item sends the master, then that camera's approved anchor, then the extra references you pick."}
        </p>
        <TextField
          label="Batch name"
          value={name}
          placeholder={mode === "anchor" ? "Anchors …" : "Production …"}
          onChange={setName}
        />
        <div className="field-row">
          <SelectField
            label="Provider"
            allowEmpty={false}
            value={provider?.id}
            options={providers.map((p) => ({
              value: p.id,
              label: p.configured ? p.label : `${p.label} — set API key`,
              disabled: !p.configured,
            }))}
            onChange={(id) => {
              setProviderId(id ?? "");
              setModelId(null);
              setParams(null);
            }}
          />
          {provider && provider.models.length > 1 && (
            <SelectField
              label="Model"
              allowEmpty={false}
              value={model?.id}
              options={provider.models.map((m) => ({ value: m.id, label: m.label }))}
              onChange={(id) => {
                setModelId(id ?? null);
                setParams(null);
              }}
            />
          )}
        </div>
        {providers.some((p) => !p.configured) && (
          <button
            className="btn btn-sm"
            onClick={() => openProviderDialog(providers.find((p) => !p.configured)?.id ?? null)}
          >
            <KeyRound size={13} /> Set API key
          </button>
        )}
        {model && (
          <div className="field-row">
            {model.aspectRatios.length > 0 && (
              <SelectField
                label="Aspect (fallback)"
                hint="Each camera's own ratio wins when the model offers it."
                allowEmpty={false}
                value={params.aspectRatio ?? undefined}
                options={model.aspectRatios.map((r) => ({ value: r, label: r }))}
                onChange={(v) => setParams({ ...params, aspectRatio: v ?? null })}
              />
            )}
            {model.imageSizes.length > 0 && (
              <SelectField
                label="Image size"
                allowEmpty={false}
                value={params.imageSize ?? undefined}
                options={model.imageSizes.map((r) => ({ value: r, label: r }))}
                onChange={(v) => setParams({ ...params, imageSize: v ?? null })}
              />
            )}
          </div>
        )}
        {model && (
          <QualityField
            model={model}
            value={params.quality}
            onChange={(quality) => setParams({ ...params, quality })}
          />
        )}
        {model && model.maxOutputs > 1 && (
          <FieldGroup label="Images per camera">
            <div className="segmented" role="group" aria-label="Images per camera">
              {Array.from({ length: model.maxOutputs }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={params.outputCount === n}
                  onClick={() => setParams({ ...params, outputCount: n })}
                >
                  {n}
                </button>
              ))}
            </div>
          </FieldGroup>
        )}

        {mode === "anchor" ? (
          <FieldGroup label={`Anchor views (${views.length})`}>
            <ul className="batch-cams">
              {views.map((c) => (
                <li key={c.id}>
                  <Anchor size={12} /> {c.name}
                  {ws.anchors.some((a) => a.cameraId === c.id) && (
                    <span className="badge badge-success">anchored — re-render</span>
                  )}
                </li>
              ))}
            </ul>
          </FieldGroup>
        ) : (
          <>
            <FieldGroup label="Cameras">
              <ul className="batch-cams" aria-label="Cameras to render">
                {cameras.map((c) => {
                  const anchored = ws.anchors.some((a) => a.cameraId === c.id);
                  return (
                    <li key={c.id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={cameraIds.includes(c.id)}
                          onChange={(e) => setCameraIds(toggle(cameraIds, c.id, e.target.checked))}
                        />
                        {c.name}
                      </label>
                      {anchored ? (
                        <span className="badge badge-success">master + anchor</span>
                      ) : c.isAnchorView ? (
                        <span className="badge badge-warning">anchor not approved</span>
                      ) : (
                        <span className="badge badge-neutral">master only</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </FieldGroup>
            <FieldGroup
              label="Extra references"
              hint={
                model
                  ? `Up to ${model.maxReferenceImages} images per item in total; master and anchor are never dropped.`
                  : undefined
              }
            >
              <ul className="batch-cams" aria-label="Extra references">
                {extras.length === 0 && <li className="field-hint">No other images.</li>}
                {extras.map((a) => (
                  <li key={a.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={extraIds.includes(a.id)}
                        disabled={anchorAssetIds.has(a.id)}
                        onChange={(e) => setExtraIds(toggle(extraIds, a.id, e.target.checked))}
                      />
                      <span className="batch-ref-name">{a.originalName ?? a.id}</span>
                    </label>
                    {anchorAssetIds.has(a.id) ? (
                      <span className="badge badge-success">anchor</span>
                    ) : (
                      <RoleBadge role={a.role} short />
                    )}
                  </li>
                ))}
              </ul>
            </FieldGroup>
          </>
        )}
        {unsaved && (
          <span className="field-hint">Unsaved camera edits are saved before queuing.</span>
        )}
        {plan.issues.length > 0 && (
          <div className="callout callout-warning" role="alert" data-testid="batch-issues">
            {plan.issues[0]}
          </div>
        )}
      </div>
    </Dialog>
  );
}
