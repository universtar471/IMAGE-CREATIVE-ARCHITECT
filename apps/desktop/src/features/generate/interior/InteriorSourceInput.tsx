import { ImagePlus } from "lucide-react";
import { generationWithSource, isVideoAsset, type InteriorGenerationState } from "@arch/domain";
import { useStudio } from "../../../app/store";
import { SelectField } from "../../../components/panels/fields";
import { ConfirmDialog } from "../../../components/common/Dialog";
import { useAssetImport } from "../../assets/useAssetImport";
import { fileUrl } from "../../../lib/files";
import { useT } from "../../../i18n";

export function InteriorSourceInput({
  state,
  set,
  disabled,
}: {
  state: InteriorGenerationState;
  set: (next: InteriorGenerationState) => void;
  disabled: boolean;
}) {
  const ws = useStudio((s) => s.workspace!);
  const t = useT();
  const importer = useAssetImport();
  const assets = ws.assets.filter(
    (a) => a.status === "ready" && !isVideoAsset(a) && a.id !== state.reference?.assetId,
  );
  const source = assets.find((a) => a.id === state.input.assetId);
  const choose = (assetId: string | null) => {
    const latest = useStudio.getState().workspace?.shotIntent?.interiorGeneration ?? state;
    set(generationWithSource(latest, assetId));
    useStudio.getState().setGenerateDraft({ params: null });
  };
  return (
    <div className="interior-source-input">
      {source && (
        <img
          className="interior-source-preview"
          src={fileUrl(source.thumbnailPath ?? source.absolutePath) ?? ""}
          alt={source.originalName ?? source.id}
        />
      )}
      <SelectField
        label={t("interiorFlow.source")}
        value={state.input.assetId ?? undefined}
        disabled={disabled}
        options={assets.map((a) => ({ value: a.id, label: a.originalName ?? a.id }))}
        onChange={(id) => choose(id ?? null)}
      />
      <button
        type="button"
        className="btn btn-sm"
        disabled={disabled || !!importer.busy}
        onClick={() =>
          void importer.pickAndImport("regular_image").then((id) => {
            if (id && useStudio.getState().workspace?.project.id === ws.project.id) choose(id);
          })
        }
      >
        <ImagePlus size={16} />
        {t("interiorFlow.upload")}
      </button>
      <div className="segmented" role="group" aria-label={t("interiorFlow.inputType")}>
        {(["render", "photo", "sketch"] as const).map((type) => (
          <button
            type="button"
            key={type}
            aria-pressed={state.input.type === type}
            disabled={disabled}
            onClick={() => set({ ...state, input: { ...state.input, type } })}
          >
            {t(`interiorFlow.inputTypes.${type}`)}
          </button>
        ))}
      </div>
      {importer.duplicate && (
        <ConfirmDialog
          title={t("assets.duplicateTitle")}
          message={importer.duplicate.message}
          confirmLabel={t("assets.importAnyway")}
          onCancel={() => importer.duplicate?.resolve(false)}
          onConfirm={() => importer.duplicate?.resolve(true)}
        />
      )}
    </div>
  );
}
