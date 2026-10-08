/**
 * Presentational form fields. They know nothing about DNA or persistence;
 * `features/dna/DnaFields.tsx` binds them to DNA paths.
 */
import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { X } from "lucide-react";

type FieldShellProps = {
  label: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  children: ReactNode;
};

export function FieldGroup({ label, hint, error, htmlFor, children }: FieldShellProps) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <span className="field-error" role="alert">
          {error}
        </span>
      ) : (
        hint && <span className="field-hint">{hint}</span>
      )}
    </div>
  );
}

type Common = { label: string; hint?: string; error?: string; disabled?: boolean };

/** Optional text: an empty box means "not set" (undefined), never an empty string. */
export function TextField({
  value,
  onChange,
  placeholder,
  suggestions,
  ...rest
}: Common & {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  placeholder?: string;
  suggestions?: readonly string[];
}) {
  const id = useId();
  const listId = suggestions?.length ? `${id}-list` : undefined;
  return (
    <FieldGroup label={rest.label} hint={rest.hint} error={rest.error} htmlFor={id}>
      <input
        id={id}
        className={`input ${rest.error ? "has-error" : ""}`}
        value={value ?? ""}
        placeholder={placeholder}
        disabled={rest.disabled}
        list={listId}
        aria-invalid={!!rest.error}
        onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
      />
      {listId && (
        <datalist id={listId}>
          {suggestions!.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
    </FieldGroup>
  );
}

export function TextAreaField({
  value,
  onChange,
  placeholder,
  ...rest
}: Common & { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const id = useId();
  return (
    <FieldGroup label={rest.label} hint={rest.hint} error={rest.error} htmlFor={id}>
      <textarea
        id={id}
        className={`textarea ${rest.error ? "has-error" : ""}`}
        value={value}
        placeholder={placeholder}
        disabled={rest.disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </FieldGroup>
  );
}

/** Parse user text into a number. Empty → undefined; unparsable → NaN (rejected by validation). */
export function parseNumberInput(text: string): number | undefined {
  const t = text.trim().replace(",", ".");
  if (t === "") return undefined;
  if (!/^-?\d*\.?\d+$|^-?\d+\.$/.test(t)) return Number.NaN;
  return Number(t);
}

/**
 * Number input that keeps the user's raw text locally, so "1." or "abc" are not lost
 * while typing; the parsed value (or NaN) is reported upward for validation.
 */
export function NumberField({
  value,
  onChange,
  suffix,
  step,
  ...rest
}: Common & {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  suffix?: string;
  step?: number;
}) {
  const id = useId();
  const format = (v: number | undefined) => (v === undefined || Number.isNaN(v) ? "" : String(v));
  const [text, setText] = useState(() => format(value));
  const [focused, setFocused] = useState(false);
  const [seenValue, setSeenValue] = useState(value);

  // Adopt external changes (load, other editors) while not editing — derived during render.
  if (!Object.is(value, seenValue)) {
    setSeenValue(value);
    if (!focused && !Number.isNaN(value)) setText(format(value));
  }

  return (
    <FieldGroup label={rest.label} hint={rest.hint} error={rest.error} htmlFor={id}>
      <div className="input-suffix">
        <input
          id={id}
          className={`input ${rest.error ? "has-error" : ""}`}
          inputMode="decimal"
          value={text}
          step={step}
          disabled={rest.disabled}
          aria-invalid={!!rest.error}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => {
            setText(e.target.value);
            onChange(parseNumberInput(e.target.value));
          }}
        />
        {suffix && <span>{suffix}</span>}
      </div>
    </FieldGroup>
  );
}

export function SelectField<T extends string>({
  value,
  onChange,
  options,
  allowEmpty = true,
  ...rest
}: Common & {
  value: T | undefined;
  onChange: (v: T | undefined) => void;
  options: readonly { value: T; label: string; disabled?: boolean }[];
  allowEmpty?: boolean;
}) {
  const id = useId();
  return (
    <FieldGroup label={rest.label} hint={rest.hint} error={rest.error} htmlFor={id}>
      <select
        id={id}
        className={`select ${rest.error ? "has-error" : ""}`}
        value={value ?? ""}
        disabled={rest.disabled}
        onChange={(e) => onChange(e.target.value === "" ? undefined : (e.target.value as T))}
      >
        {allowEmpty && <option value="">— not set —</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldGroup>
  );
}

/** Chips list. Enter or comma adds; Backspace on empty input removes the last chip. */
export function TagListField({
  value,
  onChange,
  placeholder = "Type and press Enter",
  ...rest
}: Common & { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const id = useId();
  const [draft, setDraft] = useState("");

  const commit = () => {
    const parts = draft
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .filter((p) => !value.some((v) => v.toLowerCase() === p.toLowerCase()));
    if (parts.length) onChange([...value, ...parts]);
    setDraft("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit();
    } else if (e.key === "Backspace" && draft === "" && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <FieldGroup label={rest.label} hint={rest.hint} error={rest.error} htmlFor={id}>
      <div className={`taglist ${rest.error ? "has-error" : ""}`}>
        {value.map((tag, i) => (
          <span className="tag" key={`${tag}-${i}`}>
            {tag}
            {!rest.disabled && (
              <button
                type="button"
                aria-label={`Remove ${tag}`}
                onClick={() => onChange(value.filter((_, j) => j !== i))}
              >
                <X size={12} />
              </button>
            )}
          </span>
        ))}
        {!rest.disabled && (
          <input
            id={id}
            value={draft}
            placeholder={value.length ? "" : placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={commit}
          />
        )}
      </div>
    </FieldGroup>
  );
}
