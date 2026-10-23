import { isVideoAsset, assistCatalog } from "@arch/domain";
import { ImagePlus } from "lucide-react";
import { selectReadOnly, useStudio } from "../../app/store";
import { useT } from "../../i18n";
import { fileUrl } from "../../lib/files";
import { useAssetImport } from "./useAssetImport";
import { SectionPanel } from "../../components/panels/SectionPanel";
import { HelpPopover } from "../../components/common/HelpPopover";
import { ConfirmDialog } from "../../components/common/Dialog";
import { ModuleAssist } from "../assist/ModuleAssist";
import { AssetPropertyPanel } from "./AssetPropertyPanel";

export function SpaceReferences() {
  const ws = useStudio((s) => s.workspace!);
  const readOnly = useStudio(selectReadOnly);
  const selectedId = useStudio((s) => s.selectedAssetId);
  const t = useT();
  const importer = useAssetImport();
  const references = ws.assets.filter(
    (a) => a.status === "ready" && a.role.endsWith("_reference") && !isVideoAsset(a),
  );
  const scope = ws.project.projectType === "interior" ? "interior" : "building";
  const catalog = assistCatalog(scope, ws.project.projectType);
  catalog.fields = catalog.fields.filter((f) => !/materialPresetId|surfaces/.test(f.path));
  catalog.fields.push(
    ...assistCatalog("lighting", ws.project.projectType).fields,
    ...assistCatalog("mood", ws.project.projectType).fields,
    ...assistCatalog("camera", ws.project.projectType).fields,
  );
  catalog.fields = catalog.fields.filter(
    (field, index, fields) => fields.findIndex((f) => f.path === field.path) === index,
  );
  return (
    <SectionPanel
      title={t("menu.references")}
      aside={<HelpPopover topic={t("menu.references")}>{t("menu.referenceHelp")}</HelpPopover>}
    >
      <button
        className="btn btn-sm"
        disabled={readOnly || !!importer.busy}
        onClick={() => void importer.pickAndImport("architecture_reference")}
      >
        <ImagePlus size={16} aria-hidden />
        {t("assets.importImages")}
      </button>
      {!references.length && <p className="field-hint">{t("assist.noReferences")}</p>}
      <div className="reference-thumbnail-grid">
        {references.map((a) => (
          <button
            className="reference-thumbnail"
            key={a.id}
            title={a.originalName ?? a.id}
            aria-pressed={selectedId === a.id}
            onClick={() => useStudio.getState().selectAsset(a.id, { keepView: true })}
          >
            <img
              src={fileUrl(a.thumbnailPath ?? a.absolutePath) ?? ""}
              alt={a.originalName ?? a.id}
            />
            <span>{a.originalName}</span>
          </button>
        ))}
      </div>
      <ModuleAssist scope={scope} stepId="dna.building" catalog={catalog} />
      <SectionPanel title={t("assets.metadata")} defaultOpen={false}>
        <AssetPropertyPanel />
      </SectionPanel>
      {importer.duplicate && (
        <ConfirmDialog
          title={t("assets.duplicateTitle")}
          message={importer.duplicate.message}
          confirmLabel={t("assist.continue")}
          onCancel={() => importer.duplicate?.resolve(false)}
          onConfirm={() => importer.duplicate?.resolve(true)}
        />
      )}
    </SectionPanel>
  );
}
