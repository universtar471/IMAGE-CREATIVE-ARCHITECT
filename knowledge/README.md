# Knowledge Packs

Read-only configuration bundles, one per `knowledge/<project_type>/<subtype>/pack.json`.
They are bundled into the desktop app at build time and validated by
`KnowledgePackSchema` (`packages/domain/src/knowledge/pack.ts`).

- Packs are data, not code.
- `default` is the fallback subtype of each project type; `custom/default` is the global fallback.
- Pack values are suggestions. New projects persist the resolved DNA, so editing a pack
  later never changes existing projects.
- `cameraPresets` (4–7 per pack, at least 2 `anchorRecommended`) seed the Camera module;
  azimuth 0 = facing the front facade, positive = toward the viewer's left.
- Bump `packVersion` whenever a pack changes.
