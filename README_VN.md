<p align="center">
  <img src="assets/logo.png" alt="TSXobf Logo" width="200px" />
</p>

# 🛡️ TSXobf — Trình Làm Rối Mã Nguồn TypeScript Dựa Trên Máy Ảo (Semantic-Aware VM Obfuscator)

> **Hệ thống ảo hóa mã nguồn thế hệ mới** giúp bảo vệ tuyệt đối các logic nghiệp vụ quan trọng trong hệ sinh thái TypeScript và JavaScript.

---
🌐 **Ngôn ngữ:** [English (Tiếng Anh)](README.md) | [Tiếng Việt](README_VN.md)
---

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/Language-TypeScript-blue.svg)](https://www.typescriptlang.org/)
[![Architecture](https://img.shields.io/badge/Architecture-Register--Based%20VM-orange.svg)]()

Khác với các công cụ làm rối (obfuscator) truyền thống vốn phụ thuộc vào các phép biến đổi AST dễ bị đảo ngược (như đổi tên biến, tiêm mã chết hay làm phẳng dòng điều khiển cơ bản), **TSXobf** giới thiệu một **Compiler Backend** chuyên nghiệp. Trình biên dịch này dịch các thuật toán TypeScript của bạn thành mã bytecode tùy chỉnh và thực thi chúng bên trong một **Máy ảo đa hình (Polymorphic VM)** được ngẫu nhiên hóa động theo từng phiên build.

---

## 💎 Điểm Khác Biệt Công Nghệ: Obfuscator Truyền Thống vs. TSXobf

| Tiêu Chí Bảo Mật | Obfuscator Truyền Thống (ví dụ: `javascript-obfuscator`, `js-confuser`) | TSXobf (Semantic VM Obfuscator) |
| :--- | :--- | :--- |
| **Cơ Chế Bảo Vệ Chính** | Xáo trộn từ vựng, mã hóa chuỗi thô, làm phẳng khối lệnh. | **Ảo hóa mã nguồn (Virtualization)** — biên dịch logic thành chỉ thị máy ảo nhị phân. |
| **Khả Năng Kháng Trình Giải Mã** | Rất yếu trước các công cụ phân tích AST tự động (như `webcrack`, `ArachneJS`). | **Miễn dịch thực tế**; kẻ tấn công bắt buộc phải viết trình phân tích giải mã riêng cho từng file build. |
| **Khôi Phục Logic Tĩnh** | Chuỗi và luồng thực thi dễ dàng bị khôi phục qua phương pháp thực thi ký hiệu (symbolic execution). | Chỉ để lộ mảng byte nhị phân động; toàn bộ logic thuật toán được ẩn giấu sâu bên trong trình thông dịch VM. |
| **Ảnh Hưởng Hiệu Năng** | Gây sụt giảm hiệu năng toàn cục do lồng quá nhiều hàm bọc (wrappers). | **Tối ưu hóa cục bộ**; chỉ những hàm quan trọng được ảo hóa, mã nguồn còn lại chạy với 100% tốc độ gốc. |
| **Tính Đa Hình Của Mã Nguồn** | Sinh ra các cấu trúc mã giống nhau giữa các lần biên dịch khác nhau. | **Thay đổi sơ đồ lệnh (Opcode) và cách phân bổ thanh ghi** ngẫu nhiên sau mỗi lần biên dịch. |

---

## 📐 Kiến Trúc Hệ Thống

TSXobf hoạt động giống như một compiler backend. Nó tiếp nhận mã nguồn TypeScript, biên dịch các hàm mục tiêu thành dạng **Biểu diễn Trung gian (IR)** dựa trên thanh ghi, áp dụng các bước biến đổi bảo mật nâng cao và đóng gói chúng cùng trình thông dịch JS siêu nhẹ.

```mermaid
graph TD

    A["⚡ Nguồn TypeScript"] -->|"TS Compiler API"| B["🔍 Phân Tích Cú Pháp AST"]
    B -->|"Bộ lọc @virtualize"| C["🧠 Register-Based IR"]

    subgraph T["Transforms Pipeline"]
        direction TB
        T1["📦 Trích Xuất Constant Pool"]
        T2["🎲 Ngẫu Nhiên Hóa Opcode"]
        T3["🧬 Biến Đổi Dòng Điều Khiển"]
    end
    
    C --> T1
    T1 --> T2
    T2 --> T3

    T3 -->|"Assembler"| G["💾 Bytecode Nhị Phân"]
    G -->|"Polymorphic Packaging"| H["📁 Production JS Bundle"]

    subgraph R["VM Execution Runtime"]
        direction TB
        R1["🔐 Mã Hóa Constant Pool"]
        R2["⚙️ Máy Ảo Đa Hình (Interpreter)"]
    end
    
    H -->|"Lazy Decode"| R1
    H -->|"Dispatch Loop"| R2
    
    R1 --> K["🧩 Giá Trị Runtime"]
    R2 --> K

    K -->|"Semantic Output"| L["✅ Kết Quả Đồng Nhất Ngữ Nghĩa"]
```

---

## 🚀 Các Tính Năng Nổi Bật

> [!IMPORTANT]
> **Nhận Biết Ngữ Nghĩa (Semantic-Aware):**
> TSXobf không chỉnh sửa mã nguồn một cách mù quáng. Nó phân tích mã thông qua **TypeScript Compiler API** chính thức, cho phép giải quyết chính xác các liên kết export/import module, tầm vực biến (scope), kiểu dữ liệu và các lệnh gọi thư viện phụ thuộc trong quá trình ảo hóa.

*   **🎭 Máy Ảo Đa Hình Luồng (Polymorphic VM Runtime - Threaded Dispatch)**
    Thay vì sử dụng vòng lặp thông dịch `switch-case` thông thường, TSXobf tạo ra cơ chế thực thi **Threaded Dispatch**. Các chỉ thị VM ánh xạ trực tiếp đến một mảng các hàm xử lý (handler) được tạo ngẫu nhiên. Các opcode chưa được ánh xạ sẽ chứa các **bẫy bảo mật tự vệ (self-defending integrity traps)** nhằm lập tức làm sập các công cụ dịch ngược (decompiler).
*   **🎲 Ánh Xạ Biệt Danh Opcode 1-to-N & Xáo Trộn**
    Để đối phó với phân tích thống kê tần suất byte và bộ giải mã chữ ký tự động, một chỉ thị VM gốc (ví dụ: `LoadConst`) sẽ được ánh xạ vào **nhiều mã opcode ảo khác nhau** (1-to-N). Sơ đồ ánh xạ opcode và bố cục các hàm xử lý hoàn toàn được xáo trộn ngẫu nhiên sau mỗi lần biên dịch.
*   **🔑 Mã Hóa Bytecode Với Khóa Xoay Vòng (Rolling XOR Key)**
    Các opcode chỉ thị và giá trị toán hạng tức thời được mã hóa ngay trên luồng bytecode. Máy ảo sẽ giải mã động các byte này khi đang chạy nhờ một khóa XOR xoay vòng (rolling key) tự động biến đổi sau mỗi chỉ thị, làm cho cùng một chỉ thị gốc có các biểu diễn byte khác nhau xuyên suốt chương trình.
*   **🔒 Giải Mã XOR JIT & Kiểm Tra Toàn Vẹn Lazy Constant Pool**
    Tất cả các chuỗi, hằng số số học và tra cứu thuộc tính được trích xuất vào một vùng chứa hằng số (constant pool) được mã hóa. Việc giải mã được thực hiện một cách lười (lazy - chỉ khi thực sự cần thiết) bằng hạt giống phiên (session seed) ngẫu nhiên, tích hợp kiểm tra toàn vẹn bộ nhớ chống dump dữ liệu.
*   **🎯 Bảo Vệ Chọn Lọc Qua JSDoc**
    Bạn không cần phải đánh đổi hiệu năng. Chỉ bảo vệ tài sản trí tuệ quan trọng (như hàm xác thực bản quyền, xử lý mật mã, API nhạy cảm) bằng cách chú thích `/** @virtualize */` ngay trên hàm mục tiêu, giữ nguyên 100% tốc độ native cho các mã nguồn UI hoặc framework thông thường.
*   **📦 Đóng Gói Không Phụ Thuộc (Zero-Dependency)**
    Sản phẩm biên dịch cuối cùng hoàn toàn độc lập. Nó tạo ra một file JavaScript thuần gọn nhẹ chạy được ở mọi môi trường: Trình duyệt hiện đại, Node.js, Electron, Cloudflare Workers, hay AWS Lambda.

---

## 🔎 Minh Họa Mã Nguồn Trước/Sau Làm Rối

### 1. Mã Nguồn TypeScript Gốc (`src/index.ts`)
```typescript
/** @virtualize */
export function calculateSecretHash(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}
```

### 2. Mã JavaScript Sau Khi Làm Rối (`dist/build.js`)
Thuật toán của bạn giờ đây đã được chuyển hóa thành một khối dữ liệu nhị phân mã hóa chạy trên bộ vi xử lý ảo tùy chỉnh:

```javascript
const vmFunctions = (function() {
  const seed = 1779526130061;
  
  // Vùng Hằng Số Được Mã Hóa Với Cơ Chế Giải Mã Lười (Lazy Decryption)
  const rawCP = [{"index":0,"kind":"number","value":0},{"index":1,"kind":"string","value":"áèãêùå"}];
  const cpCache = [];
  function getCP(idx) {
    if (cpCache[idx] !== undefined) return cpCache[idx];
    const c = rawCP[idx];
    let val = c.kind === 'string' ? decrypt(c.value, seed) : c.value;
    cpCache[idx] = val;
    return val;
  }

  // Mảng Các Hàm Xử Lý Opcode Đa Hình 1-to-N
  const handlers = new Array(256).fill(h_trap);
  function h_105(ctx) { /* LoadConst Handler */ }
  function h_47(ctx) { /* Move Handler */ }
  function h_55(ctx) { /* Add Handler */ }
  function h_trap(ctx) { throw new Error("VM Integrity Violation"); }
  
  // Xáo Trộn Opcode Động (Ánh xạ biệt danh 1-to-N)
  handlers[105] = h_105;
  handlers[212] = h_105; // ánh xạ biệt danh 1-to-N
  handlers[47] = h_47;
  handlers[188] = h_55;

  // Trình Thông Dịch Máy Ảo Đa Hình
  function createExecutor(bytecodeArr) {
    return function execute(...fnArgs) {
      const ctx = {
        regs: new Array(256).fill(undefined),
        pc: 0,
        bytecode: bytecodeArr,
        globalScope: typeof globalThis !== 'undefined' ? globalThis : {},
        running: true,
        rollingKey: seed & 0xFF
      };
      
      // Nạp các đối số vào thanh ghi ảo
      for (let i = 0; i < fnArgs.length; i++) ctx.regs[i] = fnArgs[i];

      // Vòng lặp Threaded Dispatch giải mã XOR xoay vòng động
      while(ctx.running && ctx.pc < ctx.bytecode.length) {
        let op = ctx.bytecode[ctx.pc++];
        op ^= ctx.rollingKey;
        ctx.rollingKey = (ctx.rollingKey + op) & 0xFF;
        handlers[op](ctx);
      }
      return ctx.returnValue;
    };
  }

  var result = {};
  // Toàn bộ logic thuật toán gốc giờ chỉ còn là một mảng byte nhị phân được mã hóa tuyến tính
  result['calculateSecretHash'] = createExecutor(new Uint8Array([73,122,89,14,244,11,8,90,201...]));
  return result;
})();
```

---

## ⚡ Hướng Dẫn Nhanh

### Yêu Cầu Hệ Thống
*   Node.js (>= 18)
*   `pnpm` (Khuyên dùng cho monorepo)

### 1. Cài Đặt & Biên Dịch Trình Làm Rối
```bash
# Clone dự án từ GitHub
git clone https://github.com/yourusername/TSXobf.git
cd TSXobf

# Cài đặt các thư viện phụ thuộc
pnpm install

# Build tất cả các package trong monorepo
pnpm build
```

### 2. Chạy Trình Làm Rối CLI
Cung cấp file cấu hình TypeScript của dự án mục tiêu để tiến hành làm rối:
```bash
node packages/cli/dist/cli.js -p examples/basic-ts/tsconfig.json --out dist-obf
```
File JavaScript đã bảo vệ sẽ được sinh ra trong thư mục `dist-obf/` với tên file định dạng: `build_<session_id>.js`.

### 3. Chạy Thử Nghiệm Kiểm Tra Lỗi
Chạy kịch bản kiểm thử tích hợp để tự động so sánh tính đồng nhất ngữ nghĩa giữa hàm ảo hóa chạy trên VM và hàm gốc:
```bash
node test-pipeline.js
```

> [!TIP]
> **Tùy Biến Nâng Cao:**
> Bạn có thể tinh chỉnh các luật biến đổi mã, cơ chế mã hóa constant pool và cách dịch chỉ thị bytecode trực tiếp tại các thư mục `packages/transforms/` và `packages/bytecode/`.

---

## 🛠️ Chi Tiết Các Gói Thành Phần

Hệ sinh thái TSXobf được chia nhỏ thành các gói dịch vụ độc lập trong monorepo:

*   **`packages/ir`**: Tổng hợp sơ đồ điều khiển và xây dựng cấu trúc Biểu diễn Trung gian (IR) dựa trên thanh ghi từ các khối cây AST.
*   **`packages/transforms`**: Lớp bảo mật. Thực hiện trích xuất hằng số, mã hóa chuỗi dữ liệu, đổi tên ký hiệu và sinh tập lệnh opcode ngẫu nhiên.
*   **`packages/bytecode`**: Trình biên dịch mã máy. Chuyển đổi cấu trúc IR sang dạng mảng byte nhị phân tuyến tính.
*   **`packages/vm-runtime`**: Đóng gói mã nguồn. Tích hợp bytecode nhị phân vào lõi trình thông dịch VM đa hình động.
*   **`packages/cli`**: Giao diện dòng lệnh giúp kết nối các bước biên dịch và tối ưu hóa quy trình làm việc.

---

## 🛡️ Bản Quyền

Dự án được phân phối dưới giấy phép MIT License - xem file [LICENSE](LICENSE) để biết thêm chi tiết.
