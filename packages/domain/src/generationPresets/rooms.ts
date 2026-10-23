import type { GenerationPreset, GenerationRoom } from "./schema";
const room = (
  id: GenerationRoom,
  vi: string,
  en: string,
  icon: string,
): GenerationPreset<GenerationRoom> => ({
  id,
  label: { vi, en },
  description: {
    vi: `Ngữ cảnh chức năng: ${vi.toLowerCase()}.`,
    en: `Functional context: ${en.toLowerCase()}; do not infer a furniture shopping list.`,
  },
  icon: `icon-room-${icon}`,
  promptFragment: `Room function: ${en.toLowerCase()}. Use this only as functional context, not as a requirement to add furniture or objects.`,
  negativeFragment: "",
  defaults: {},
  constraints: ["functional-context-only"],
  conflicts: [],
  compatibleModes: ["interior"],
});
export const GENERATION_ROOMS = [
  room("living_room", "Phòng khách", "Living room", "living"),
  room("bedroom", "Phòng ngủ", "Bedroom", "bedroom"),
  room("kitchen", "Bếp", "Kitchen", "kitchen"),
  room("dining_room", "Phòng ăn", "Dining room", "dining"),
  room("bathroom", "Phòng tắm", "Bathroom", "bathroom"),
  room("home_office", "Phòng làm việc", "Office", "office"),
  room("kids_room", "Phòng trẻ em", "Kids room", "kids"),
  room("lobby", "Sảnh", "Lobby", "lobby"),
  room("other", "Khác", "Other", "other"),
];
