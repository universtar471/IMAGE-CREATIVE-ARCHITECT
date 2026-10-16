/**
 * Links between the Space Catalog and older taxonomies. Suggestions only: nothing here
 * changes `projectType` or the ADR-027 interior DNA.
 */
import type { ProjectType } from "../schemas/enums";
import type { ProjectDNA } from "../schemas/projectDna";
import type { BuildingUseId, RoomId } from "../interior/catalog";
import { roomsForUse } from "../interior/helpers";
import { resolveActiveSpace } from "./resolve";
import type { SpaceArchetypeId } from "./schemas";

/**
 * Default archetype suggested for a project type. Types with no in-scope archetype
 * (ADR-034 amendment 2) map to `null`: the space selector stays optional for them.
 */
export const DEFAULT_ARCHETYPE_BY_PROJECT_TYPE: Readonly<
  Record<ProjectType, SpaceArchetypeId | null>
> = {
  interior: null,
  townhouse: "townhouse",
  single_storey_house: null,
  villa: "villa",
  urban_villa: "villa",
  prefab_modular: null,
  cafe: null,
  restaurant: null,
  hotel: "hotel",
  office: null,
  commercial: null,
  resort: "resort",
  custom: null,
};

/** Interior building use (ADR-027) → archetype, used to refine the suggestion for interiors. */
export const ARCHETYPE_BY_BUILDING_USE: Readonly<Partial<Record<BuildingUseId, SpaceArchetypeId>>> =
  {
    apartment: "apartment",
    studio: "apartment",
    duplex_penthouse: "apartment",
    townhouse: "townhouse",
    villa: "villa",
    hotel_room_suite: "hotel",
    resort: "resort",
  };

/**
 * The archetype to pre-select for a project: from the interior building use when there is
 * one, otherwise from the project type. `null` means no suggestion.
 */
export function suggestArchetype(
  projectType: ProjectType,
  interiorBuildingUse?: BuildingUseId | null,
): SpaceArchetypeId | null {
  const fromUse = interiorBuildingUse ? ARCHETYPE_BY_BUILDING_USE[interiorBuildingUse] : undefined;
  return fromUse ?? DEFAULT_ARCHETYPE_BY_PROJECT_TYPE[projectType];
}

/** V3 preset → ADR-027 interior room, where an equivalent room exists. */
export const INTERIOR_ROOM_BY_PRESET: Readonly<Record<string, RoomId>> = {
  "townhouse.living.phong_khach_rieng": "living_room",
  "townhouse.living.phong_khach_bep_an": "living_kitchen",
  "townhouse.living.phong_khach_phong_an": "living_room",
  "townhouse.living.phong_sinh_hoat_chung": "living_room",
  "townhouse.kitchen_dining.bep_rieng": "kitchen",
  "townhouse.kitchen_dining.bep_chu_i": "kitchen",
  "townhouse.kitchen_dining.bep_chu_l": "kitchen",
  "townhouse.kitchen_dining.bep_chu_u": "kitchen",
  "townhouse.kitchen_dining.bep_cuoi_nha": "kitchen",
  "townhouse.kitchen_dining.bep_phong_an": "kitchen",
  "townhouse.sleeping.phong_ngu_master": "master_bedroom",
  "townhouse.sleeping.phong_ngu_thuong": "bedroom",
  "townhouse.sleeping.phong_ngu_tre_em": "kids_room",
  "townhouse.sleeping.phong_ngu_khach": "bedroom",
  "townhouse.sleeping.phong_ngu_tang_lung": "bedroom",
  "townhouse.special.phong_tho": "prayer_room",
  "townhouse.special.phong_lam_viec": "home_office",
  "townhouse.special.goc_hoc_tap": "home_office",
  "townhouse.service.wc_nho": "bathroom",
  "townhouse.service.phong_tam": "bathroom",
  "villa.living.sanh_chinh": "lobby",
  "villa.living.sanh_phu": "lobby",
  "villa.living.phong_khach_chinh": "living_room",
  "villa.living.phong_khach_thong_tang": "living_room",
  "villa.living.phong_khach_ket_noi_san_vuon": "living_room",
  "villa.living.phong_sinh_hoat_gia_dinh": "living_room",
  "villa.living.phong_tiep_khach_rieng": "living_room",
  "villa.kitchen_dining.bep_chinh": "kitchen",
  "villa.kitchen_dining.bep_dao": "kitchen",
  "villa.kitchen_dining.bep_phu_bep_uot": "kitchen",
  "villa.kitchen_dining.phong_an_rieng": "dining_room",
  "villa.kitchen_dining.phong_an_ket_noi_san_vuon": "dining_room",
  "villa.sleeping.master_suite": "master_bedroom",
  "villa.sleeping.phong_ngu_master_thay_do": "master_bedroom",
  "villa.sleeping.phong_ngu_tre_em": "kids_room",
  "villa.sleeping.phong_ngu_khach": "bedroom",
  "villa.sleeping.phong_ngu_nguoi_lon_tuoi": "bedroom",
  "villa.sleeping.phong_ngu_nhan_vien": "bedroom",
  "villa.special.phong_spa": "spa_treatment",
  "villa.special.phong_lam_viec": "home_office",
  "villa.special.thu_vien": "home_office",
  "villa.service.phong_tho": "prayer_room",
  "apartment.living.khach_bep_an": "living_kitchen",
  "apartment.living.phong_khach_rieng": "living_room",
  "apartment.living.studio_da_nang": "living_kitchen",
  "apartment.living.phong_sinh_hoat_gia_dinh": "living_room",
  "apartment.kitchen_dining.bep_chu_i": "kitchen",
  "apartment.kitchen_dining.bep_chu_l": "kitchen",
  "apartment.kitchen_dining.bep_chu_u": "kitchen",
  "apartment.kitchen_dining.bep_dao": "kitchen",
  "apartment.kitchen_dining.khu_ban_an": "dining_room",
  "apartment.sleeping.phong_ngu_master": "master_bedroom",
  "apartment.sleeping.phong_ngu_nho": "bedroom",
  "apartment.sleeping.phong_ngu_tre_em": "kids_room",
  "apartment.sleeping.phong_ngu_khach": "bedroom",
  "apartment.sleeping.walk_in_closet": "walk_in_closet",
  "apartment.special.goc_lam_viec": "home_office",
  "apartment.special.phong_tho": "prayer_room",
  "apartment.service.phong_tam": "bathroom",
  "hotel.living.sanh_don": "lobby",
  "hotel.living.quay_le_tan": "reception",
  "hotel.living.lobby_lounge": "lobby",
  "hotel.sleeping.standard_room": "bedroom",
  "hotel.sleeping.superior_room": "bedroom",
  "hotel.sleeping.deluxe_room": "bedroom",
  "hotel.sleeping.twin_room": "bedroom",
  "hotel.sleeping.junior_suite": "master_bedroom",
  "hotel.sleeping.executive_suite": "master_bedroom",
  "hotel.sleeping.presidential_suite": "master_bedroom",
  "hotel.special.nha_hang": "cafe_dining",
  "hotel.special.khu_buffet": "cafe_dining",
  "hotel.special.bar_lounge": "bar_counter",
  "hotel.special.phong_hop": "meeting_room",
  "hotel.special.spa": "spa_treatment",
  "resort.living.arrival_pavilion": "reception",
  "resort.living.lobby_mo": "lobby",
  "resort.sleeping.beach_villa_suite": "master_bedroom",
  "resort.sleeping.forest_villa_suite": "master_bedroom",
  "resort.sleeping.bungalow": "bedroom",
  "resort.sleeping.pool_villa": "master_bedroom",
  "resort.sleeping.family_suite": "bedroom",
  "resort.sleeping.phong_ngu_huong_canh_quan": "bedroom",
  "resort.special.spa": "spa_treatment",
  "resort.special.wellness_room": "spa_treatment",
  "resort.special.nha_hang": "cafe_dining",
  "resort.special.pool_bar": "bar_counter",
};

/** The ADR-027 interior room of a preset, or `null` when none is equivalent. */
export function interiorRoomForPreset(presetId: string | null | undefined): RoomId | null {
  return presetId && Object.hasOwn(INTERIOR_ROOM_BY_PRESET, presetId)
    ? INTERIOR_ROOM_BY_PRESET[presetId]!
    : null;
}

/**
 * The ADR-027 room to suggest for `dna.interior.roomId` from the active catalog space, or
 * `null` when there is nothing to suggest: no interior DNA, no active interior space, no
 * equivalent room, a room the building use does not offer, or the room already chosen.
 * A suggestion only: the interior panel owns `interior.roomId` and applies it on one click.
 */
export function suggestInteriorRoom(
  dna: Pick<ProjectDNA, "interior" | "spaceCatalog">,
): RoomId | null {
  const interior = dna.interior;
  const preset = resolveActiveSpace(dna)?.preset;
  if (!interior || !preset || preset.zone !== "interior") return null;
  const room = interiorRoomForPreset(preset.id);
  if (!room || room === interior.roomId) return null;
  return roomsForUse(interior.buildingUseId).includes(room) ? room : null;
}
