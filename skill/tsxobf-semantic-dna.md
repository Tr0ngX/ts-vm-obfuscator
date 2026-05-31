---
name: tsxobf-semantic-dna
description: Use this skill when designing or implementing metamorphic/polymorphic structures inside the VM compiler and runtime. It enforces complete structural heterogeneity (unique ISA, dispatcher, register architecture, bytecode packing, and handler syntax) per build seed.
---

# TSXobf Semantic DNA VM

Kỹ năng này định nghĩa các nguyên tắc và mô hình kỹ thuật để triển khai kiến trúc **Semantic DNA VM** trên trình ảo hóa TypeScript VM Obfuscator (`TSXobf`).

## Các nguyên lý thiết kế đa hình sinh học (Metamorphic VM Rules)

Khi thiết kế hoặc sửa đổi trình sinh VM, phải tuân thủ nghiêm ngặt các chiều đa hình sau dựa trên `config.seed`:

### 1. Sự đa hình của ISA (Instruction Set Architecture)
- Không lưu bản đồ opcode cố định.
- Xáo trộn bảng ánh xạ opcode ảo (`virtualOp = (canonicalOp + pc + seed) & 0xFF`).
- Xáo trộn danh sách các opcode alias (1-to-N mapping) sao cho mỗi seed chọn một bộ opcode hoàn toàn khác biệt.

### 2. Sự đa hình của Dispatcher (Định tuyến luồng)
- Lựa chọn động cấu trúc định tuyến tại runtime:
  - **Switch-Case đa tầng (Nested Switch)**: Chia opcode thành các bucket (nhóm) ngẫu nhiên.
  - **Indirect Threaded Dispatch**: Handler này trả về con trỏ (hoặc route token) của handler tiếp theo.
  - **Call Chain Network**: Các hàm định tuyến gọi trực tiếp lẫn nhau thông qua trampoline hoặc callback gián tiếp.

### 3. Đa hình kiến trúc lưu trữ thanh ghi (Dynamic Register Model)
- Cấm sử dụng bộ nhớ thanh ghi phẳng (`ctx.regs`) cố định cho mọi build.
- Lựa chọn động cấu hình thanh ghi:
  - **Mảng phẳng ngẫu nhiên tên**: Đổi tên `regs` thành các danh xưng ngẫu nhiên.
  - **Register Bank splitting**: Tách thanh ghi thành các cụm riêng biệt (`ctx.bank_A`, `ctx.bank_B`) chia theo chỉ số chẵn/lẻ của thanh ghi gốc.
  - **Local Variables Binding**: Thay vì lưu trong mảng của đối tượng `ctx`, trích xuất các thanh ghi được sử dụng nhiều nhất thành các biến độc lập cục bộ (`var _reg0, _reg1;`) bên trong hàm đóng gói VM.

### 4. Đa hình cấu trúc Bytecode (Bytecode Serialization Permutation)
- Cơ chế tuần tự hóa nhị phân phải biến thiên hoàn toàn. Thứ tự ghi vào file nhị phân của các trường:
  - Định dạng A: `[MappedOpcode, OperandKind, OperandValue]`
  - Định dạng B: `[OperandValue, MappedOpcode, OperandKind]`
- Hoán vị này phải được tính toán động tại thời điểm đóng gói nhị phân (`encoder.ts`) và giải mã ngược lại tương ứng trong trình VM runtime (`polymorphic-builder.ts`).

---

## Bộ tiêu chí xác thực nghiệm thu (Semantic DNA Acceptance Criteria)

Mọi thay đổi nhằm mục đích thực thi Semantic DNA phải vượt qua:
1. **Kiểm thử ngữ nghĩa (Semantic Parity)**:
   - Hai bản biên dịch từ hai seed khác nhau của cùng một hàm đầu vào phải cho ra kết quả thực thi giống hệt nhau khi so sánh với hàm JS gốc.
2. **Khác biệt hoàn toàn về cấu trúc (Zero Structural Overlap)**:
   - So sánh AST giữa file JS đầu ra của Build 1 và Build 2: Tỷ lệ trùng khớp tên biến, chữ ký hàm, cách ghi bytecode tĩnh và định dạng cấu trúc rẽ nhánh phải thấp hơn 15%.
