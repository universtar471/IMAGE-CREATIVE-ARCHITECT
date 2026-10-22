import { Building2, Mountain, Trees, Waves, Wheat, TreePine } from "lucide-react";
import { useState } from "react";
import { selectReadOnly, useStudio } from "../../app/store";
import { SectionPanel } from "../../components/panels/SectionPanel";
import { HelpPopover } from "../../components/common/HelpPopover";
import { useLocale, useT } from "../../i18n";
import { ContextDnaPanel } from "../dna/ContextDnaPanel";
import { LockToggle } from "../dna/LockToggle";
import { StepFrame } from "../workflow/StepFrame";

const SETTINGS = [
  {
    id: "city",
    vi: "Thành phố",
    en: "City",
    icon: Building2,
    view: "city view",
    macro: "urban city setting",
  },
  {
    id: "garden",
    vi: "Sân vườn",
    en: "Garden",
    icon: Trees,
    view: "garden view",
    macro: "landscaped garden setting",
  },
  {
    id: "mountains",
    vi: "Cảnh núi",
    en: "Mountains",
    icon: Mountain,
    view: "mountain view",
    macro: "mountain landscape setting",
  },
  {
    id: "sea",
    vi: "Cảnh biển",
    en: "Sea",
    icon: Waves,
    view: "sea view",
    macro: "coastal sea setting",
  },
  {
    id: "countryside",
    vi: "Đồng quê",
    en: "Countryside",
    icon: Wheat,
    view: "countryside view",
    macro: "rural countryside setting",
  },
  {
    id: "forest",
    vi: "Rừng cây",
    en: "Forest",
    icon: TreePine,
    view: "forest view",
    macro: "woodland forest setting",
  },
] as const;

/** Uses existing Context DNA fields; legacy/custom context remains editable below. */
export function SpaceContextSection() {
  const t = useT();
  const vi = useLocale((s) => s.locale) === "vi";
  const context = useStudio((s) => s.workspace!.draftDna.context);
  const locked = useStudio((s) => !!s.workspace!.draftDna.locks.context);
  const disabled = useStudio(selectReadOnly) || locked;
  const editDna = useStudio((s) => s.editDna);
  const [detailsMounted, setDetailsMounted] = useState(false);
  return (
    <SectionPanel title={t("context.setting")} aside={<LockToggle section="context" />}>
      <div
        className="choice-grid space-context-grid"
        role="group"
        aria-label={t("context.setting")}
      >
        {SETTINGS.map(({ id, vi: nameVi, en, icon: Icon, view, macro }) => (
          <button
            type="button"
            className="choice premium-preset-card"
            key={id}
            disabled={disabled}
            aria-pressed={context.front.spaceType === view}
            data-context={id}
            onClick={() =>
              editDna("context", {
                ...context,
                macroContext: macro,
                front: { ...context.front, spaceType: view },
              })
            }
          >
            <Icon size={28} aria-hidden="true" />
            <span>{vi ? nameVi : en}</span>
          </button>
        ))}
      </div>
      <HelpPopover topic={t("context.setting")}>{t("spaceContext.hint")}</HelpPopover>
      <details
        className="space-context-details"
        onToggle={(event) => {
          if (event.currentTarget.open) setDetailsMounted(true);
        }}
      >
        <summary>{t("spaceContext.details")}</summary>
        {detailsMounted && (
          <StepFrame stepId="dna.context">
            <ContextDnaPanel />
          </StepFrame>
        )}
      </details>
    </SectionPanel>
  );
}
