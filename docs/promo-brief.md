# TSXobf — AI Promotion Script

> Dùng cho AI agent khi cần quảng bá, giới thiệu, hoặc viết nội dung marketing cho dự án TSXobf.

---

## 1. Tổng Quan (Elevator Pitch)

TSXobf là **trình biên dịch mã nguồn TypeScript thành bytecode máy ảo đa hình** — không phải obfuscator AST truyền thống. Thay vì làm rối cây cú pháp, nó biên dịch hàm TypeScript thành bytecode tùy chỉnh và chạy trong Polymorphic Virtual Machine. Kẻ tấn công không thể reverse engineer logic gốc vì đơn giản là **không có mã gốc trong bundle**.

## 2. Đối Tượng Mục Tiêu

| Nhóm | Nỗi đau | Giải pháp TSXobf |
|---|---|---|
| **SaaS / License Server** | Logic tính phí, check license bị crack | Bytecode VM không thể đọc được |
| **Fintech / Crypto** | Thuật toán giao dịch, wallet, signature bị dịch ngược | VM đa hình + rolling bytecode chống memory dump |
| **Game Dev (Anti-Cheat)** | Client-side logic, matchmaking, loot tables | Ảo hóa chọn lọc, không ảnh hưởng performance UI |
| **ISV / Bảo vệ IP** | Algorithm trade secret bị steal bởi competitor | Không có source code trong binary, chỉ có bytecode VM |
| **React Native / Electron Apps** | Cần bảo vệ logic mà vẫn giữ native performance | Selective virtualization + profile tự động (React, Electron) |

## 3. USP (Unique Selling Points) — Dùng làm góc tấn công marketing

### 3.1. "We compile, not scramble"
Obfuscator AST (JS-Confuser, Jscrambler) chỉ xáo trộn cấu trúc — vẫn có thể reverse engineer bằng cách trace execution. TSXobf compile hàm TypeScript thành bytecode VM — mã gốc **không tồn tại** trong output.

### 3.2. True Polymorphism
Mỗi lần build sinh ra opcode mapping, handler dispatch, và constant pool **hoàn toàn khác**. Deobfuscator viết cho bundle này vô dụng với bundle khác.

### 3.3. TypeScript-First
Tích hợp TypeScript Compiler API — hiểu types, imports, class hierarchy, scopes. Không cần cấu hình thủ công để "làm việc với TypeScript".

### 3.4. Selective Virtualization
`/** @virtualize */` chỉ ảo hóa hàm quan trọng. UI (React, Vue) chạy 100% native speed.

### 3.5. Self-Modifying Bytecode
Khi bật rolling keys, bytecode tự biến đổi sau mỗi opcode fetch. Memory dump thấy bytecode đã bị mutate, nhưng VM vẫn recover chính xác qua Shadow XOR Mask Buffer.

### 3.6. Anti-Symbolic Fake Paths
Trap-backed opaque predicates ở cấp độ VM — symbolic execution không thể phân tích.

## 4. Competitive Positioning

| Tiêu chí | TSXobf | JS-Confuser | Jscrambler |
|---|---|---|---|
| Loại bảo vệ | Bytecode VM (mã gốc biến mất) | AST transform | Bytecode VM (proprietary) |
| TypeScript semantics | ✅ TS Compiler API | ❌ | ❌ |
| Polymorphism | ✅ Mỗi build khác nhau | ❌ | ⚠️ Proprietary |
| Open source | ✅ MIT | ✅ MIT | ❌ $1000+/tháng |
| Selective | ✅ JSDoc annotation | ❌ | ⚠️ Partial |
| Self-modifying code | ✅ LCG rolling XOR | ❌ | ❌ |
| Anti-debug / Tamper check | ✅ Indirect dispatch, intrinsic snapshot, trap | ⚠️ Cơ bản | ⚠️ Cơ bản |

### Key message: *"Battle-tested VM obfuscation with TypeScript intelligence, at open-source cost."*

## 5. Use Case Scenarios

### 5.1. Bảo vệ License Key Check
```typescript
/** @virtualize */
export function validateLicense(key: string): boolean {
  const decoded = base64Decode(key);
  return verifySignature(decoded, PUBLIC_KEY);
}
```
Sau obfuscation: không ai biết thuật toán verify là gì.

### 5.2. Bảo vệ Logic Thanh Toán
```typescript
/** @virtualize */
export function calculatePrice(items: CartItem[], coupon?: string): number {
  let total = 0;
  for (const item of items) {
    total += applyTierPricing(item);
  }
  if (coupon) total = applyDiscount(total, coupon);
  return Math.max(0, total);
}
```

### 5.3. Bảo vệ Crypto Helper
```typescript
/** @virtualize */
export function signMessage(privateKey: Uint8Array, message: string): string {
  // Thuật toán ký không thể bị trích xuất
}
```

## 6. Promotional Angles

### Góc #1: "Bảo vệ IP nghiêm túc"
> "Nếu bạn đang bán source code license mà dùng obfuscator AST, bạn đang tự lừa mình. Kẻ crack chỉ cần trace execution flow là ra. TSXobf compile code của bạn thành bytecode — không còn source để trace."

### Góc #2: "Open-source mà mạnh như enterprise"
> "Jscrambler tính $1000/tháng. JS-Confuser miễn phí nhưng chỉ là AST transform. TSXobf miễn phí, open-source (MIT), mà dùng VM obfuscation ngang hàng enterprise."

### Góc #3: "TypeScript Devs First"
> "Bạn viết TypeScript? TSXobf hiểu TypeScript của bạn. Import, type, class, async/await — tất cả được phân tích qua TS Compiler API. Không cần workaround."

### Góc #4: "Selective = Zero Performance Hit"
> "Không như giải pháp whole-program VM, TSXobf chỉ ảo hóa hàm bạn đánh dấu. React component, event handler, framework code — chạy native 100%."

### Góc #5: "Chống Memory Dump"
> "Hack chụp memory dump để tìm execution pattern? Với rolling bytecode, mỗi lần fetch opcode bị XOR corrupt. Memory dump thấy garbage, chỉ VM mới có xorLog để recover."

## 7. Tone & Voice

- **Professional**: Dùng cho technical blog, LinkedIn, docs
- **Direct/No-BS**: Dùng cho Reddit, Hacker News, Dev.to
- **Vietnamese**: Dùng cho cộng đồng DEV Vietnam, FB groups

### Ví dụ tone technical (English):
> "TSXobf is a semantic-aware TypeScript-to-bytecode compiler that replaces function bodies with custom VM bytecode at build time. It uses indirect threaded dispatch, polymorphic opcode aliasing, and optional LCG rolling self-modification to defeat static and dynamic analysis."

### Ví dụ tone direct (English):
> "Other obfuscators just shuffle your code around. TSXobf makes your code *disappear* — compiled into bytecode that only a polymorphic VM can execute. Open source, TypeScript-native, and actually effective."

### Ví dụ tone Vietnamese:
> "Obfuscator AST thường chỉ xào nấu code cho rối. TSXobf biên dịch TypeScript thành bytecode — mã gốc không còn tồn tại trong file output. Mỗi lần build sinh ra VM khác nhau. Anti-crack thực sự."

## 8. Hashtags & Keywords SEO

**English**: #TypeScript #CodeObfuscation #VMObfuscation #SoftwareSecurity #ReverseEngineering #AntiTamper #SourceCodeProtection #OpenSourceSecurity #JSConfuser #JscramblerAlternative

**Vietnamese**: #BảoVệCode #TypeScript #Obfuscation #MãNguồnMở #BảoMậtPhầnMềm #ChốngDịchNgược #VMBytecode #DEVVietnam

## 9. Call-to-Action Templates

### GitHub Star:
> "⭐ Star on GitHub: https://github.com/philleyquattro317-arch/ts-vm-obfuscator"

### Try it:
> "```bash
> npx @tsvm/cli -p tsconfig.json --out dist-obf
> ```"

### Benchmark:
> "📊 See the full benchmark suite: [BENCHMARK.md](../BENCHMARK.md)"

### Contribute:
> "🤝 Open source (MIT). Contributions welcome: check `CONTRIBUTING.md`"

## 10. Kịch Bản Mẫu Cho AI

Khi được yêu cầu "quảng bá TSXobf", AI nên:

1. **Xác định ngữ cảnh**: Technical hay non-technical? English hay Vietnamese? Reddit hay LinkedIn?
2. **Chọn góc tấn công**: Từ mục 6, chọn 1-2 angles phù hợp nhất.
3. **Chọn tone**: Từ mục 7.
4. **Chèn CTA**: Từ mục 9.
5. **Thêm hashtags**: Từ mục 8.

Ví dụ output cho Hacker News (English, direct tone, Angle #2):

> "TSXobf is an open-source TypeScript VM obfuscator that actually *compiles* your functions into bytecode — not just scrambling AST like JS-Confuser. Each build generates a unique opcode mapping, polymorphic handlers, and optional self-modifying bytecode. Selective `@virtualize` keeps your UI at native speed. MIT license.
>
> ```bash
> npx @tsvm/cli -p tsconfig.json --out dist-obf
> ```
>
> https://github.com/philleyquattro317-arch/ts-vm-obfuscator"

Ví dụ output cho Facebook DEV Vietnam (Vietnamese, Angle #4 + #5):

> "Mới push fix bug namespace virtualization trên TSXobf — 115 tests pass. Dự án obfuscator TypeScript open-source biên dịch code thành bytecode VM. Chọn lọc từng hàm bằng `/** @virtualize */`. Rolling bytecode chống memory dump. MIT license.
>
> ```bash
> npx @tsvm/cli -p tsconfig.json --out dist-obf
> ```
>
> Star trên GitHub nếu thấy hữu ích ⭐"

---

*Maintained by project contributors. Update this file when new features land.*
