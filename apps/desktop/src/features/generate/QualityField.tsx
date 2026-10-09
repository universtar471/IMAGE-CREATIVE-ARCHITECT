import type { GenerationQuality, ModelCapabilities } from "@arch/domain";
import { FieldGroup } from "../../components/panels/fields";
import { useT } from "../../i18n";

/**
 * Quality segmented control, shown only for models that offer a choice. "Default" sends null:
 * the provider's own setting (for HHTECH, `HHTECH_IMAGE_QUALITY`).
 */
export function QualityField({
  model,
  value,
  disabled,
  onChange,
}: {
  model: Pick<ModelCapabilities, "qualityOptions">;
  value: GenerationQuality | null;
  disabled?: boolean;
  onChange: (quality: GenerationQuality | null) => void;
}) {
  const t = useT();
  if (model.qualityOptions.length === 0) return null;
  const options: (GenerationQuality | null)[] = [null, ...model.qualityOptions];
  return (
    <FieldGroup label={t("generate.quality")} hint={t("generate.qualityHint")}>
      <div className="segmented" role="group" aria-label={t("generate.quality")}>
        {options.map((q) => (
          <button
            key={q ?? "default"}
            type="button"
            aria-pressed={value === q}
            disabled={disabled}
            onClick={() => onChange(q)}
          >
            {q ? t(`labels.quality.${q}`) : t("generate.qualityDefault")}
          </button>
        ))}
      </div>
    </FieldGroup>
  );
}
