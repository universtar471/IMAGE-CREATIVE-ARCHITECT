import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { featherMask, rasterizeMask } from "./mask";
import type { RegionShape } from "./schemas";

type VectorDefinition = {
  name: string;
  width: number;
  height: number;
  shapes: RegionShape[];
  featherRadiusPx?: number;
};

const definitions: VectorDefinition[] = [
  {
    name: "rect_pixel_centres",
    width: 16,
    height: 12,
    shapes: [{ type: "rect", x: 0.125, y: 0.25, w: 0.5, h: 0.5 }],
  },
  {
    name: "concave_polygon",
    width: 16,
    height: 12,
    shapes: [
      {
        type: "polygon",
        points: [
          [0.1, 0.1],
          [0.9, 0.1],
          [0.9, 0.4],
          [0.45, 0.4],
          [0.45, 0.9],
          [0.1, 0.9],
        ],
      },
    ],
  },
  {
    name: "self_intersecting_polygon_even_odd",
    width: 16,
    height: 12,
    shapes: [
      {
        type: "polygon",
        points: [
          [0.15, 0.15],
          [0.85, 0.85],
          [0.85, 0.15],
          [0.15, 0.85],
        ],
      },
    ],
  },
  {
    name: "brush_two_strokes",
    width: 33,
    height: 20,
    shapes: [
      {
        type: "brush",
        strokes: [
          {
            points: [
              [0.1, 0.25],
              [0.45, 0.25],
              [0.55, 0.45],
            ],
            radius: 0.055,
          },
          {
            points: [
              [0.2, 0.8],
              [0.8, 0.65],
            ],
            radius: 0.08,
          },
        ],
      },
    ],
  },
  {
    name: "union_all_shapes",
    width: 16,
    height: 12,
    shapes: [
      { type: "rect", x: 0.05, y: 0.1, w: 0.3, h: 0.35 },
      {
        type: "polygon",
        points: [
          [0.55, 0.1],
          [0.95, 0.35],
          [0.6, 0.55],
        ],
      },
      {
        type: "brush",
        strokes: [
          {
            points: [
              [0.2, 0.75],
              [0.8, 0.75],
            ],
            radius: 0.06,
          },
        ],
      },
    ],
  },
  {
    name: "feather_radius_2",
    width: 16,
    height: 12,
    shapes: [{ type: "rect", x: 0.25, y: 0.25, w: 0.5, h: 0.5 }],
    featherRadiusPx: 2,
  },
];

const vectors = definitions.map(({ featherRadiusPx, ...definition }) => {
  const mask = rasterizeMask(definition.shapes, definition.width, definition.height);
  return {
    ...definition,
    mask: Array.from(mask),
    ...(featherRadiusPx === undefined
      ? {}
      : {
          feather: {
            radiusPx: featherRadiusPx,
            output: Array.from(
              featherMask(mask, definition.width, definition.height, featherRadiusPx),
            ),
          },
        }),
  };
});

const target =
  process.argv[2] ?? fileURLToPath(new URL("../../test-vectors/masks.json", import.meta.url));
writeFileSync(target, `${JSON.stringify(vectors, null, 2)}\n`);
console.log(`wrote ${target}`);
