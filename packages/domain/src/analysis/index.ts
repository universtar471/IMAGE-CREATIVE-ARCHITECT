/**
 * Evidence analysis board (M4, ADR-042). A vision model returns structured JSON about one
 * image; the app draws the board itself as SVG, so every word is sharp and nothing is a number
 * the model painted into pixels. Everything on the board is labelled as inferred from the
 * image: no measurements, scores or certifications are shown as facts.
 */
import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max);

export const ANALYSIS_CONFIDENCE = ["low", "medium", "high"] as const;

export const ImageAnalysisSchema = z.object({
  materials: z
    .array(
      z.object({
        name: text(60),
        location: text(80),
        confidence: z.enum(ANALYSIS_CONFIDENCE),
      }),
    )
    .max(8)
    .default([]),
  palette: z
    .array(z.object({ hex: z.string().regex(/^#[0-9a-fA-F]{6}$/), name: text(40) }))
    .max(6)
    .default([]),
  composition: z
    .object({
      viewpoint: text(120).optional(),
      lighting: text(120).optional(),
      focus: text(120).optional(),
    })
    .default({}),
  observations: z.array(text(160)).max(5).default([]),
});
export type ImageAnalysis = z.infer<typeof ImageAnalysisSchema>;

/**
 * System prompt of the analysis call (the app's own wording). The instructions stay English;
 * the findings are written in the UI language because they are shown, not sent to a model.
 */
const ANALYSIS_PROMPT_TEMPLATE = `You describe one architectural image for a design team.
Answer with one JSON object only, no markdown, with exactly these keys:
{"materials":[{"name":string,"location":string,"confidence":"low"|"medium"|"high"}],
 "palette":[{"hex":"#RRGGBB","name":string}],
 "composition":{"viewpoint":string,"lighting":string,"focus":string},
 "observations":[string]}
Rules:
- Describe only what is visible in the image. Do not guess hidden parts, dimensions, prices, brands, standards or performance (acoustics, energy, structure).
- At most 8 materials, 6 palette colours and 5 short observations, written in {language}.
- "confidence" is how clearly the material can be seen, not a quality score.
- No numbers except the hex colours.`;

export function analysisSystemPrompt(language: "English" | "Vietnamese" = "English"): string {
  return ANALYSIS_PROMPT_TEMPLATE.replace("{language}", language);
}

export const ANALYSIS_SYSTEM_PROMPT = analysisSystemPrompt();

export type AnalysisParseResult =
  { ok: true; analysis: ImageAnalysis } | { ok: false; reason: "not_json" | "invalid" };

/** Parses the model's reply; tolerates a ```json fence and drops nothing silently. */
export function parseImageAnalysis(raw: string): AnalysisParseResult {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "")
    .trim();
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return { ok: false, reason: "not_json" };
  }
  const parsed = ImageAnalysisSchema.safeParse(value);
  return parsed.success ? { ok: true, analysis: parsed.data } : { ok: false, reason: "invalid" };
}

// ---------------------------------------------------------------- board (SVG)

export type AnalysisBoardLabels = {
  title: string;
  inferred: string;
  materials: string;
  palette: string;
  composition: string;
  viewpoint: string;
  lighting: string;
  focus: string;
  observations: string;
  confidence: Record<(typeof ANALYSIS_CONFIDENCE)[number], string>;
  footer: string;
};

export const ANALYSIS_BOARD_SIZE = { width: 1600, height: 1000 } as const;

const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Greedy word wrap by character count (the board uses one fixed font size per block). */
export function wrapText(value: string, maxChars: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of value.split(/\s+/).filter(Boolean)) {
    if (!line) line = word;
    else if (line.length + 1 + word.length <= maxChars) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * The board: the image on the left, the inferred findings on the right. `imageHref` is a URL
 * the renderer can load (a data URL when rasterising). Deterministic for identical input.
 */
export function analysisBoardSvg(
  analysis: ImageAnalysis,
  imageHref: string,
  labels: AnalysisBoardLabels,
): string {
  const { width, height } = ANALYSIS_BOARD_SIZE;
  const x = 960;
  let y = 70;
  const out: string[] = [];
  const line = (value: string, size: number, opts: { bold?: boolean; color?: string } = {}) => {
    out.push(
      `<text x="${x}" y="${y}" font-size="${size}" fill="${opts.color ?? "#1f2933"}"${opts.bold ? ' font-weight="700"' : ""}>${escapeXml(value)}</text>`,
    );
    y += Math.round(size * 1.45);
  };
  const heading = (value: string) => {
    y += 14;
    line(value.toUpperCase(), 17, { bold: true, color: "#52606d" });
  };
  const wrapped = (value: string, size = 19, chars = 54) => {
    for (const part of wrapText(value, chars)) line(part, size);
  };

  line(labels.title, 34, { bold: true });
  line(labels.inferred, 17, { color: "#b45309" });

  if (analysis.materials.length) {
    heading(labels.materials);
    for (const m of analysis.materials)
      wrapped(`• ${m.name} — ${m.location} (${labels.confidence[m.confidence]})`);
  }
  if (analysis.palette.length) {
    heading(labels.palette);
    analysis.palette.forEach((c, i) => {
      const sx = x + i * 100;
      out.push(
        `<rect x="${sx}" y="${y - 6}" width="84" height="56" rx="6" fill="${c.hex}" stroke="#cbd2d9"/>`,
        `<text x="${sx}" y="${y + 72}" font-size="14" fill="#1f2933">${escapeXml(c.name)}</text>`,
        `<text x="${sx}" y="${y + 90}" font-size="13" fill="#7b8794">${c.hex.toUpperCase()}</text>`,
      );
    });
    y += 112;
  }
  const comp = analysis.composition;
  if (comp.viewpoint || comp.lighting || comp.focus) {
    heading(labels.composition);
    if (comp.viewpoint) wrapped(`${labels.viewpoint}: ${comp.viewpoint}`);
    if (comp.lighting) wrapped(`${labels.lighting}: ${comp.lighting}`);
    if (comp.focus) wrapped(`${labels.focus}: ${comp.focus}`);
  }
  if (analysis.observations.length) {
    heading(labels.observations);
    for (const o of analysis.observations) wrapped(`• ${o}`);
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Inter, Segoe UI, Arial, sans-serif">`,
    `<rect width="${width}" height="${height}" fill="#ffffff"/>`,
    `<rect x="40" y="40" width="880" height="${height - 80}" rx="10" fill="#f0f2f5"/>`,
    `<image x="40" y="40" width="880" height="${height - 80}" preserveAspectRatio="xMidYMid meet" href="${escapeXml(imageHref)}"/>`,
    ...out,
    `<text x="${x}" y="${height - 40}" font-size="14" fill="#7b8794">${escapeXml(labels.footer)}</text>`,
    `</svg>`,
  ].join("\n");
}
