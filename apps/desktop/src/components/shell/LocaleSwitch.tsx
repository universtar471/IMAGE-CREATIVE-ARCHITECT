import { LOCALES, useLocale, useT } from "../../i18n";

/** "VI | EN" switch: changes the UI language instantly and remembers the choice. */
export function LocaleSwitch() {
  const locale = useLocale((s) => s.locale);
  const setLocale = useLocale((s) => s.setLocale);
  const t = useT();
  return (
    <div
      className="segmented locale-switch"
      role="group"
      aria-label={t("locale.switchLabel")}
      data-testid="locale-switch"
    >
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={locale === l}
          title={t(`locale.${l}`)}
          onClick={() => setLocale(l)}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
