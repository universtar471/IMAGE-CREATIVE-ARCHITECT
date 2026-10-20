# Premium Duotone preset UI — bàn giao

## Mục tiêu và phạm vi

Hoàn thiện patch Premium Duotone 2D có sẵn trên `feature/premium-duotone-preset-ui-20261020`, ngay trong thư mục được người dùng chỉ định. Giữ toàn bộ patch chưa commit; không checkout, reset, clone hoặc merge main.

## Đã hoàn thành

- Đưa đủ 38 SVG có sẵn vào bộ icon được kiểm tra bằng kiểu `PremiumIconId`; kiểm tra XML, file thiếu và ánh xạ toàn bộ catalog preset. URL icon dùng Vite BASE_URL.
- Tích hợp icon vào 7 nhóm Shot Presets, WorkspaceNav và VisualIntentSelector; không sửa preset ID hoặc nội dung catalog.
- Đồng bộ gradient, card, button, segmented control, tab, focus, disabled, reduced motion và forced colors.
- Giữ UserPresetsRow, SketchUp Inbox, Generate Simple/Advanced, Publishing và mọi chỉ báo workflow. Tổ hợp đã lưu và tên dài có thể xuống dòng.
- Center Tabs và Bottom Tray hỗ trợ ArrowLeft/ArrowRight/Home/End và chỉ đưa tab hiện hành vào thứ tự Tab.
- Giới hạn chiều rộng hiển thị bảng thuộc tính theo viewport, giữ nguyên giá trị resize đã lưu. Cửa sổ dưới 700px đặt canvas và properties thành hai hàng; sidebar vẫn truy cập được.
- Thanh trên cuộn ngang khi hẹp; Center Tabs cuộn ngang; khay dưới và toolbar có thể xuống hàng. Header workflow/camera không còn ép tiêu đề thành cột chữ.
- Sửa thumbnail ảnh thực tế có kích thước gốc 640px gây tràn: đo trên bảng ánh sáng 364px, scrollWidth trước 875px, sau 364px. Không thay ảnh bằng icon, không sửa các tài nguyên ảnh.
- Giữ Project DNA, ShotIntent, compiler, validation/conflict engine và i18n VI/EN.

## Kiểm tra

- `npm.cmd ci`: thành công, 0 lỗ hổng được npm báo cáo.
- `git diff --check`: đạt.
- `npm.cmd run typecheck`: đạt.
- `npm.cmd run lint`: đạt.
- `npm.cmd test -- --maxWorkers=4`: **90 file, 1.069 test đạt**.
- `npm.cmd run build -w @arch/desktop`: đạt.
- Lệnh `npm.cmd test` mặc định từng đạt 1.069 test; hai vòng sau có timeout 5 giây ở `hhtechModels`, `m2`, `sketchMode`. Chạy lại toàn bộ với 4 worker đạt mà không sửa timeout hoặc test nghiệp vụ. Những vòng cuối chỉ đổi CSS; các test này không import stylesheet. Cần theo dõi độ ổn định khi máy chạy nhiều tiến trình.
- Build có cảnh báo chunk lớn hơn 500 kB, cũng xuất hiện trong lần kiểm tra patch ban đầu. Chưa xử lý chia bundle trong phạm vi UI này.
- Browser preview với mock backend: 640×760, 800×700, 1000×760, 1280×800, 1440×900. Kiểm tra Simple/Advanced, chọn preset, camera, tab bằng bàn phím, Publishing, tiếng Việt/Anh, ảnh ánh sáng thực tế; icon hiển thị không có file lỗi. Đã trả viewport về mặc định.
- Chưa chạy ứng dụng Tauri native hoặc gọi provider tạo ảnh thật.

## Preview

Ảnh trước là trạng thái patch ban đầu, không phải main. Ảnh sau có thêm lựa chọn Giờ vàng của dự án QA cục bộ.

| Preview | File |
| --- | --- |
| Trước, 1000px | [before-1000.jpg](../design/premium-duotone/before-1000.jpg) |
| Sau, 1000px | [after-1000.jpg](../design/premium-duotone/after-1000.jpg) |
| Preset active, 1280px | [presets-1280.jpg](../design/premium-duotone/presets-1280.jpg) |
| Ảnh ánh sáng và tiếng Anh, 1440px | [lighting-photos-en-1440.jpg](../design/premium-duotone/lighting-photos-en-1440.jpg) |

## Cạm bẫy

- PowerShell chặn npm.ps1 theo execution policy; dùng npm.cmd, không sửa cài đặt bảo mật.
- Cần quyền phù hợp cho npm cache, GitHub CLI config và thao tác ghi .git trong môi trường sandbox.
- Các SVG ở public dùng img riêng nên ID gradient bên trong không va chạm. Ảnh preview hover dùng lazy loading nên ảnh ẩn chưa tải là bình thường.
- Không merge main; PR dành cho bước duyệt tiếp theo.
