import { assistCatalog } from "@arch/domain";
import { useState } from "react";
import type { InteriorOption, InteriorSurfaces } from "@arch/domain";
import { selectReadOnly, useStudio } from "../../app/store";
import { ConfirmDialog } from "../../components/common/Dialog";
import { SectionPanel } from "../../components/panels/SectionPanel";
import { NumberField, SelectField } from "../../components/panels/fields";
import { useLocale, useT } from "../../i18n";
import {
  BUILDING_USES,
  INTERIOR_CATALOG,
  INTERIOR_STYLES,
  PALETTES,
  ROOMS,
  catalogLabel,
  proposeInteriorFromLegacy,
  roomsForUse,
  type InteriorDNA,
} from "../../lib/interior";
import { ModuleAssist } from "../assist/ModuleAssist";
import { SpaceSelector } from "../space/SpaceSelector";
import { SpaceReferences } from "../assets/SpaceReferences";

type SurfaceSlot = keyof InteriorSurfaces;
type SurfaceOption = InteriorOption<string> & { swatch: string };

export function InteriorDnaPanel() {
  const ws = useStudio((state) => state.workspace!);
  const interior = ws.draftDna.interior;
  return interior ? <InteriorEditor interior={interior} /> : <LegacyInteriorCallout />;
}

function InteriorEditor({ interior }: { interior: InteriorDNA }) {
  const editDna = useStudio((state) => state.editDna);
  const readOnly = useStudio(selectReadOnly);
  const locked = useStudio((state) => !!state.workspace?.draftDna.locks.building);
  const disabled = readOnly || locked;
  const t = useT();
  const locale = useLocale((state) => state.locale);
  const catalog = assistCatalog("interior", "interior");
  return (
    <div className="interior-layout" data-layout="stacked" data-testid="interior-layout">
      <Moodboard interior={interior} mini />
      <div className="interior-fields">
        <SectionPanel title={t("interior.space")}>
          <ModuleAssist
            scope="interior"
            stepId="dna.building"
            catalog={{
              ...catalog,
              fields: catalog.fields.filter((f) => !/materialPresetId|surfaces/.test(f.path)),
            }}
          />
          <SelectField
            label={t("interior.buildingUse")}
            allowEmpty={false}
            disabled={disabled}
            value={interior.buildingUseId}
            options={BUILDING_USES.map((item) => ({ value: item.id, label: item[locale] }))}
            onChange={(buildingUseId) => {
              if (!buildingUseId) return;
              const rooms = roomsForUse(buildingUseId);
              editDna("interior", {
                ...interior,
                buildingUseId,
                roomId: rooms.includes(interior.roomId)
                  ? interior.roomId
                  : rooms.includes("other")
                    ? "other"
                    : rooms[0],
              });
            }}
          />
          <SelectField
            label={t("interior.room")}
            allowEmpty={false}
            disabled={disabled}
            value={interior.roomId}
            options={roomsForUse(interior.buildingUseId).map((id) => ({
              value: id,
              label: catalogLabel(ROOMS, id, locale),
            }))}
            onChange={(id) => id && editDna("interior.roomId", id)}
          />
          <div className="field-row">
            <NumberField
              label={t("interior.area")}
              suffix="m²"
              disabled={disabled}
              value={interior.areaM2}
              onChange={(v) => editDna("interior.areaM2", v)}
            />
            <NumberField
              label={t("interior.ceilingHeight")}
              suffix="m"
              disabled={disabled}
              value={interior.ceilingHeightM}
              onChange={(v) => editDna("interior.ceilingHeightM", v)}
            />
          </div>
        </SectionPanel>
        <SpaceReferences />
        <SpaceSelector />
      </div>
    </div>
  );
}

export function Moodboard({ interior, mini = false }: { interior: InteriorDNA; mini?: boolean }) {
  const locale = useLocale((state) => state.locale);
  const t = useT();
  const materials = (Object.keys(INTERIOR_CATALOG.surfaces) as SurfaceSlot[]).flatMap((slot) =>
    interior.surfaces[slot].map((id) => ({
      slot,
      item: (INTERIOR_CATALOG.surfaces[slot] as readonly SurfaceOption[]).find(
        (candidate) => candidate.id === id,
      ),
    })),
  );
  return (
    <aside
      className={`interior-moodboard ${mini ? "is-mini" : ""}`}
      data-testid="interior-moodboard"
    >
      {!mini && <h3>{t("interior.moodboard")}</h3>}
      <strong>{catalogLabel(INTERIOR_STYLES, interior.styleId, locale)}</strong>
      <div className="moodboard-palette" aria-label={t("interior.paletteSwatches")}>
        {(interior.paletteId
          ? (PALETTES.find((palette) => palette.id === interior.paletteId)?.swatches ?? [])
          : []
        ).map((color) => (
          <span
            key={color}
            className="moodboard-swatch"
            style={{ background: color }}
            title={color}
          />
        ))}
      </div>
      <div className="moodboard-materials">
        {materials.map(
          ({ slot, item }, index) =>
            item && (
              <span className="moodboard-material" key={`${slot}-${item.id}-${index}`}>
                <i style={{ background: item.swatch }} />
                {!mini && <small>{item[locale]}</small>}
              </span>
            ),
        )}
      </div>
    </aside>
  );
}

function LegacyInteriorCallout() {
  const dna = useStudio((state) => state.workspace!.draftDna);
  const editDna = useStudio((state) => state.editDna);
  const readOnly = useStudio(selectReadOnly);
  const [confirming, setConfirming] = useState(false);
  const { proposal, matched } = proposeInteriorFromLegacy(dna);
  const t = useT();
  return (
    <>
      <div className="callout callout-warning interior-legacy" role="status">
        <strong>{t("interior.legacyTitle")}</strong>
        <span>{t("interior.legacyMessage")}</span>
        <button className="btn btn-sm" disabled={readOnly} onClick={() => setConfirming(true)}>
          {t("interior.convert")}
        </button>
      </div>
      {confirming && (
        <ConfirmDialog
          title={t("interior.convertTitle")}
          confirmLabel={t("interior.convert")}
          message={
            <>
              <p>{t("interior.convertMessage")}</p>
              <strong>{t("interior.matchedFields")}</strong>
              {matched.length ? (
                <ul>
                  {matched.map((field) => (
                    <li key={field}>{field}</li>
                  ))}
                </ul>
              ) : (
                <p className="field-hint">{t("interior.noMatchedFields")}</p>
              )}
            </>
          }
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            editDna("interior", proposal);
            setConfirming(false);
          }}
        />
      )}
    </>
  );
}
