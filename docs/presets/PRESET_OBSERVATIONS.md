# Ghi đặc tính preset và so sánh A/B

Mục đích: học **chức năng** của preset VizMaker để cải thiện preset của app (`packages/domain/src/presets/catalog.ts`).

**Ranh giới (ADR-039):**
- Được dùng VizMaker như người dùng bình thường: xem, chạy thử, đọc kết quả.
- **Không** dán nguyên văn prompt của VizMaker vào file này hay vào repo.
- Chỉ ghi điều bạn **quan sát** được.

## 1. Bảng đặc tính (mỗi preset một dòng)

| Preset VizMaker | Nhóm app | Đổi gì | Giữ gì | Đầu vào hợp | Điểm mạnh quan sát | Lỗi hay gặp | Engine / tỉ lệ |
|---|---|---|---|---|---|---|---|
| Golden hour (ví dụ) | time_light | Nắng thấp ấm, bóng dài, trời cam nhạt | Hình học, góc máy, vật liệu | Ảnh ngoại thất đã render | Giữ khung cửa tốt, ánh hắt tường đẹp | Đôi khi đổi màu vật liệu, thêm cây | Nano Banana 2, 16:9 |
| | | | | | | | |

Nên ghi khoảng 20–30 preset đáng giá nhất: View to render, Add realism, Night, Golden hour, Rain, Drone view, Moodboard, Clean up, Artificial light…

## 2. Bộ ảnh nguồn chuẩn

Dùng 3–5 ảnh và giữ cố định giữa các vòng:
1. viewport SketchUp ngoại thất nhà phố;
2. ảnh render ngoại thất biệt thự;
3. nội thất phòng khách;
4. (tuỳ chọn) phác thảo nét;
5. (tuỳ chọn) ảnh chụp hiện trạng.

## 3. Phiếu chấm A/B (1–5 điểm)

| Ảnh nguồn | Preset | App | Hình học (cửa, cột, số tầng) | Vật liệu | Độ thật ánh sáng | Lỗi lạ (vật thể mọc thêm, chữ rác) | Đúng ý preset | Ghi chú |
|---|---|---|---|---|---|---|---|---|
| | | VizMaker | | | | | | |
| | | Arch AI Studio | | | | | | |

**Cách chạy một vòng:**
- Chạy ở độ phân giải 1K để rẻ.
- Mỗi vòng khoảng 20–30 preset × 3 ảnh × 2 app, tức 120–180 ảnh.

**Sau mỗi vòng:**
- Preset nào dưới 3,5 điểm trung bình thì sửa `promptEn` hoặc `keepEn` trong catalog.
- Tăng `PRESET_CATALOG_VERSION` khi sửa.
- Chạy lại đúng các ô đã chấm.
