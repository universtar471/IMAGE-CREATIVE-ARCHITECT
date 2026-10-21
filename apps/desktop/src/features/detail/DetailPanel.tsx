import { AlertTriangle, Check, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { ImageModelPicker, useImageModelChoice } from "../../components/panels/ImageModelPicker";
import {
  ArchitecturalDetailRegistry,
  DETAIL_FACADES,
  isVerifiedArchitecturalDetail,
  planDetailShots,
  validateShot,
  type DetailFacade,
  type DetailRecord,
  type ProjectDNA,
} from "@arch/domain";
import { selectReadOnly, useStudio } from "../../app/store";
import { SectionPanel } from "../../components/panels/SectionPanel";
import { NumberField, SelectField, TagListField, TextField } from "../../components/panels/fields";
import { BatchDialog } from "../camera/BatchDialog";
import { useT } from "../../i18n";

const facadeOptions: readonly { value: DetailFacade; label: string }[] = DETAIL_FACADES.map(
  (facade) => ({ value: facade, label: facade.toUpperCase() }),
);

function detailLabel(detail: DetailRecord): string {
  return detail.name?.trim() || detail.id;
}

function isVerified(detail: DetailRecord): boolean {
  return isVerifiedArchitecturalDetail(detail);
}

export function DetailPanel() {
  const imageChoice = useImageModelChoice();
  const t = useT();
  const readOnly = useStudio(selectReadOnly);
  const dna = useStudio((state) => state.workspace!.draftDna) as ProjectDNA;
  const projectType = useStudio((state) => state.workspace!.project.projectType);
  const shotIntent = useStudio((state) => state.workspace!.shotIntent);
  const editDna = useStudio((state) => state.editDna);
  const setShotIntent = useStudio((state) => state.setShotIntent);
  const notify = useStudio((state) => state.notify);
  const details = dna.architecturalDetails ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(details[0]?.id ?? null);
  const [shotCount, setShotCount] = useState(3);
  const [mode, setMode] = useState<"auto" | "manual">("auto");
  const [manualIds, setManualIds] = useState<string[]>([]);
  const [batchOpen, setBatchOpen] = useState(false);

  const selected = details.find((detail) => detail.id === selectedId) ?? null;
  const confirmed = details.filter(isVerified);
  const plan = useMemo(
    () =>
      planDetailShots(dna, {
        count: shotCount,
        mode,
        detailIds: mode === "manual" ? manualIds : undefined,
      }),
    [dna, manualIds, mode, shotCount],
  );
  const reselect = useMemo(() => {
    if (!shotIntent?.targetDetailId) return false;
    return validateShot({ dna, shotIntent }).issues.some(
      (issue) => issue.code === "OCCLUDED_TARGET" && issue.params.action === "reselect",
    );
  }, [dna, shotIntent]);

  const replaceDetails = (nextDna: ProjectDNA) =>
    editDna("architecturalDetails", nextDna.architecturalDetails);

  const updateSelected = (patch: Partial<DetailRecord>) => {
    if (!selected || readOnly) return;
    replaceDetails(ArchitecturalDetailRegistry.update(dna, selected.id, patch));
  };

  const addDetail = () => {
    if (readOnly) return;
    const id = `DTL_${Date.now().toString(36)}`;
    const next = ArchitecturalDetailRegistry.add(dna, {
      version: 1,
      id,
      spaceId: dna.spaceCatalog?.activeSpaceId ?? "SPC_detail",
      materialIds: [],
      locked: false,
    });
    replaceDetails(next);
    setSelectedId(id);
  };

  const removeSelected = () => {
    if (!selected || readOnly) return;
    const next = ArchitecturalDetailRegistry.remove(dna, selected.id);
    replaceDetails(next);
    setSelectedId(next.architecturalDetails?.[0]?.id ?? null);
  };

  const toggleManual = (id: string, checked: boolean) => {
    setManualIds((current) =>
      checked
        ? current.includes(id)
          ? current
          : [...current, id]
        : current.filter((x) => x !== id),
    );
  };

  const generate = () => {
    if (!plan.shots.length) {
      notify("warning", t("detail.needDetail"));
      return;
    }
    const first = plan.shots[0]!;
    setShotIntent({
      ...(shotIntent ?? { projectType, cameraId: null }),
      projectType,
      cameraId: first.cameraSuggestion,
      targetDetailId: first.detailId,
      detailShotCount: plan.shots.length,
    });
    setBatchOpen(true);
  };

  return (
    <div className="detail-panel" data-testid="detail-panel">
      <ImageModelPicker {...imageChoice} disabled={readOnly} />
      <SectionPanel title={t("detail.editor")}>
        <p className="field-hint">{t("detail.intro")}</p>
        <button className="btn" disabled={readOnly} onClick={addDetail}>
          <Plus size={14} /> {t("detail.add")}
        </button>
        {details.length === 0 ? (
          <p className="field-hint">{t("detail.noDetails")}</p>
        ) : (
          <div className="list">
            {details.map((detail) => (
              <button
                className={`list-row ${detail.id === selectedId ? "is-selected" : ""}`}
                key={detail.id}
                onClick={() => setSelectedId(detail.id)}
              >
                <span>{detailLabel(detail)}</span>
                <span className="spacer" />
                {isVerified(detail) ? <Check size={14} /> : <AlertTriangle size={14} />}
              </button>
            ))}
          </div>
        )}
        {selected && (
          <>
            <TextField
              label={t("detail.name")}
              value={selected.name}
              disabled={readOnly}
              onChange={(name) => updateSelected({ name })}
            />
            <div className="field-row">
              <SelectField
                label={t("detail.facade")}
                value={selected.facade ?? selected.location?.facade}
                options={facadeOptions}
                disabled={readOnly}
                onChange={(facade) => updateSelected({ facade })}
              />
              <TextField
                label={t("detail.floor")}
                value={selected.floorId ?? selected.location?.floorId}
                disabled={readOnly}
                onChange={(floorId) => updateSelected({ floorId })}
              />
            </div>
            <TextField
              label={t("detail.element")}
              value={selected.location?.elementId}
              disabled={readOnly}
              onChange={(elementId) =>
                updateSelected({
                  location: elementId ? { ...selected.location, elementId } : undefined,
                })
              }
            />
            <TagListField
              label={t("detail.materials")}
              hint={t("detail.materialsHint")}
              value={selected.materialIds}
              disabled={readOnly}
              onChange={(materialIds) => updateSelected({ materialIds })}
            />
            <div className="field-row">
              <span className={`status-badge ${isVerified(selected) ? "is-ok" : "is-warning"}`}>
                {isVerified(selected) ? <Check size={12} /> : <AlertTriangle size={12} />}
                {isVerified(selected) ? t("detail.confirmed") : t("detail.unconfirmed")}
              </span>
              <button className="btn btn-ghost" disabled={readOnly} onClick={removeSelected}>
                <Trash2 size={14} /> {t("common.delete")}
              </button>
            </div>
          </>
        )}
      </SectionPanel>

      <SectionPanel title={t("detail.discover")}>
        <div className="field-row">
          <NumberField
            label={t("detail.shots")}
            hint={t("detail.shotsHint")}
            value={shotCount}
            step={1}
            onChange={(value) => setShotCount(Math.max(1, Math.min(10, Math.trunc(value ?? 1))))}
          />
          <SelectField
            label={t("detail.selection")}
            value={mode}
            allowEmpty={false}
            options={[
              { value: "auto", label: t("detail.auto") },
              { value: "manual", label: t("detail.manual") },
            ]}
            onChange={(value) => setMode(value ?? "auto")}
          />
        </div>
        {mode === "manual" && (
          <div className="list" aria-label={t("detail.manual")}>
            {confirmed.map((detail) => (
              <label className="list-row" key={detail.id}>
                <input
                  type="checkbox"
                  checked={manualIds.includes(detail.id)}
                  onChange={(event) => toggleManual(detail.id, event.target.checked)}
                />
                {detailLabel(detail)}
              </label>
            ))}
          </div>
        )}
        <button
          className="btn"
          data-testid="detail-plan"
          onClick={() => notify("info", t("detail.planned"))}
          disabled={!confirmed.length}
        >
          {t("detail.plan")}
        </button>
        {reselect && <div className="warning-box">{t("detail.reselect")}</div>}
        {plan.shortfall > 0 && (
          <div className="warning-box" role="status">
            <AlertTriangle size={14} /> {t("detail.shortfall", { count: plan.shortfall })}
          </div>
        )}
        {plan.shots.length ? (
          <div className="list" aria-label={t("detail.planned")}>
            {plan.shots.map((shot) => (
              <div className="list-row" key={`${shot.detailId}-${shot.cameraSuggestion}`}>
                <span>{detailLabel(details.find((detail) => detail.id === shot.detailId)!)}</span>
                <span className="spacer" />
                <span className="field-hint">
                  {t("detail.camera")}: {shot.cameraSuggestion} ·{" "}
                  {t("detail.angle", { index: shot.angleIndex + 1 })}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="field-hint">{t("detail.noPlan")}</p>
        )}
        <button
          className="btn btn-primary"
          data-testid="detail-generate"
          disabled={!plan.shots.length}
          onClick={generate}
        >
          {t("detail.generate")}
        </button>
      </SectionPanel>
      {batchOpen && (
        <BatchDialog
          mode="production"
          initialCameraIds={[...new Set(plan.shots.map((shot) => shot.cameraSuggestion))]}
          detailShots={plan.shots.map((shot) => ({
            detailId: shot.detailId,
            cameraId: shot.cameraSuggestion,
            label: t("detail.shotLabel", {
              detail: detailLabel(details.find((detail) => detail.id === shot.detailId)!),
              camera:
                dna.cameras.find((camera) => camera.id === shot.cameraSuggestion)?.name ??
                shot.cameraSuggestion,
              index: shot.angleIndex + 1,
            }),
          }))}
          onClose={() => setBatchOpen(false)}
        />
      )}
    </div>
  );
}
