import { Lock, Unlock } from "lucide-react";
import { useDnaLock } from "./DnaFields";

export function LockToggle({ section }: { section: "building" | "context" }) {
  const { locked, readOnly, toggle } = useDnaLock(section);
  return (
    <button
      className={`btn btn-sm ${locked ? "btn-primary" : "btn-ghost"}`}
      onClick={toggle}
      disabled={readOnly}
      aria-pressed={locked}
      title={
        locked
          ? "Locked: fields are read-only and the prompt preserves them"
          : "Lock this DNA section"
      }
    >
      {locked ? <Lock size={13} /> : <Unlock size={13} />}
      {locked ? "Locked" : "Lock"}
    </button>
  );
}
