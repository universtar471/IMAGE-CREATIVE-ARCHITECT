import { useEffect, useRef, useState } from "react";
import type { InteriorOption, InteriorSurfaces, ProjectDNA } from "@arch/domain";
import { selectReadOnly, useStudio } from "../../app/store";
import { ConfirmDialog } from "../../components/common/Dialog";
import { SectionPanel } from "../../components/panels/SectionPanel";
import { FieldGroup, NumberField, SelectField } from "../../components/panels/fields";
import { useLocale, useT } from "../../i18n";
import {
  BUILDING_USES,
  FURNITURE,
  INTERIOR_CATALOG,
  INTERIOR_STYLES,
  MATERIAL_PRESETS,
  PALETTES,
  ROOMS,
  applyStyleDefaults,
  catalogLabel,
  furnitureForRoom,
  presetSurfaces,
  proposeInteriorFromLegacy,
  roomsForUse,
  styleDefaults,
  type FurnitureId,
  type InteriorDNA,
  type InteriorStyleId,
} from "../../lib/interior";
import { AssistControl } from "../assist/AssistControl";
import { PhotoThumbnail } from "../previews/PhotoThumbnail";

type SurfaceSlot = keyof InteriorSurfaces;
type SurfaceOption = InteriorOption<string> & { swatch: string };

export function InteriorDnaPanel() {
  const ws = useStudio((state) => state.workspace!);
  const interior = (ws.draftDna as ProjectDNA).interior;
  return interior ? <InteriorEditor interior={interior} /> : <LegacyInteriorCallout />;
}

function InteriorEditor({ interior }: { interior: InteriorDNA }) {
  const editDna = useStudio((state) => state.editDna);
  const readOnly = useStudio(selectReadOnly);
  const locked = useStudio((state) => !!state.workspace?.draftDna.locks.building);
  const disabled = readOnly || locked;
  const t = useT();
  const locale = useLocale((state) => state.locale);
  const layoutRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<"stacked" | "split">("split");

  useEffect(() => {
    const element = layoutRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const update = (width: number) => setLayout(width < 560 ? "stacked" : "split");
    const initialWidth = element.getBoundingClientRect().width;
    if (initialWidth) update(initialWidth);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) update(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const replace = (next: InteriorDNA) => editDna("interior", next);
  const patch = <K extends keyof InteriorDNA>(key: K, value: InteriorDNA[K]) =>
    replace({ ...interior, [key]: value });
  const changeStyle = (styleId: InteriorStyleId) => {
    const currentDefaults = styleDefaults(interior.styleId);
    const currentPreset = interior.materialPresetId
      ? presetSurfaces(interior.materialPresetId)
      : undefined;
    const paletteEdited = interior.paletteId !== currentDefaults.paletteId;
    const presetEdited = interior.materialPresetId !== currentDefaults.materialPresetId;
    const surfacesEdited =
      !currentPreset ||
      (Object.keys(interior.surfaces) as SurfaceSlot[]).some(
        (slot) => interior.surfaces[slot].join("|") !== currentPreset[slot].join("|"),
      );
    if (
      (surfacesEdited || paletteEdited || presetEdited) &&
      !window.confirm(t("interior.applyStyleMaterials"))
    )
      return;
    replace(
      applyStyleDefaults(
        {
          ...interior,
          surfaces: {
            floor: [],
            wall: [],
            ceiling: [],
            cabinetry: [],
            countertop: [],
            textile: [],
            metal: [],
          },
        },
        styleId,
      ),
    );
  };
  const changeUse = (buildingUseId: InteriorDNA["buildingUseId"]) => {
    const validRooms = roomsForUse(buildingUseId);
    const roomId = validRooms.includes(interior.roomId)
      ? interior.roomId
      : validRooms.includes("other")
        ? "other"
        : validRooms[0]!;
    replace({ ...interior, buildingUseId, roomId });
  };

  return (
    <div
      ref={layoutRef}
      className="interior-layout"
      data-layout={layout}
      data-testid="interior-layout"
    >
      <Moodboard interior={interior} />
      <div className="interior-fields">
        <SectionPanel title={t("interior.space")}>
          <AssistControl
            scope="interior"
            stepId="dna.building"
            projectType="interior"
            projectId={useStudio.getState().workspace!.project.id}
            dna={useStudio.getState().workspace!.draftDna as ProjectDNA}
            assets={useStudio.getState().workspace!.assets}
            hasMaster={!!useStudio.getState().workspace!.project.activeMasterAssetId}
            onApply={(fields) => fields.forEach((field) => editDna(field.path, field.value))}
          />
          <SelectField
            label={t("interior.buildingUse")}
            allowEmpty={false}
            disabled={disabled}
            value={interior.buildingUseId}
            options={BUILDING_USES.map((item) => ({ value: item.id, label: item[locale] }))}
            onChange={(value) => value && changeUse(value)}
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
            onChange={(value) => value && patch("roomId", value)}
          />
        </SectionPanel>

        <SectionPanel title={`${t("interior.style")} & ${t("interior.palette")}`}>
          <SelectField
            label={t("interior.style")}
            allowEmpty={false}
            disabled={disabled}
            value={interior.styleId}
            options={INTERIOR_STYLES.map((item) => ({ value: item.id, label: item[locale] }))}
            onChange={(value) => value && changeStyle(value)}
          />
          <SelectField
            label={t("interior.palette")}
            disabled={disabled}
            value={interior.paletteId}
            options={PALETTES.map((item) => ({ value: item.id, label: item[locale] }))}
            onChange={(value) => patch("paletteId", value)}
          />
          <SelectField
            label={t("interior.materialPreset")}
            disabled={disabled}
            value={interior.materialPresetId}
            options={MATERIAL_PRESETS.map((item) => ({ value: item.id, label: item[locale] }))}
            onChange={(value) => {
              if (!value) return patch("materialPresetId", undefined);
              replace({ ...interior, materialPresetId: value, surfaces: presetSurfaces(value) });
            }}
          />
          <div className="interior-style-cards">
            {INTERIOR_STYLES.map((style) => {
              return (
                <button
                  key={style.id}
                  type="button"
                  className="interior-style-card"
                  aria-pressed={interior.styleId === style.id}
                  onClick={() => !disabled && changeStyle(style.id)}
                  disabled={disabled}
                >
                  <PhotoThumbnail kind="style" presetId={style.id} label={style[locale]}>
                    <span className="interior-style-fallback">{style[locale]}</span>
                  </PhotoThumbnail>
                  <span>{style[locale]}</span>
                </button>
              );
            })}
          </div>
        </SectionPanel>

        <SectionPanel title={t("interior.surfaces")} defaultOpen={false}>
          {(Object.keys(INTERIOR_CATALOG.surfaces) as SurfaceSlot[]).map((slot) => (
            <CatalogChips
              key={slot}
              label={t(`interior.surface.${slot}`)}
              options={INTERIOR_CATALOG.surfaces[slot]}
              value={interior.surfaces[slot]}
              locale={locale}
              disabled={disabled}
              onChange={(ids) =>
                replace({ ...interior, surfaces: { ...interior.surfaces, [slot]: ids } })
              }
            />
          ))}
        </SectionPanel>

        <SectionPanel title={t("interior.furniture")} defaultOpen={false}>
          <CatalogChips
            label={t("interior.furniture")}
            hint={t("interior.furnitureHint")}
            options={suggestedFurniture(interior.roomId)}
            value={interior.furnitureIds}
            locale={locale}
            disabled={disabled}
            onChange={(ids) => patch("furnitureIds", ids as FurnitureId[])}
          />
          <SelectField
            label={t("interior.furnishingDensity")}
            allowEmpty={false}
            disabled={disabled}
            value={interior.furnishingDensity}
            options={(["minimal", "balanced", "layered"] as const).map((value) => ({
              value,
              label: t(`interior.density.${value}`),
            }))}
            onChange={(value) => value && patch("furnishingDensity", value)}
          />
          <div className="field-row">
            <NumberField
              label={t("interior.area")}
              suffix="m²"
              disabled={disabled}
              value={interior.areaM2}
              onChange={(value) => patch("areaM2", value)}
            />
            <NumberField
              label={t("interior.ceilingHeight")}
              suffix="m"
              disabled={disabled}
              value={interior.ceilingHeightM}
              onChange={(value) => patch("ceilingHeightM", value)}
            />
          </div>
        </SectionPanel>

        <SectionPanel title={t("lighting.section")} defaultOpen={false}>
          <AssistControl
            scope="lighting"
            stepId="dna.lighting"
            projectType="interior"
            projectId={useStudio.getState().workspace!.project.id}
            dna={useStudio.getState().workspace!.draftDna as ProjectDNA}
            assets={useStudio.getState().workspace!.assets}
            hasMaster={!!useStudio.getState().workspace!.project.activeMasterAssetId}
            onApply={(fields) => fields.forEach((field) => editDna(field.path, field.value))}
          />
          <SelectField
            label={t("interior.daylightDirection")}
            disabled={disabled}
            value={interior.daylightDirection}
            options={(["front", "left", "right", "rear", "diffuse", "none"] as const).map(
              (value) => ({ value, label: t(`interior.daylightDirections.${value}`) }),
            )}
            onChange={(value) => patch("daylightDirection", value)}
          />
          <SelectField
            label={t("interior.daylightAmount")}
            disabled={disabled}
            value={interior.daylightAmount}
            options={(["low", "medium", "high"] as const).map((value) => ({
              value,
              label: t(`interior.daylightAmounts.${value}`),
            }))}
            onChange={(value) => patch("daylightAmount", value)}
          />
          <SelectField
            label={t("lighting.timeOfDay")}
            disabled={disabled}
            value={interior.timeOfDay}
            options={(
              ["morning", "midday", "afternoon", "golden_hour", "evening", "night"] as const
            ).map((value) => ({ value, label: t(`interior.time.${value}`) }))}
            onChange={(value) => patch("timeOfDay", value)}
          />
          <FieldGroup label={t("interior.artificialScenes")}>
            <div className="interior-scene-chips">
              {(["ambient", "task", "accent", "cove", "pendant", "downlight"] as const).map(
                (scene) => (
                  <button
                    type="button"
                    className="chip"
                    key={scene}
                    aria-pressed={interior.artificialScenes.includes(scene)}
                    disabled={disabled}
                    onClick={() =>
                      patch(
                        "artificialScenes",
                        interior.artificialScenes.includes(scene)
                          ? interior.artificialScenes.filter((value) => value !== scene)
                          : [...interior.artificialScenes, scene],
                      )
                    }
                  >
                    {t(`interior.scene.${scene}`)}
                  </button>
                ),
              )}
            </div>
          </FieldGroup>
          <FieldGroup label={t("interior.colorTemperature")}>
            <div className="segmented" role="group" aria-label={t("interior.colorTemperature")}>
              {([2700, 3000, 3500, 4000] as const).map((temperature) => (
                <button
                  type="button"
                  key={temperature}
                  aria-pressed={interior.colorTemperatureK === temperature}
                  disabled={disabled}
                  onClick={() => patch("colorTemperatureK", temperature)}
                >
                  {temperature} K
                </button>
              ))}
            </div>
          </FieldGroup>
        </SectionPanel>
      </div>
    </div>
  );
}

function CatalogChips<T extends string>({
  label,
  hint,
  options,
  value,
  locale,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  options: readonly InteriorOption<T>[];
  value: readonly T[];
  locale: "vi" | "en";
  disabled: boolean;
  onChange: (value: T[]) => void;
}) {
  const t = useT();
  const selected = new Set(value);
  const byId = new Map(options.map((item) => [item.id, item]));
  const orderedOptions = [
    ...value.map((id) => byId.get(id)).filter((item): item is InteriorOption<T> => !!item),
    ...options.filter((item) => !selected.has(item.id)),
  ];
  return (
    <FieldGroup label={label} hint={hint}>
      <div className="catalog-chips" role="group" aria-label={label}>
        {orderedOptions.map((item) => (
          <button
            className="catalog-chip"
            type="button"
            key={item.id}
            aria-pressed={value.includes(item.id)}
            disabled={disabled}
            onClick={() =>
              onChange(
                value.includes(item.id)
                  ? value.filter((id) => id !== item.id)
                  : [...value, item.id],
              )
            }
          >
            {item[locale]} {value[0] === item.id && <small>{t("assist.primary")}</small>}
          </button>
        ))}
      </div>
    </FieldGroup>
  );
}

function suggestedFurniture(roomId: InteriorDNA["roomId"]) {
  const suggested = new Set(furnitureForRoom(roomId));
  return [...FURNITURE].sort(
    (left, right) => Number(suggested.has(right.id)) - Number(suggested.has(left.id)),
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
