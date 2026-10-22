import { isVideoAsset, assistCatalog } from "@arch/domain";
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
  const t = useT();
  const importer = useAssetImport();
  const references = ws.assets.filter(
    (a) => a.status === "ready" && a.role.endsWith("_reference") && !isVideoAsset(a),
  );
  const catalog = assistCatalog("interior", "interior");
  catalog.fields = catalog.fields.filter((f) => !/materialPresetId|surfaces/.test(f.path));
  catalog.fields.push(
    ...assistCatalog("mood", "interior").fields,
    ...assistCatalog("camera", "interior").fields,
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
        {t("assets.importImages")}
      </button>
      <div className="reference-thumbnail-grid">
        {references.map((a) => (
          <button
            className="reference-thumbnail"
            key={a.id}
            title={a.originalName ?? a.id}
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
      <ModuleAssist scope="interior" stepId="dna.building" catalog={catalog} />
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
