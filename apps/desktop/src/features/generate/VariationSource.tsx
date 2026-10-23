import { ArrowLeft, Image } from "lucide-react";
import type { AssetDTO } from "@arch/domain";
import { useStudio } from "../../app/store";
import { fileUrl } from "../../lib/files";
import { useT } from "../../i18n";

export function VariationSource({
  asset,
  disabled,
}: {
  asset: AssetDTO | null;
  disabled: boolean;
}) {
  const t = useT();
  return (
    <>
      <button
        type="button"
        className="btn btn-sm"
        disabled={disabled}
        onClick={() => {
          useStudio.getState().setGeneratePanelMode("create");
          useStudio.getState().setModule("generate");
        }}
      >
        <ArrowLeft size={16} aria-hidden /> {t("variation.back")}
      </button>
      <div className="variation-source" data-testid="variation-source">
        {asset ? (
          <img src={fileUrl(asset.thumbnailPath ?? asset.absolutePath) ?? undefined} alt="" />
        ) : (
          <Image size={24} aria-hidden />
        )}
        <div>
          <strong>{t("variation.source")}</strong>
          <span>{asset?.originalName ?? asset?.id ?? t("interiorFlow.sourceRequired")}</span>
        </div>
      </div>
    </>
  );
}
