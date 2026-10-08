# wt/p3-domain

- Agent: claude
- Tách từ: wt/p3-base
- Brief: `docs/agent-tasks/p3-domain.md` (P3-B)

## Mục tiêu

Domain Phase 3: camera presets trong knowledge packs, helper camera, compiler `pc-1.1.0`
(camera section + anchor reference), batch builders; sửa test domain vỡ do contract base.
Thêm: sửa review `docs/agent-reviews/p2-ui.md` PHẢI SỬA 1 (validation aspect/size).

## Đã xong (commit theo thứ tự)

1. `Domain tests: GenerationDTO fixtures match the Phase 3 contract`
2. `Knowledge packs: camera presets for every pack` — 10 pack, 4–7 preset, mỗi pack ≥ 2
   `anchorRecommended`; `packVersion` → `1.1.0`; `KnowledgeRegistry.cameraPresets(type, subtype)`;
   `CAMERA_VIEW_TYPE_LABELS`.
3. `Domain: camera ids, camera helpers, readiness and validation`
4. `Generation validation: empty ratio/size list only accepts null` (review p2-ui #1)
5. `Prompt compiler pc-1.1.0: camera section and anchor references`
6. `Domain: anchor and production batch builders`

## API cho UI (tất cả export từ `@arch/domain`)

```ts
// ids.ts
newCameraId(): string                                  // "CAM_" + ULID, monotonic
createUlidGenerator(random?, now?): () => string
newUlid(): string
// camera/cameras.ts
uniqueCameraName(base: string, existingNames: readonly string[]): string
cameraFromPreset(preset: CameraPreset, existingNames?: readonly string[], id?: string): CameraDNA
blankCamera(existingNames?: readonly string[], id?: string): CameraDNA
duplicateCamera(camera: CameraDNA, existingNames?: readonly string[], id?: string): CameraDNA
findCamera(dna: Pick<ProjectDNA,"cameras">, cameraId: string | null | undefined): CameraDNA | undefined
anchorViews(dna: Pick<ProjectDNA,"cameras">): CameraDNA[]
cameraHasViewpoint(camera: CameraDNA): boolean
cameraReadiness(camera: CameraDNA): ReadinessItem[]    // per camera: azimuthDeg, elevationDeg, distanceM, lensMm
cameraWorkflowReadiness(dna, state?: { masterApproved?: boolean; anchors?: { cameraId }[] }): ReadinessItem[]
// invariants/dna.ts
validateCamera(candidate: unknown, otherCameras?: { id; name }[]): { ok: true; camera } | { ok: false; fieldErrors }
validateProjectDNA(...)                                // nay chặn trùng id / trùng tên camera
ReadinessItem.detail?: string                          // field mới, optional
// camera/describe.ts
azimuthWords(deg), elevationWords(cam), viewpointWords(cam), lensWords(mm),
cameraSectionText(cam), normalizeAzimuth(deg), isInteriorViewType(t)
// knowledge
registry.cameraPresets(projectType, subtype?): CameraPreset[]
CAMERA_VIEW_TYPE_LABELS
// compiler
PromptCompileInput.cameraId?: string | null
PromptReference.isAnchor?: boolean
sortReferences(refs)                                   // master → anchor → role order
// generation/batch.ts
type BatchAsset = ReferenceCandidate & { originalName?: string | null }
type BatchBuildInput = { project; dna; pack?; assets; masterAssetId: string | null;
                         model: ModelCapabilities; params: GenerationParams; extraReferenceIds? }
buildAnchorBatchItems(input: BatchBuildInput): BatchItem[]
buildProductionBatchItems(input, cameraIds: readonly string[], anchors: { cameraId; assetId }[]): BatchItem[]
paramsForCamera(params, camera, model): GenerationParams
MAX_BATCH_ITEMS = 50
```

Hình dạng `BatchBuildInput` khớp stub `apps/desktop/src/lib/cameraDomain.ts` bên `wt/p3-ui`
(chỉ `originalName` thành optional). Khi merge: bỏ stub, thay `compileCameraPrompt` →
`compilePrompt`, `orderCameraReferences` → `sortReferences`, `FALLBACK_CAMERA_PRESETS` →
`registry.cameraPresets(...)` (pack nào cũng có preset).

## Quyết định (chỗ brief mơ hồ)

- **Quy ước azimuth:** 0 = nhìn thẳng mặt tiền; dương = quay theo chiều kim đồng hồ nhìn từ
  trên, mặt tiền ở đáy mặt bằng ⇒ về phía TRÁI người xem. `+45` = front-left, `-45` =
  front-right, `±180` = phía sau. Khớp stub UI. Ghi trong `camera/describe.ts`.
- Camera nội thất: không mô tả azimuth trong prompt và không đòi azimuth trong
  `cameraReadiness` (phòng không có "mặt tiền"). Preset nội thất không có azimuth.
- Ống kính detail: 50 mm (ngoại thất) / 35 mm (nội thất) — ngoài dải 24–35 / 16–24 của
  brief vì đó là ống cho cảnh rộng; test chỉ áp dải cho view không phải detail.
- Chiều cao nội thất 1.5 m (1.2 m cho góc ngồi sofa); aerial 30–35°, heightM = d·sin(elev).
- `cameraReadiness` là per-camera (đúng stub UI); kiểm tra cấp project (≥1 camera, ≥1 anchor
  view, master approved, mọi anchor view đã có anchor) là `cameraWorkflowReadiness`.
- `validateProjectDNA` chặn trùng id camera và trùng tên (không phân biệt hoa thường). Không
  đưa vào Zod schema để JSON Schema export không đổi (Rust không cần).
- `duplicateCamera` bỏ cờ anchor view (copy cờ sẽ âm thầm thêm một anchor bắt buộc).
- Compiler: `cameraId` không tồn tại ⇒ không có camera section, `metadata.cameraId = null`.
  Không có section context ⇒ camera đứng ngay sau section trước đó (thứ tự cố định).
  `locks.camera` chỉ thêm dòng preservation khi đang render một camera.
  Metadata mới: `cameraId`, `anchorImage` (số thứ tự Image hoặc null), `locks.camera`.
- Anchor reference có `role: master_architecture` vẫn là master (bỏ cờ anchor).
- Builders: item theo thứ tự camera trong DNA (không theo thứ tự `cameraIds`) để
  deterministic. Cap 1 ⇒ chỉ gửi master. Extra không tồn tại/trùng/role master bị bỏ;
  extra chưa `ready` KHÔNG bị bỏ âm thầm (để `validateGenerationRequest` báo).
  Anchor có asset không nằm trong `assets` ⇒ bỏ qua. Aspect của camera chỉ thắng khi model
  có trong `aspectRatios`; model danh sách rỗng giữ giá trị dialog (UI nên đặt `null`).
  Builder không tự cắt 50 item — UI kiểm `items.length <= MAX_BATCH_ITEMS`.
- Không đổi DNA schema ⇒ `schema:export` không tạo diff.

## Còn nợ / cho agent khác

- `docs/ARCHITECTURE.md` §7 vẫn ghi "camera (future)" — không thuộc phạm vi file của tôi.
- P3-C: mock backend cũng phải từ chối aspect/size khác null khi danh sách rỗng (review p2-ui #1).
- Desktop typecheck/test vẫn đỏ đúng như base (cùng 21 lỗi TS ở `apps/desktop`, không thêm).

## Lệnh test

```
npx vitest run --project domain      # 111 test xanh
npm run typecheck -w @arch/domain
npm run lint
npx prettier --check packages knowledge
```

## Cạm bẫy đã gặp

- `Uint8Array` generic của TS 6: `crypto.getRandomValues` cần `Uint8Array<ArrayBuffer>`.
- Heredoc Git Bash dài + chuỗi có `\n` dễ hỏng; ghi script Python ra file rồi chạy.
