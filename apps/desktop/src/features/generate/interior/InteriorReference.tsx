import { ImagePlus } from "lucide-react";
import { isVideoAsset, REFERENCE_ATTRIBUTES, type InteriorGenerationState } from "@arch/domain";
import { useStudio } from "../../../app/store";
import { SelectField } from "../../../components/panels/fields";
import { HelpPopover } from "../../../components/common/HelpPopover";
import { ConfirmDialog } from "../../../components/common/Dialog";
import { useAssetImport } from "../../assets/useAssetImport";
import { fileUrl } from "../../../lib/files";
import { useT } from "../../../i18n";

export function InteriorReference({
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
    (a) => a.status === "ready" && !isVideoAsset(a) && a.id !== state.input.assetId,
  );
  const choose = (assetId: string | null) => {
    const latest = useStudio.getState().workspace?.shotIntent?.interiorGeneration ?? state;
    if (assetId && assetId === latest.input.assetId) return;
    set({
      ...latest,
      reference: assetId
        ? {
            assetId,
            attributes: {
              style: true,
              colors: false,
              materials: false,
              layout: false,
              lighting: false,
            },
          }
        : null,
    });
  };
  const selected = assets.find((a) => a.id === state.reference?.assetId);
  return (
    <div className="interior-source-input">
      <div className="field-heading">
        <strong>{t("interiorFlow.references")}</strong>
        <HelpPopover topic={t("interiorFlow.references")}>
          {t("interiorFlow.referenceHint")}
        </HelpPopover>
      </div>
      <SelectField
        label={t("interiorFlow.references")}
        value={state.reference?.assetId}
        disabled={disabled}
        options={assets.map((a) => ({ value: a.id, label: a.originalName ?? a.id }))}
        onChange={(id) => choose(id ?? null)}
      />
      <button
        type="button"
        className="btn btn-sm"
        disabled={disabled || !!importer.busy}
        onClick={() =>
          void importer.pickAndImport("architecture_reference").then((id) => {
            if (id && useStudio.getState().workspace?.project.id === ws.project.id) choose(id);
          })
        }
      >
        <ImagePlus size={16} />
        {t("interiorFlow.upload")}
      </button>
      {selected && (
        <img
          className="interior-source-preview"
          src={fileUrl(selected.thumbnailPath ?? selected.absolutePath) ?? ""}
          alt={selected.originalName ?? selected.id}
        />
      )}
      {state.reference && (
        <div
          className="interior-reference-attributes"
          role="group"
          aria-label={t("interiorFlow.referenceAttributes")}
        >
          {REFERENCE_ATTRIBUTES.map((attr) => (
            <label key={attr}>
              <input
                type="checkbox"
                checked={state.reference!.attributes[attr]}
                disabled={disabled}
                onChange={(e) =>
                  set({
                    ...state,
                    reference: {
                      ...state.reference!,
                      attributes: { ...state.reference!.attributes, [attr]: e.target.checked },
                    },
                  })
                }
              />
              {t(`interiorFlow.attributes.${attr}`)}
            </label>
          ))}
        </div>
      )}
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
