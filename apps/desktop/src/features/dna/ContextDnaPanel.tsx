import { CONTEXT_DIRECTIONS, DensitySchema, type ProjectDNA } from "@arch/domain";
import { SectionPanel } from "../../components/panels/SectionPanel";
import { SelectField } from "../../components/panels/fields";
import { DnaSelect, DnaTags, DnaText, DnaTextArea } from "./DnaFields";
import { LockToggle } from "./LockToggle";
import { useT } from "../../i18n";
import { selectReadOnly, useStudio } from "../../app/store";
import {
  resolveSiteTopology,
  type CornerSide,
  type SiteTopology,
  type TopologyContext,
} from "../../lib/siteTopology";

export function ContextDnaPanel() {
  const t = useT();
  const projectType = useStudio((state) => state.workspace!.project.projectType);
  if (projectType === "interior") return <InteriorContextPanel />;
  const densityOptions = DensitySchema.options.map((d) => ({
    value: d,
    label: t(`labels.density.${d}`),
  }));
  return (
    <>
      <p className="field-hint dna-hint">{t("dna.englishHint")}</p>
      <SectionPanel title={t("context.setting")} aside={<LockToggle section="context" />}>
        <DnaText
          path="context.macroContext"
          label={t("context.macro")}
          placeholder={t("context.macroPlaceholder")}
        />
        <DnaText
          path="context.climateContext"
          label={t("context.climate")}
          placeholder={t("context.climatePlaceholder")}
        />
        <DnaSelect path="context.density" label={t("context.density")} options={densityOptions} />
      </SectionPanel>

      <SiteTopologyCard />

      {CONTEXT_DIRECTIONS.map((dir) => (
        <SectionPanel
          key={dir}
          title={t(`labels.contextDirection.${dir}`)}
          defaultOpen={dir === "front" || dir === "rear"}
        >
          <div className="field-row">
            <DnaText
              path={`context.${dir}.spaceType`}
              label={t("context.space")}
              placeholder={t("context.spacePlaceholder")}
            />
            <DnaText
              path={`context.${dir}.roadType`}
              label={t("context.road")}
              placeholder={t("context.roadPlaceholder")}
            />
          </div>
          <DnaTags
            path={`context.${dir}.elements`}
            label={t("context.elements")}
            placeholder={t("context.elementsPlaceholder")}
          />
          <DnaTags
            path={`context.${dir}.vegetation`}
            label={t("context.vegetation")}
            placeholder={t("context.vegetationPlaceholder")}
          />
          <DnaTags path={`context.${dir}.adjacentBuildings`} label={t("context.adjacent")} />
          <DnaTextArea path={`context.${dir}.notes`} label={t("context.notes")} />
        </SectionPanel>
      ))}

      <SectionPanel title={t("context.background")} defaultOpen={false}>
        <DnaTags
          path="context.distantBackground"
          label={t("context.distant")}
          placeholder={t("context.distantPlaceholder")}
        />
        <DnaTextArea path="context.atmosphereNotes" label={t("context.atmosphere")} />
      </SectionPanel>

      <SectionPanel title={t("context.negative")}>
        <DnaTags
          path="context.negativeConstraints"
          label={t("context.mustNotAppear")}
          hint={t("context.negativeHint")}
          placeholder={t("context.negativePlaceholder")}
        />
      </SectionPanel>
    </>
  );
}

function SiteTopologyCard() {
  const t = useT();
  const editDna = useStudio((state) => state.editDna);
  const context = useStudio(
    (state) => state.workspace!.draftDna.context as unknown as TopologyContext,
  );
  const readOnly = useStudio(selectReadOnly);
  const locked = useStudio((state) => !!state.workspace?.draftDna.locks.context);
  const topology = resolveSiteTopology(context);
  const disabled = readOnly || locked;
  const raw = context.siteTopology ?? {};
  const update = (patch: Partial<SiteTopology>) => {
    const next: SiteTopology = {
      left: raw.left ?? topology.left,
      right: raw.right ?? topology.right,
      cornerLot: raw.cornerLot === true,
      ...(raw.cornerSide ? { cornerSide: raw.cornerSide } : {}),
      ...patch,
    };
    if (next.cornerLot && (!next.cornerSide || next[next.cornerSide] === "attached")) {
      const candidate = (["left", "right"] as const).find((side) => next[side] !== "attached");
      if (candidate) next.cornerSide = candidate;
      else next.cornerLot = false;
    }
    if (!next.cornerLot) delete next.cornerSide;
    editDna("context.siteTopology", next);
  };
  const options = [
    { value: "attached" as const, label: t("topology.attached") },
    { value: "open" as const, label: t("topology.open") },
    { value: "unknown" as const, label: t("topology.unknown") },
  ];
  const cornerOptions = (["left", "right"] as const).map((side) => ({
    value: side,
    label: t(`topology.${side}`),
    disabled: topology[side] === "attached",
  }));

  return (
    <SectionPanel title={t("topology.title")}>
      <div className="field-row" data-testid="site-topology-card">
        {(["left", "right"] as const).map((side) => (
          <SelectField
            key={side}
            label={t(`topology.${side}`)}
            value={topology[side]}
            allowEmpty={false}
            disabled={disabled}
            options={options}
            onChange={(value) => value && update({ [side]: value })}
          />
        ))}
      </div>
      <div className="field-row">
        {(["left", "right"] as const).map(
          (side) =>
            topology.source[side] === "inferred" && (
              <span className="field-hint" key={`${side}-hint`}>
                {t("topology.inferred")}
              </span>
            ),
        )}
      </div>
      <label className="check-row">
        <input
          type="checkbox"
          checked={topology.cornerLot}
          disabled={disabled}
          onChange={(event) => update({ cornerLot: event.target.checked })}
        />
        {t("topology.cornerLot")}
      </label>
      {topology.cornerLot && (
        <SelectField
          label={t("topology.cornerSide")}
          value={topology.cornerSide}
          allowEmpty={false}
          disabled={disabled}
          options={cornerOptions}
          onChange={(value) => value && update({ cornerSide: value as CornerSide })}
        />
      )}
    </SectionPanel>
  );
}

function InteriorContextPanel() {
  const t = useT();
  const editDna = useStudio((state) => state.editDna);
  const dna = useStudio((state) => state.workspace!.draftDna as ProjectDNA);
  const readOnly = useStudio(selectReadOnly);
  const locked = useStudio((state) => !!state.workspace?.draftDna.locks.context);
  const interior = dna.interior;
  if (!interior) return <span className="field-hint">{t("interior.legacyContextHint")}</span>;
  const disabled = readOnly || locked;
  return (
    <>
      <p className="field-hint dna-hint">{t("dna.englishHint")}</p>
      <SectionPanel title={t("interior.window")}>
        <DnaText path="building.openings.windowType" label={t("interior.windowType")} />
        <div className="field-row">
          <DnaText path="building.openings.frame" label={t("interior.windowFrame")} />
          <DnaText path="building.openings.glazing" label={t("interior.glazing")} />
        </div>
      </SectionPanel>
      <SectionPanel title={t("interior.view")}>
        <DnaText path="context.front.spaceType" label={t("interior.viewType")} />
        <DnaTags path="context.front.elements" label={t("interior.viewElements")} />
        <DnaTextArea path="context.front.notes" label={t("context.notes")} />
      </SectionPanel>
      <SectionPanel title={t("interior.daylight")}>
        <SelectField
          label={t("interior.daylightDirection")}
          value={interior.daylightDirection}
          disabled={disabled}
          options={(["front", "left", "right", "rear", "diffuse", "none"] as const).map(
            (value) => ({
              value,
              label: t(`interior.daylightDirections.${value}`),
            }),
          )}
          onChange={(value) => editDna("interior.daylightDirection", value)}
        />
        <SelectField
          label={t("interior.daylightAmount")}
          value={interior.daylightAmount}
          disabled={disabled}
          options={(["low", "medium", "high"] as const).map((value) => ({
            value,
            label: t(`interior.daylightAmounts.${value}`),
          }))}
          onChange={(value) => editDna("interior.daylightAmount", value)}
        />
      </SectionPanel>
    </>
  );
}
