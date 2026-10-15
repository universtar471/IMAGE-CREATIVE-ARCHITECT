import type { GradeLookId } from "../schemas/future";

/** Descriptors are display metadata only; all grading uses the deterministic pixel pipeline. */
export type GradeLookCategory = "natural" | "warm" | "cool" | "editorial" | "cinematic" | "special";
export type GradeLookDescriptor = {
  id: GradeLookId;
  category: GradeLookCategory;
  labelVi: string;
  labelEn: string;
  descriptionVi: string;
  descriptionEn: string;
};

export const GRADE_LOOK_CATALOG: readonly GradeLookDescriptor[] = [
  { id: "neutral", category: "natural", labelVi: "Nguyên bản", labelEn: "Original", descriptionVi: "Không thay đổi màu ảnh", descriptionEn: "No colour adjustment" },
  { id: "daylight_clean", category: "natural", labelVi: "Ánh sáng ban ngày", labelEn: "Clean Daylight", descriptionVi: "Cân bằng sáng tự nhiên, giữ vật liệu", descriptionEn: "Balanced daylight and believable surfaces" },
  { id: "true_white", category: "natural", labelVi: "Trắng trung tính", labelEn: "True White", descriptionVi: "Không gian sáng, trắng tự nhiên", descriptionEn: "Neutral whites without a heavy tint" },
  { id: "balanced_realism", category: "natural", labelVi: "Chân thực cân bằng", labelEn: "Balanced Realism", descriptionVi: "Tăng chiều sâu nhẹ và giữ chi tiết", descriptionEn: "Controlled depth and natural contrast" },
  { id: "clear_architecture", category: "natural", labelVi: "Kiến trúc rõ nét", labelEn: "Clear Architecture", descriptionVi: "Nhấn đường nét và vật liệu", descriptionEn: "Defined architectural edges and textures" },
  { id: "warm_tropical", category: "warm", labelVi: "Nhiệt đới ấm", labelEn: "Warm Tropical", descriptionVi: "Nắng ấm, màu xanh tươi", descriptionEn: "Warm sunshine and vibrant tropical tones" },
  { id: "golden_hour_soft", category: "warm", labelVi: "Nắng chiều dịu", labelEn: "Soft Golden Hour", descriptionVi: "Vàng ấm tinh tế, tương phản nhẹ", descriptionEn: "Soft golden warmth and gentle highlights" },
  { id: "warm_minimal", category: "warm", labelVi: "Be tối giản", labelEn: "Warm Minimal", descriptionVi: "Kem be nhẹ, độ bão hòa thấp", descriptionEn: "Cream and beige, subdued colours" },
  { id: "amber_lifestyle", category: "warm", labelVi: "Hổ phách đời sống", labelEn: "Amber Lifestyle", descriptionVi: "Không khí sống ấm cúng", descriptionEn: "Inviting amber-toned atmosphere" },
  { id: "earthy_residential", category: "warm", labelVi: "Đất mộc tự nhiên", labelEn: "Earthy Residential", descriptionVi: "Trầm mộc, nâu và sắc đất", descriptionEn: "Earthy, understated residential tones" },
  { id: "cool_modern", category: "cool", labelVi: "Hiện đại lạnh", labelEn: "Cool Modern", descriptionVi: "Xanh lạnh, chi tiết rõ", descriptionEn: "Crisp cool modern architecture" },
  { id: "nordic_daylight", category: "cool", labelVi: "Bắc Âu sáng", labelEn: "Nordic Daylight", descriptionVi: "Trắng sáng, bóng mềm, sắc lạnh nhẹ", descriptionEn: "Airy Nordic whites and soft shadows" },
  { id: "steel_blue", category: "cool", labelVi: "Thép xanh", labelEn: "Steel Blue", descriptionVi: "Tương phản mạnh, sắc xanh thép", descriptionEn: "Steel-blue shadows and crisp contrast" },
  { id: "coastal_air", category: "cool", labelVi: "Ven biển thoáng", labelEn: "Coastal Air", descriptionVi: "Sáng thoáng, thiên xanh dịu", descriptionEn: "Airy coastal blues and gentle contrast" },
  { id: "clean_concrete", category: "cool", labelVi: "Bê tông hiện đại", labelEn: "Clean Concrete", descriptionVi: "Đường nét mạnh, sắc trung tính", descriptionEn: "Neutral concrete, structured contrast" },
  { id: "soft_editorial", category: "editorial", labelVi: "Biên tập dịu", labelEn: "Soft Editorial", descriptionVi: "Mềm mại, sáng nhẹ như tạp chí", descriptionEn: "Soft low-contrast editorial finish" },
  { id: "bright_magazine", category: "editorial", labelVi: "Tạp chí sáng", labelEn: "Bright Magazine", descriptionVi: "Ảnh sáng rõ, phù hợp hồ sơ", descriptionEn: "Bright professional magazine look" },
  { id: "muted_luxury", category: "editorial", labelVi: "Sang trọng trầm", labelEn: "Muted Luxury", descriptionVi: "Màu tinh tế, ít bão hòa", descriptionEn: "Understated luxury and subdued colour" },
  { id: "matte_film", category: "editorial", labelVi: "Phim lì cổ điển", labelEn: "Matte Film", descriptionVi: "Đen nâng nhẹ, ánh sáng mềm", descriptionEn: "Lifted blacks and analogue-inspired softness" },
  { id: "pastel_architecture", category: "editorial", labelVi: "Pastel kiến trúc", labelEn: "Pastel Architecture", descriptionVi: "Nhẹ và sáng, ít tương phản", descriptionEn: "Airy muted pastels and soft detail" },
  { id: "gallery_white", category: "editorial", labelVi: "Triển lãm trắng", labelEn: "Gallery White", descriptionVi: "Nền sáng, nhấn cấu trúc", descriptionEn: "Bright gallery-ready tonal balance" },
  { id: "cinematic_dusk", category: "cinematic", labelVi: "Điện ảnh chạng vạng", labelEn: "Cinematic Dusk", descriptionVi: "Sắc trời tối, tương phản rõ", descriptionEn: "Cinematic twilight contrast" },
  { id: "blue_hour_premium", category: "cinematic", labelVi: "Giờ xanh cao cấp", labelEn: "Premium Blue Hour", descriptionVi: "Màu xanh chiều tối có chiều sâu", descriptionEn: "Deep blue-hour tones and clear highlights" },
  { id: "moody_contrast", category: "cinematic", labelVi: "Tương phản cảm xúc", labelEn: "Moody Contrast", descriptionVi: "Vùng tối đậm, nhấn vật liệu", descriptionEn: "Rich shadows and dramatic texture" },
  { id: "dusk_amber", category: "cinematic", labelVi: "Chạng vạng ấm", labelEn: "Amber Dusk", descriptionVi: "Ánh chiều ấm, vùng tối dịu", descriptionEn: "Amber warmth with restrained deep shadows" },
  { id: "urban_noir", category: "cinematic", labelVi: "Đô thị Noir", labelEn: "Urban Noir", descriptionVi: "Trầm mạnh, lạnh, chất điện ảnh", descriptionEn: "Dark cool urban cinematic finish" },
  { id: "heritage_film", category: "special", labelVi: "Di sản cổ điển", labelEn: "Heritage Film", descriptionVi: "Màu phim cũ cho nhà cổ", descriptionEn: "Subtle vintage heritage appearance" },
  { id: "mediterranean_sun", category: "special", labelVi: "Nắng Địa Trung Hải", labelEn: "Mediterranean Sun", descriptionVi: "Nắng tươi, vật liệu sáng", descriptionEn: "Sunlit stone, lively clear colours" },
  { id: "forest_retreat", category: "special", labelVi: "Nghỉ dưỡng rừng", labelEn: "Forest Retreat", descriptionVi: "Bóng mềm, xanh dịu và tự nhiên", descriptionEn: "Soft green natural retreat tones" },
  { id: "hotel_premium", category: "special", labelVi: "Khách sạn cao cấp", labelEn: "Premium Hotel", descriptionVi: "Trầm ấm, phản xạ và độ sâu", descriptionEn: "Warm premium hospitality tonal balance" },
] as const;
