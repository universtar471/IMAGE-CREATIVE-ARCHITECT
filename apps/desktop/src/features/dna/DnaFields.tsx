/**
 * Fields bound to a dotted path inside the open project's draft DNA.
 * Edits go to the store (validated + debounced autosave); errors come from validation.
 */
import { useStudio, selectReadOnly } from "../../app/store";
import { getIn } from "../../lib/path";
import {
  NumberField,
  SelectField,
  TagListField,
  TextAreaField,
  TextField,
} from "../../components/panels/fields";

function useDnaBinding<T>(path: string) {
  const value = useStudio((s) => getIn(s.workspace?.draftDna, path)) as T;
  const error = useStudio((s) => s.save.fieldErrors[path]);
  const readOnly = useStudio(selectReadOnly);
  const locked = useStudio((s) => {
    const locks = s.workspace?.draftDna.locks;
    const section = path.split(".")[0];
    return section === "building"
      ? !!locks?.building
      : section === "context"
        ? !!locks?.context
        : false;
  });
  const editDna = useStudio((s) => s.editDna);
  return { value, error, disabled: readOnly || locked, set: (v: unknown) => editDna(path, v) };
}

type Base = { path: string; label: string; hint?: string };

export function DnaText({
  path,
  label,
  hint,
  placeholder,
  suggestions,
}: Base & { placeholder?: string; suggestions?: readonly string[] }) {
  const b = useDnaBinding<string | undefined>(path);
  return (
    <TextField
      label={label}
      hint={hint}
      placeholder={placeholder}
      suggestions={suggestions}
      value={b.value}
      error={b.error}
      disabled={b.disabled}
      onChange={b.set}
    />
  );
}

export function DnaTextArea({ path, label, hint, placeholder }: Base & { placeholder?: string }) {
  const b = useDnaBinding<string>(path);
  return (
    <TextAreaField
      label={label}
      hint={hint}
      placeholder={placeholder}
      value={b.value ?? ""}
      error={b.error}
      disabled={b.disabled}
      onChange={b.set}
    />
  );
}

export function DnaNumber({
  path,
  label,
  hint,
  suffix,
  integer,
}: Base & { suffix?: string; integer?: boolean }) {
  const b = useDnaBinding<number | undefined>(path);
  return (
    <NumberField
      label={label}
      hint={hint}
      suffix={suffix}
      step={integer ? 1 : 0.1}
      value={b.value}
      error={b.error}
      disabled={b.disabled}
      onChange={b.set}
    />
  );
}

export function DnaTags({ path, label, hint, placeholder }: Base & { placeholder?: string }) {
  const b = useDnaBinding<string[]>(path);
  const itemError = useStudio(
    (s) => Object.entries(s.save.fieldErrors).find(([k]) => k.startsWith(`${path}.`))?.[1],
  );
  return (
    <TagListField
      label={label}
      hint={hint}
      placeholder={placeholder}
      value={b.value ?? []}
      error={b.error ?? itemError}
      disabled={b.disabled}
      onChange={b.set}
    />
  );
}

export function DnaSelect<T extends string>({
  path,
  label,
  hint,
  options,
}: Base & { options: readonly { value: T; label: string }[] }) {
  const b = useDnaBinding<T | undefined>(path);
  return (
    <SelectField
      label={label}
      hint={hint}
      options={options}
      value={b.value}
      error={b.error}
      disabled={b.disabled}
      onChange={b.set}
    />
  );
}

export function useDnaLock(section: "building" | "context") {
  const locked = useStudio((s) => !!s.workspace?.draftDna.locks[section]);
  const readOnly = useStudio(selectReadOnly);
  const editDna = useStudio((s) => s.editDna);
  return { locked, readOnly, toggle: () => editDna(`locks.${section}`, !locked) };
}
