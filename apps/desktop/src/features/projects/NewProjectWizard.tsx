import { useState } from "react";
import { Building2, Sofa, Check } from "lucide-react";
import type { ProjectDTO } from "@arch/domain";
import { defaultInteriorDNA } from "@arch/domain";
import { createProject } from "../../app/services";
import { Dialog } from "../../components/common/Dialog";
import { TextField } from "../../components/panels/fields";
import { toBridgeError } from "../../lib/bridge";
import { useT } from "../../i18n";
import { translateDomainMessage } from "../../i18n/domain";

/** Existing project types stay intact; new architecture projects start as custom. */
export function NewProjectWizard({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (p: ProjectDTO) => void;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [type, setType] = useState<"interior" | "custom">("custom");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    if (busy || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const project = await createProject({
        name: name.trim(),
        projectType: type,
        subtype: null,
        starter: {},
        ...(type === "interior" ? { interior: defaultInteriorDNA() } : {}),
      });
      onCreated(project);
    } catch (err) {
      setError(translateDomainMessage(toBridgeError(err).message, t));
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={t("wizard.title")}
      onClose={onClose}
      footer={
        <>
          {error && (
            <span className="field-error" role="alert">
              {error}
            </span>
          )}
          <span className="spacer" />
          <button
            className="btn btn-primary"
            disabled={busy || !name.trim()}
            onClick={() => void create()}
          >
            <Check size={14} />
            {busy ? t("wizard.creating") : t("wizard.create")}
          </button>
        </>
      }
    >
      <TextField
        label={t("wizard.name")}
        value={name}
        disabled={busy}
        placeholder={t("wizard.namePlaceholder")}
        onChange={(v) => setName(v ?? "")}
      />
      <div className="choice-grid" role="group" aria-label={t("menu.designType")}>
        {(["interior", "custom"] as const).map((value) => (
          <button
            type="button"
            className="choice"
            key={value}
            disabled={busy}
            aria-pressed={type === value}
            onClick={() => setType(value)}
          >
            {value === "interior" ? <Sofa size={24} /> : <Building2 size={24} />}
            <strong>{t(value === "interior" ? "menu.interior" : "menu.architecture")}</strong>
          </button>
        ))}
      </div>
    </Dialog>
  );
}
