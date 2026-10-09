import { GRADE_LOOKS, type ColorGradeDNA } from "@arch/domain";

export { GRADE_LOOKS, applyGradePixel, applyGradeToImageData } from "@arch/domain";
export type { ColorGradeDNA } from "@arch/domain";

/** UI convenience for creating a fresh neutral grade without mutating the shared look. */
export const neutralGrade = (): ColorGradeDNA => ({ ...GRADE_LOOKS.neutral });
