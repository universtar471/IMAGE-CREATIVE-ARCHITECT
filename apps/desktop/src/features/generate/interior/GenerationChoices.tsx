import type { GenerationPreset } from "@arch/domain";
import { useLocale } from "../../../i18n";
import { GenerationIcon } from "./GenerationIcon";

export function GenerationChoices<Id extends string>({
  items,
  value,
  onChange,
  disabled,
  label,
}: {
  items: readonly GenerationPreset<Id>[];
  value: Id | null;
  onChange: (id: Id) => void;
  disabled: boolean;
  label: string;
}) {
  const locale = useLocale((s) => s.locale);
  return (
    <div className="generation-choice-grid" role="group" aria-label={label}>
      {items.map((item) => (
        <button
          className="generation-choice"
          type="button"
          key={item.id}
          aria-pressed={value === item.id}
          disabled={disabled}
          title={item.description[locale]}
          data-generation-preset={item.id}
          onClick={() => onChange(item.id)}
        >
          <GenerationIcon id={item.icon} />
          <span>{item.label[locale]}</span>
        </button>
      ))}
    </div>
  );
}
