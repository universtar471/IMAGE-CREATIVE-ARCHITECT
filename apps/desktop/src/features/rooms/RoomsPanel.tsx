import { useState } from "react";
import {
  BedDouble,
  Bath,
  CookingPot,
  Sofa,
  Monitor,
  Baby,
  Shirt,
  Utensils,
  DoorOpen,
} from "lucide-react";
import {
  isVideoAsset,
  FURNITURE,
  ROOMS,
  furnitureForRoom,
  roomsForUse,
  generationFromLegacy,
  type FurnitureId,
  type RoomId,
} from "@arch/domain";
import { selectReadOnly, useStudio } from "../../app/store";
import { useLocale, useT } from "../../i18n";
import { HelpPopover } from "../../components/common/HelpPopover";
import { ModuleAssist } from "../assist/ModuleAssist";
import { SelectField } from "../../components/panels/fields";

export function RoomsPanel() {
  const ws = useStudio((s) => s.workspace!);
  const readOnly = useStudio(selectReadOnly);
  const selectedAssetId = useStudio((s) => s.selectedAssetId);
  const locale = useLocale((s) => s.locale);
  const t = useT();
  const interior = ws.draftDna.interior;
  const [components, setComponents] = useState<readonly FurnitureId[]>(
    interior?.furnitureIds ?? [],
  );
  if (!interior) return null;
  const disabled = readOnly || ws.draftDna.locks.building;
  const choose = (roomId: RoomId) => {
    useStudio.getState().editDna("interior.roomId", roomId);
    const shot = useStudio.getState().workspace?.shotIntent;
    if (shot?.interiorGeneration)
      useStudio.getState().setShotIntent({
        ...shot,
        interiorGeneration: {
          ...shot.interiorGeneration,
          room: generationFromLegacy(roomId).room,
        },
      });
    setComponents(furnitureForRoom(roomId));
  };
  const sourceId = ws.assets.find(
    (a) =>
      a.id === (selectedAssetId ?? ws.project.activeMasterAssetId) &&
      a.status === "ready" &&
      !isVideoAsset(a),
  )?.id;
  const add = (node: boolean) => {
    if (disabled) return;
    const s = useStudio.getState();
    s.editDna("interior.furnitureIds", [...components]);
    const room = ROOMS.find((r) => r.id === interior.roomId)?.en ?? interior.roomId;
    const line = `${room}: ${components.map((id) => FURNITURE.find((f) => f.id === id)?.en ?? id).join(", ")}`;
    const previous = s.generateDraft.extraPrompt?.trim();
    s.setGenerateDraft({
      extraPrompt: previous?.split("\n").includes(line)
        ? previous
        : previous
          ? `${previous}\n${line}`
          : line,
      ...(node && sourceId
        ? { source: "sketch", purpose: "variation", referenceAssetIds: [sourceId] }
        : {}),
    });
    if (node) {
      s.setModule("generate");
      s.setWorkspaceMode("node");
      s.setCanvasSelection(["draft"]);
    }
    s.notify("success", t("menu.added"));
  };
  const icon = (id: string) =>
    id.includes("bedroom")
      ? BedDouble
      : id.includes("bath")
        ? Bath
        : id.includes("kitchen")
          ? CookingPot
          : id.includes("living")
            ? Sofa
            : id.includes("office")
              ? Monitor
              : id.includes("kids")
                ? Baby
                : id.includes("closet")
                  ? Shirt
                  : id.includes("dining")
                    ? Utensils
                    : DoorOpen;
  return (
    <div className="rooms-panel">
      <SelectField
        label={t("interior.furnishingDensity")}
        disabled={disabled}
        value={interior.furnishingDensity}
        allowEmpty={false}
        options={(["minimal", "balanced", "layered"] as const).map((id) => ({
          value: id,
          label: t(`interior.density.${id}`),
        }))}
        onChange={(value) =>
          value && useStudio.getState().editDna("interior.furnishingDensity", value)
        }
      />
      <HelpPopover topic={t("menu.rooms")}>{t("menu.roomHelp")}</HelpPopover>
      <ModuleAssist
        scope="rooms"
        stepId="dna.building"
        onApply={(fields) => {
          useStudio.getState().applyDnaAssist(fields);
          setComponents(useStudio.getState().workspace!.draftDna.interior!.furnitureIds);
        }}
      />
      <div className="room-type-grid" role="group" aria-label={t("menu.roomTypes")}>
        {roomsForUse(interior.buildingUseId).map((id) => {
          const Icon = icon(id);
          return (
            <button
              type="button"
              className="choice"
              key={id}
              disabled={disabled}
              aria-pressed={interior.roomId === id}
              onClick={() => choose(id)}
            >
              <Icon size={22} />
              <span>{ROOMS.find((r) => r.id === id)?.[locale]}</span>
            </button>
          );
        })}
      </div>
      <div className="catalog-chips" role="group" aria-label={t("menu.components")}>
        {FURNITURE.filter(
          (f) => furnitureForRoom(interior.roomId).includes(f.id) || components.includes(f.id),
        ).map((f) => (
          <button
            type="button"
            className="chip"
            key={f.id}
            disabled={disabled}
            aria-pressed={components.includes(f.id)}
            onClick={() =>
              setComponents(
                components.includes(f.id)
                  ? components.filter((id) => id !== f.id)
                  : [...components, f.id],
              )
            }
          >
            {f[locale]}
          </button>
        ))}
      </div>
      <div className="module-actions">
        <button className="btn" disabled={disabled} onClick={() => add(false)}>
          {t("menu.addPrompt")}
        </button>
        <button
          className="btn"
          disabled={disabled || !sourceId}
          title={!sourceId ? t("menu.nodeSource") : undefined}
          onClick={() => add(true)}
        >
          {t("menu.addNode")}
        </button>
      </div>
    </div>
  );
}
