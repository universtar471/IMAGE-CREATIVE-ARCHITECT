import type { GenerationQuality, ModelCapabilities } from "@arch/domain";
import { FieldGroup } from "../../components/panels/fields";

const QUALITY_LABELS: Record<GenerationQuality, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

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
  if (model.qualityOptions.length === 0) return null;
  const options: (GenerationQuality | null)[] = [null, ...model.qualityOptions];
  return (
    <FieldGroup label="Quality" hint="Default uses the provider's setting. Higher is slower.">
      <div className="segmented" role="group" aria-label="Quality">
        {options.map((q) => (
          <button
            key={q ?? "default"}
            type="button"
            aria-pressed={value === q}
            disabled={disabled}
            onClick={() => onChange(q)}
          >
            {q ? QUALITY_LABELS[q] : "Default"}
          </button>
        ))}
      </div>
    </FieldGroup>
  );
}
