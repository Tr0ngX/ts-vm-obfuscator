# Bug Report — TSXobf (ts-vm-obfuscator)

**Date:** 2026-06-23
**Scope:** All packages under `packages/`
**Method:** Systematic multi-agent audit (3 parallel sub-agents)
**Found:** 40+ bugs (15 critical/high, 10 medium, 15 low)

---

## 🔴 CRITICAL — Fix ngay

### C1. Return void dùng `OpCode.Return` với 0 operands → desync
- **File:** `packages/bytecode/src/compiler.ts:300`
- **Code:** `const ops = block.terminator.returnValue ? [...] : [];`
- **Vấn đề:** Khi `returnValue` undefined (void return), emit `OpCode.Return` với mảng `ops` rỗng. Decoder layout quy định `Return: { inputCount: 1 }` → decoder đọc 1 operand không tồn tại → byte stream desync hoàn toàn.
- **Fix:** Dùng `OpCode.ReturnVoid` (đã tồn tại trong enum) khi không có return value.

### C2. Throw void dùng `OpCode.Throw` với 0 operands → desync
- **File:** `packages/bytecode/src/compiler.ts:306`
- **Code:** `const ops = block.terminator.returnValue ? [...] : [];`
- **Vấn đề:** Tương tự C1. `OpCode.Throw` cần 1 operand (`inputCount: 1`) nhưng emit 0 operands.
- **Fix:** Dùng `OpCode.ReturnVoid` (reuse — throw không có value là void) hoặc emit hẳn instruction riêng.

### C3. Electron hardening chạy SAU bytecode compilation → silent no-op
- **File:** `packages/core/src/index.ts:491-503`
- **Code:** Stage 7 modifies `irModules` nhưng bytecode (Stage 5) và VM build (Stage 6) đã xong.
- **Vấn đề:** Mọi thay đổi của Electron hardening vào IR đều không được phản ánh trong output. Không error, không warning — tính năng bảo mật hoàn toàn vô hiệu.
- **Fix:** Move Electron hardening lên trước Stage 5 (bytecode compilation).

### C4. Universal profile `compatibilityFallback = false` (phải là true)
- **File:** `packages/core/src/index.ts:352-354`
- **Code:** `compatibilityFallback: this.options.profile.target === 'universal' ? false : ...`
- **Vấn đề:** Universal profile cần `compatibilityFallback = true` để graceful degradation khi gặp unsupported syntax. Set `false` gây crash.
- **Fix:** `... === 'universal' ? true : ...`

### C5. Anti-debug template string dư `}` → SyntaxError
- **File:** `packages/vm-runtime/src/polymorphic-builder.ts:1312`
- **Code:** Stray `}` ở dòng 1312 không có `{` mở → generated JS bị syntax error khi `config.antiDebug = true`.
- **Fix:** Xoá ký tự `}` dư.

### C6. `Add` handler ternary branch giống hệt nhau — mất obfuscation
- **File:** `packages/vm-runtime/src/polymorphic-builder.ts:932`
- **Code:** Cả 2 nhánh ternary đều dùng `ctx.regs[args[0]] + ctx.regs[args[1]]`
- **Vấn đề:** Sub handler có `__SUB_EXPR__` cho number branch, Add lẽ ra phải có `__ADD_EXPR__` tương ứng. Mất arithmetic obfuscation cho phép cộng.

---

## 🔴 HIGH — Cần sửa

### H1. Shared operand reference mutation — IR module bị corrupt
- **File:** `packages/bytecode/src/compiler.ts:263-271`
- **Code:** `map()` chỉ clone shallow cho Register/ConstantIndex; Immediate/BlockLabel/FunctionRef là shared reference với IR gốc → block label patching mutate IR gốc.
- **Fix:** Clone tất cả operands (ít nhất là deep copy cho value/kind).

### H2. `LoadConst + Add` fusion thiếu commutative case
- **File:** `packages/bytecode/src/compiler.ts:186-208`
- **Code:** Pattern 3 chỉ match khi LoadConst result là **operand[0]** của Add. Add có tính giao hoán, operand[1] cũng có thể là LoadConst result.
- **Fix:** Thêm check cho operand[1].

### H3. Switch/unreachable/dynamic_jmp terminators bị bỏ qua silently
- **File:** `packages/bytecode/src/compiler.ts:284-312`
- **Code:** Chỉ xử lý `jump | branch | return | throw`. Các terminator khác không emit instruction nào → function mất terminator → VM flow sai.
- **Fix:** Thêm handling cho các loại terminator còn lại.

### H4. Disassemble thiếu result register → offset display sai
- **File:** `packages/bytecode/src/decoder.ts:467-469`
- **Code:** `estimateInstructionSize` thiếu `inst.result` push vào ops array → size estimate sai cho mọi instruction có result.
- **Fix:** Push `inst.result` như compiler.ts:419-422.

### H5. RNG state shared → `expectedPathHash` fragile
- **File:** `packages/bytecode/src/compiler.ts:220`
- **Code:** Một `rng` instance dùng cho register shuffling, opcode selection, constant pool shuffling → thêm/bớt function thay đổi toàn bộ sequence → expectedPathHash khác.
- **Fix:** Tạo `rng` riêng cho từng phase.

### H6. Shadow boxed variable thiếu `CellNew` → VM crash
- **File:** `packages/ir/src/builder.ts:1291-1318`
- **Code:** Khi shadow một variable từ parent scope (cùng tên), binding mới cần `CellNew` riêng. Code bỏ qua `CellNew` khi `existing !== undefined`.
- **Fix:** Thêm `CellNew` khi shadow + capture.

### H7. StripDebugPass — `Nop` drop result phá vỡ SSA
- **File:** `packages/transforms/src/passes/strip-debug.ts:48-53`
- **Code:** Set `result: undefined` khi thay bằng Nop → instruction downstream reference register không được định nghĩa.
- **Fix:** Giữ `result` từ instruction gốc.

### H8. ControlFlowFlattening — entry block bị duplicate trong blockOrder
- **File:** `packages/transforms/src/passes/control-flow-flattening.ts:38,76,81,213`
- **Code:** `blockOrder` shuffled chứa cả entry block → entry được xử lý như case block thường → duplicate code path → potential infinite loop.
- **Fix:** Lọc entry block khỏi `blockOrder`.

### H9. FakePath template 0 predicate không guaranteed true
- **File:** `packages/transforms/src/passes/type-level-fake-path.ts:286-417`
- **Code:** Template 0 dùng `LoadGlobal('process')` và `LoadGlobal('window')`. Trong browser, `process` undefined → predicate false → branch đến fake block (Trap) → crash.
- **Fix:** Chỉ dùng template 1+ (dùng `Date.now()`) thay vì template 0 phụ thuộc môi trường.

### H10. `isAsyncFunction` detection sai — generator + name
- **File:** `packages/ir/src/builder.ts:114-119`
- **Code:** Generator function tên 'async' bị coi là async function. Sai logic.
- **Fix:** Bỏ phần `'asteriskToken' in this.node` check khỏi `isAsyncFunction`.

### H11. `decodingKey: 0` không chứa `expectedPathHash`
- **File:** `packages/bytecode/src/encoder.ts:198`
- **Code:** `decodingKey` luôn là 0, không lưu `expectedPathHash` → decoder không áp dụng rollingKeys XOR cho strings.
- **Fix:** Lưu `expectedPathHash` vào `decodingKey`.

### H12. `ctx.regs[args[args.length - 1]]` dùng sai — result register
- **File:** `packages/vm-runtime/src/polymorphic-builder.ts:1079-1080`
- **Code:** `Reflect.construct(ctor, ctorArgs)` thiếu `newTarget` → prototype chain sai khi class inheritance.
- **Fix:** Thêm `ctx.newTarget` vào `Reflect.construct`.

### H13. `process.exit(1)` trước I/O flush
- **File:** `packages/cli/src/cli.ts:139,163`
- **Code:** `process.exit(1)` gọi ngay trong callback, không đợi pending `fs.writeFile` promises → mất output file.
- **Fix:** Dùng `process.exitCode = 1` thay vì `process.exit(1)`.

---

## 🟠 MEDIUM

### M1. Fixed-point iteration thiếu max-iteration guard
- **File:** `packages/bytecode/src/compiler.ts:391-456`
- **Fix:** Thêm counter + break sau N iterations.

### M2. `||` thay `??` cho block offset — silent 0
- **File:** `packages/bytecode/src/compiler.ts:436`
- **Fix:** `??` thay `||` cho `instByteOffset[targetIdx]`.

### M3. Magic number `1` cho ImmediateEncodingScheme
- **File:** `packages/bytecode/src/compiler.ts:443`
- **Fix:** Dùng `ImmediateEncodingScheme.VariableLength`.

### M4. `numToOperandKind` throw không recovery
- **File:** `packages/bytecode/src/decoder.ts:10-25`
- **Fix:** Thêm fallback default.

### M5. `isAsyncFunction` logic sai (H10 merged if same)
- **File:** `packages/ir/src/builder.ts:114-119`

### M6. Unsafe `as ts.Expression` cast
- **File:** `packages/ir/src/builder.ts:1927-1933`
- **Fix:** Type guard đúng.

### M7. StringPoolEncoding dùng pool cũ → duplicate
- **File:** `packages/transforms/src/passes/string-pool-encoding.ts:81`
- **Fix:** Dùng `newConstantPool`.

### M8. Stealth dispatch lookup mapping sai thiết kế
- **File:** `packages/vm-runtime/src/polymorphic-builder.ts:1962-1978`
- **Vấn đề:** `currentHandlerIdx` thay đổi sau mỗi handler nên `(ctrlState + canonicalOp) % 256` không khớp với static mapping.
- **Fix:** Cần redesign dispatch hoặc dùng direct mapping.

### M9. `GetEntropy` handler overflow timestamp precision
- **File:** `packages/vm-runtime/src/polymorphic-builder.ts:1266`
- **Fix:** Giảm multiplier.

---

## 🔵 LOW

### L1. `let regX: any` trong fuseInstructions
- **File:** `packages/bytecode/src/compiler.ts:139`

### L2. `forward` type mismatch với interface
- **File:** `packages/bytecode/src/opcodes.ts:5`

### L3. `isVariableLengthOpcode`/`isTerminator` duplicate 3 lần
- **File:** `encoder.ts:6-34`, `decoder.ts:27-55`, `compiler.ts:83-111`

### L4. `allOperands` state partially mutated trên throw
- **File:** `packages/bytecode/src/decoder.ts:200-220`

### L5. `normalizeExpression` dead code branch
- **File:** `packages/ir/src/builder.ts:1143-1159`

### L6. `nodesTransformed` đếm sai
- **File:** `packages/transforms/src/passes/ir-validation.ts:22`

### L7. `Move` instruction operand order cosmetic
- **File:** `packages/transforms/src/passes/decorator-aware-lowering.ts:44-50`

### L8. Key generation loại bỏ 0, giảm entropy
- **File:** `packages/vm-runtime/src/polymorphic-builder.ts:544-546`

### L9. `resolve` verify dùng `cleanIntrinsics.Promise` không nhất quán
- **File:** `packages/vm-runtime/src/polymorphic-builder.ts:1389`
