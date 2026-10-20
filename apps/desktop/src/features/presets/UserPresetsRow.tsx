import { useEffect, useState } from "react";
import { Save, X } from "lucide-react";
import { USER_PRESET_NAME_MAX, type UserPresetDTO } from "@arch/domain";
import { call, toBridgeError } from "../../lib/bridge";
import { ConfirmDialog } from "../../components/common/Dialog";
import { useLocale, useT } from "../../i18n";
import { presetLabels } from "./labels";
import { HelpPopover } from "../../components/common/HelpPopover";

/**
 * "My presets" (ADR-040): saved preset combinations shared by every project. A click replaces
 * the current selection with the saved one; deleting always asks first.
 */
export function UserPresetsRow({
  selected,
  disabled,
  onApply,
}: {
  selected: readonly string[];
  disabled: boolean;
  onApply: (presetIds: string[]) => void;
}) {
  const t = useT();
  const locale = useLocale((s) => s.locale);
  const [items, setItems] = useState<UserPresetDTO[] | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<UserPresetDTO | null>(null);

  useEffect(() => {
    let alive = true;
    call("user_preset_list", {}).then(
      (list) => alive && setItems(list),
      (e: unknown) => alive && setError(toBridgeError(e).message),
    );
    return () => {
      alive = false;
    };
  }, []);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const saved = await call("user_preset_save", { name, presetIds: [...selected] });
      setItems((list) =>
        [...(list ?? []), saved].sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
        ),
      );
      setNaming(false);
      setName("");
    } catch (e) {
      setError(toBridgeError(e).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (preset: UserPresetDTO) => {
    setDeleting(null);
    setError(null);
    try {
      await call("user_preset_delete", { id: preset.id });
      setItems((list) => (list ?? []).filter((p) => p.id !== preset.id));
    } catch (e) {
      setError(toBridgeError(e).message);
    }
  };

  return (
    <div className="preset-group user-presets" data-testid="user-presets">
      <div className="field-heading">
        <span className="field-label">{t("presets.mine")}</span>
        <HelpPopover topic={t("presets.mine")}>{t("presets.mineEmpty")}</HelpPopover>
      </div>
      <div className="preset-options">
        {items?.map((preset) => (
          <span className="user-preset" key={preset.id}>
            <button
              type="button"
              className="chip"
              disabled={disabled}
              title={presetLabels(preset.presetIds, locale).join(" · ")}
              onClick={() => onApply(preset.presetIds)}
            >
              {preset.name}
            </button>
            <button
              type="button"
              className="preset-chip-remove"
              disabled={disabled}
              aria-label={t("presets.deleteMine", { name: preset.name })}
              onClick={() => setDeleting(preset)}
            >
              <X size={11} />
            </button>
          </span>
        ))}
      </div>
      {naming ? (
        <form
          className="user-preset-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <input
            className="input"
            autoFocus
            maxLength={USER_PRESET_NAME_MAX}
            value={name}
            placeholder={t("presets.namePlaceholder")}
            aria-label={t("presets.name")}
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit" className="btn btn-sm btn-primary" disabled={busy || !name.trim()}>
            {t("common.save")}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setNaming(false)}>
            {t("common.cancel")}
          </button>
        </form>
      ) : (
        <button
          type="button"
          className="btn btn-sm btn-wrap"
          disabled={disabled || selected.length === 0}
          onClick={() => setNaming(true)}
        >
          <Save size={13} /> {t("presets.saveMine")}
        </button>
      )}
      {error && (
        <span className="field-error" role="alert">
          {error}
        </span>
      )}
      {deleting && (
        <ConfirmDialog
          title={t("presets.deleteTitle")}
          message={t("presets.deleteMessage", { name: deleting.name })}
          confirmLabel={t("presets.deleteConfirm")}
          danger
          onConfirm={() => void remove(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
