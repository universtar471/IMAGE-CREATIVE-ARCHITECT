import { Archive, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AssetDTO, GenerationDTO, ProjectDNA } from "@arch/domain";
import { selectReadOnly, useStudio } from "../../app/store";
import { call } from "../../lib/bridge";
import {
  buildRegionEditPrompt,
  buildRegionGenerationRequest,
  maskCoveragePct,
  newSceneObjectId,
  rasterizeMask,
  type RegionDTO,
  type RegionEditParams,
  type SceneDNA,
  type SceneObject,
  type SceneObjectCategory,
} from "../../lib/regions";
import { isMasterApproved } from "../camera/labels";
import { SectionPanel } from "../../components/panels/SectionPanel";
import { CompareCanvas } from "../../components/canvas/CompareCanvas";
import { useT } from "../../i18n";
import { useSpendConfirm } from "../../components/common/SpendConfirm";
import { spendRequestForGeneration } from "../../lib/spend";
import { BlockedExplainer } from "../workflow/BlockedExplainer";

const CATEGORIES: SceneObjectCategory[] = [
  "wall",
  "roof",
  "window",
  "door",
  "floor",
  "landscape",
  "furniture",
  "sky",
  "other",
];
const RELATIONS = ["on", "next_to", "inside", "above", "below"] as const;

const sceneOf = (dna: ProjectDNA): SceneDNA =>
  (dna as ProjectDNA & { scene?: SceneDNA }).scene ?? { schemaVersion: 1, objects: [] };

export function RegionPanel() {
  const ws = useStudio((state) => state.workspace!);
  const providers = useStudio((state) => state.providers ?? []);
  const loadProviders = useStudio((state) => state.loadProviders);
  const editDna = useStudio((state) => state.editDna);
  const readOnly = useStudio(selectReadOnly);
  const selectedId = useStudio((state) => state.selectedAssetId) ?? ws.project.activeMasterAssetId;
  const selected =
    ws.assets.find((asset) => asset.id === selectedId && asset.status === "ready") ?? null;
  const approved = isMasterApproved(ws.project.status);
  const t = useT();
  const spend = useSpendConfirm();
  const [regions, setRegions] = useState<RegionDTO[]>([]);
  const [selectedRegions, setSelectedRegions] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<RegionEditParams["mode"]>("edit");
  const [instruction, setInstruction] = useState("");
  const [material, setMaterial] = useState("");
  const [providerId, setProviderId] = useState("");
  const [modelId, setModelId] = useState("");
  const [busy, setBusy] = useState(false);
  const loadToken = useRef(0);
  const dna = ws.draftDna;
  const scene = sceneOf(dna);

  const load = useCallback(async () => {
    if (!selectedId) return;
    const token = ++loadToken.current;
    const result = (await call("region_list", {
      projectId: ws.project.id,
      assetId: selectedId,
    }).catch(() => [])) as RegionDTO[];
    const current = useStudio.getState();
    if (
      token === loadToken.current &&
      current.workspace?.project.id === ws.project.id &&
      (current.selectedAssetId ?? current.workspace?.project.activeMasterAssetId) === selectedId
    )
      setRegions(result);
  }, [selectedId, ws.project.id]);
  useEffect(() => {
    const tokenRef = loadToken;
    void load();
    return () => {
      tokenRef.current++;
    };
  }, [load]);
  useEffect(() => {
    if (!providers.length) void loadProviders();
  }, [loadProviders, providers.length]);

  const imageProviders = providers.filter((provider) =>
    provider.models.some((model) => model.imageToImage && model.maxReferenceImages >= 1),
  );
  const provider =
    imageProviders.find((item) => item.id === providerId) ?? imageProviders[0] ?? null;
  const models =
    provider?.models.filter((model) => model.imageToImage && model.maxReferenceImages >= 1) ?? [];
  const model = models.find((item) => item.id === modelId) ?? models[0] ?? null;
  const supportsMask = Boolean(
    (model as (typeof model & { supportsMask?: boolean }) | null)?.supportsMask ??
    (provider?.id === "openai" || (provider?.id === "hhtech" && !model?.id.startsWith("gemini-"))),
  );
  const params: RegionEditParams = useMemo(
    () => ({
      regionIds: [...selectedRegions],
      instruction,
      mode,
      ...(mode === "material_replace" ? { material } : {}),
    }),
    [instruction, material, mode, selectedRegions],
  );
  const coveragePct = useMemo(() => {
    if (!selected) return 0;
    const shapes = regions
      .filter((region) => selectedRegions.has(region.id))
      .map((region) => region.shape);
    return maskCoveragePct(rasterizeMask(shapes, selected.widthPx ?? 1, selected.heightPx ?? 1));
  }, [regions, selected, selectedRegions]);
  const prompt = useMemo(
    () =>
      buildRegionEditPrompt({
        dna: { ...dna, scene },
        regions,
        params,
        nativeMask: supportsMask,
        maskCoveragePct: coveragePct,
      }),
    [coveragePct, dna, regions, scene, supportsMask, params],
  );

  const updateScene = (next: SceneDNA) => editDna("scene", next);
  const addObject = () =>
    updateScene({
      schemaVersion: 1,
      objects: [
        ...scene.objects,
        {
          id: newSceneObjectId(),
          name: "New object",
          category: "other",
          relations: [],
        },
      ],
    });
  const removeObject = (id: string) =>
    updateScene({ schemaVersion: 1, objects: scene.objects.filter((object) => object.id !== id) });
  const updateObject = (id: string, patch: Partial<SceneObject>) =>
    updateScene({
      schemaVersion: 1,
      objects: scene.objects.map((object) => {
        if (object.id !== id) return object;
        const next = { ...object, ...patch };
        if (typeof next.material === "string" && next.material.trim() === "") {
          const withoutMaterial: SceneObject = { ...next };
          delete withoutMaterial.material;
          return withoutMaterial;
        }
        return next;
      }),
    });
  const addRelation = (id: string) => {
    const target = scene.objects.find((object) => object.id !== id);
    const object = scene.objects.find((item) => item.id === id);
    if (!target || !object) return;
    updateObject(id, {
      relations: [...object.relations, { type: "next_to", targetId: target.id }],
    });
  };
  const updateRelation = (
    id: string,
    index: number,
    patch: Partial<SceneObject["relations"][number]>,
  ) => {
    const object = scene.objects.find((item) => item.id === id);
    if (!object) return;
    updateObject(id, {
      relations: object.relations.map((relation, relationIndex) =>
        relationIndex === index ? { ...relation, ...patch } : relation,
      ),
    });
  };
  const removeRelation = (id: string, index: number) => {
    const object = scene.objects.find((item) => item.id === id);
    if (!object) return;
    updateObject(id, {
      relations: object.relations.filter((_, relationIndex) => relationIndex !== index),
    });
  };
  const saveRegion = async (region: RegionDTO, patch: Partial<RegionDTO>) => {
    const saved = await call("region_save", {
      projectId: ws.project.id,
      assetId: region.assetId,
      region: {
        id: region.id,
        label: patch.label ?? region.label,
        kind: patch.kind ?? region.kind,
        objectId: patch.objectId === undefined ? region.objectId : patch.objectId,
        shape: patch.shape ?? region.shape,
      },
    });
    setRegions((items) =>
      items.map((item) => (item.id === region.id ? (saved as RegionDTO) : item)),
    );
  };
  const deleteRegion = async (region: RegionDTO) => {
    await call("region_delete", { projectId: ws.project.id, regionId: region.id }).catch(
      () => undefined,
    );
    setRegions((items) => items.filter((item) => item.id !== region.id));
    setSelectedRegions((ids) => {
      const next = new Set(ids);
      next.delete(region.id);
      return next;
    });
  };

  const submit = async () => {
    if (
      !selected ||
      !provider ||
      !model ||
      !approved ||
      readOnly ||
      !selectedRegions.size ||
      (mode === "edit" ? !instruction.trim() : !material.trim())
    )
      return;
    setBusy(true);
    try {
      const request = buildRegionGenerationRequest({
        projectId: ws.project.id,
        providerId: provider.id,
        modelId: model.id,
        sourceAssetId: selected.id,
        params,
        dna: { ...dna, scene },
        regions,
        nativeMask: supportsMask,
        maskCoveragePct: coveragePct,
      });
      if (!(await spend.request(spendRequestForGeneration(request, providers, t)))) return;
      await call("generation_submit", request);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="region-panel" data-testid="region-panel">
      {spend.dialog}
      {!approved && (
        <div className="callout callout-warning">
          <Archive size={14} /> {t("regions.needsMaster")}
          <BlockedExplainer stepId="generate.master" />
        </div>
      )}
      <SectionPanel title={t("regions.howToUse")} defaultOpen={false}>
        <p className="field-hint">{t("regions.howToUse")}</p>
      </SectionPanel>
      {!selected && <p className="field-hint">{t("regions.noSource")}</p>}
      <SectionPanel title={t("regions.regions")}>
        {!regions.length && <p className="field-hint">{t("regions.noSource")}</p>}
        {regions.map((region) => (
          <div className="region-list-row" key={region.id}>
            <input
              type="checkbox"
              checked={selectedRegions.has(region.id)}
              onChange={(event) =>
                setSelectedRegions((ids) => {
                  const next = new Set(ids);
                  if (event.target.checked) next.add(region.id);
                  else next.delete(region.id);
                  return next;
                })
              }
              aria-label={region.label}
            />
            <input
              value={region.label}
              aria-label={t("regions.label")}
              disabled={readOnly || !approved}
              onChange={(event) => {
                const next = { ...region, label: event.target.value };
                setRegions((items) => items.map((item) => (item.id === region.id ? next : item)));
              }}
              onBlur={() => void saveRegion(region, { label: region.label })}
            />
            <select
              value={region.kind}
              aria-label={t("regions.kind")}
              disabled={readOnly || !approved}
              onChange={(event) =>
                void saveRegion(region, { kind: event.target.value as RegionDTO["kind"] })
              }
            >
              <option value="object">{t("regions.object")}</option>
              <option value="zone">{t("regions.zone")}</option>
              <option value="material">{t("regions.material")}</option>
            </select>
            <select
              value={region.objectId ?? ""}
              aria-label={t("regions.linkedObject")}
              disabled={readOnly || !approved}
              onChange={(event) =>
                void saveRegion(region, { objectId: event.target.value || null })
              }
            >
              <option value="">{t("regions.none")}</option>
              {scene.objects.map((object) => (
                <option value={object.id} key={object.id}>
                  {object.name}
                </option>
              ))}
            </select>
            <button
              className="btn btn-ghost btn-icon"
              title={t("regions.deleteRegion")}
              aria-label={t("regions.deleteRegion")}
              disabled={readOnly || !approved}
              onClick={() => void deleteRegion(region)}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </SectionPanel>
      <SectionPanel title={t("regions.objects")} defaultOpen={false}>
        <button className="btn btn-ghost btn-sm" disabled={readOnly} onClick={addObject}>
          <Plus size={13} /> {t("regions.addObject")}
        </button>
        {scene.objects.map((object) => (
          <div className="scene-object-row" key={object.id}>
            <input
              value={object.name}
              aria-label={t("regions.objectName")}
              disabled={readOnly}
              onChange={(event) => updateObject(object.id, { name: event.target.value })}
            />
            <select
              value={object.category}
              aria-label={t("regions.category")}
              disabled={readOnly}
              onChange={(event) =>
                updateObject(object.id, { category: event.target.value as SceneObjectCategory })
              }
            >
              {CATEGORIES.map((category) => (
                <option value={category} key={category}>
                  {category}
                </option>
              ))}
            </select>
            <input
              value={object.material ?? ""}
              aria-label={t("regions.objectMaterial")}
              disabled={readOnly}
              onChange={(event) => updateObject(object.id, { material: event.target.value })}
            />
            <label title={t("regions.pin")}>
              <input
                type="checkbox"
                checked={dna.locks.objectIds.includes(object.id)}
                disabled={readOnly}
                onChange={(event) =>
                  editDna(
                    "locks.objectIds",
                    event.target.checked
                      ? [...dna.locks.objectIds, object.id]
                      : dna.locks.objectIds.filter((id) => id !== object.id),
                  )
                }
              />
            </label>
            <button
              className="btn btn-ghost btn-icon"
              title={t("common.delete")}
              aria-label={t("common.delete")}
              disabled={readOnly}
              onClick={() => removeObject(object.id)}
            >
              <Trash2 size={13} />
            </button>
            <div className="scene-relations">
              {object.relations.map((relation, index) => (
                <div className="scene-relation" key={`${object.id}-${index}`}>
                  <select
                    aria-label={t("regions.relation")}
                    value={relation.type}
                    disabled={readOnly}
                    onChange={(event) =>
                      updateRelation(object.id, index, {
                        type: event.target.value as SceneObject["relations"][number]["type"],
                      })
                    }
                  >
                    {RELATIONS.map((type) => (
                      <option value={type} key={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label={t("regions.relationTarget")}
                    value={relation.targetId}
                    disabled={readOnly}
                    onChange={(event) =>
                      updateRelation(object.id, index, { targetId: event.target.value })
                    }
                  >
                    {scene.objects
                      .filter((target) => target.id !== object.id)
                      .map((target) => (
                        <option value={target.id} key={target.id}>
                          {target.name}
                        </option>
                      ))}
                  </select>
                  <button
                    className="btn btn-ghost btn-icon"
                    title={t("common.delete")}
                    aria-label={t("common.delete")}
                    disabled={readOnly}
                    onClick={() => removeRelation(object.id, index)}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              <button
                className="btn btn-ghost btn-sm"
                disabled={readOnly || scene.objects.length < 2}
                onClick={() => addRelation(object.id)}
              >
                <Plus size={12} /> {t("regions.relation")}
              </button>
            </div>
          </div>
        ))}
      </SectionPanel>
      <SectionPanel title={t("regions.edit")}>
        <div className="segmented" role="group" aria-label={t("regions.mode")}>
          <button className={mode === "edit" ? "is-active" : ""} onClick={() => setMode("edit")}>
            {t("regions.freeEdit")}
          </button>
          <button
            className={mode === "material_replace" ? "is-active" : ""}
            onClick={() => setMode("material_replace")}
          >
            {t("regions.materialReplace")}
          </button>
        </div>
        {mode === "edit" ? (
          <label className="field">
            <span>{t("regions.instruction")}</span>
            <textarea
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder={t("regions.instructionPlaceholder")}
            />
          </label>
        ) : (
          <label className="field">
            <span>{t("regions.materialField")}</span>
            <input
              value={material}
              onChange={(event) => setMaterial(event.target.value)}
              placeholder={t("regions.materialPlaceholder")}
            />
          </label>
        )}
        <label className="field">
          <span>{t("regions.provider")}</span>
          <select
            value={provider?.id ?? ""}
            onChange={(event) => {
              setProviderId(event.target.value);
              setModelId("");
            }}
          >
            <option value="">{t("regions.provider")}</option>
            {imageProviders.map((item) => (
              <option value={item.id} key={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t("regions.model")}</span>
          <select value={model?.id ?? ""} onChange={(event) => setModelId(event.target.value)}>
            <option value="">{t("regions.model")}</option>
            {models.map((item) => (
              <option value={item.id} key={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        {model && (
          <span className="badge badge-info">
            {supportsMask ? t("regions.nativeMask") : t("regions.secondaryMask")}
          </span>
        )}
        <p className="field-hint">{t("regions.cost")}</p>
        <details>
          <summary>{t("regions.promptPreview")}</summary>
          <pre className="prompt-preview">
            {prompt.positivePrompt}
            {"\n\n"}
            {prompt.preservationInstructions}
          </pre>
        </details>
        <button
          className="btn btn-primary"
          disabled={busy || readOnly || !approved || !selectedRegions.size || !provider || !model}
          onClick={() => void submit()}
        >
          {t("regions.run")}
        </button>
      </SectionPanel>
      <RegionResult
        projectId={ws.project.id}
        selected={selected}
        generations={ws.generations}
        assets={ws.assets}
        title={t("regions.result")}
      />
    </div>
  );
}

function RegionResult({
  projectId,
  selected,
  generations,
  assets,
  title,
}: {
  projectId: string;
  selected: AssetDTO | null;
  generations: GenerationDTO[];
  assets: AssetDTO[];
  title: string;
}) {
  const generation = generations.find(
    (item) =>
      item.projectId === projectId &&
      (item.purpose as string) === "region_edit" &&
      item.status === "completed" &&
      item.referenceAssetIds.includes(selected?.id ?? ""),
  );
  const result = generation?.outputAssetIds
    .map((id: string) => assets.find((asset) => asset.id === id))
    .find(Boolean);
  if (!selected || !result) return null;
  return (
    <SectionPanel title={title}>
      <CompareCanvas source={selected} result={result} />
    </SectionPanel>
  );
}
