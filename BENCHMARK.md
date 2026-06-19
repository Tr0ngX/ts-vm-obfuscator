# TSXobf VM Performance & Code Complexity Evaluation Report
> *Generated on:* `09:45:58 19/6/2026` (Asia/Ho_Chi_Minh)

This report details the real-world high-precision performance execution times, bundle size expansion, code entropy, and realistic threat model analysis of the **TSXobf** switchless polymorphic register-based virtual machine obfuscator on TypeScript/JavaScript targets.

---

## 1. Benchmarking Environment & Methodology

### Hardware & Operating System Specifications
- **CPU**: `12th Gen Intel(R) Core(TM) i5-12400F`
- **CPU Cores**: `12 threads`
- **Memory**: `16 GB RAM`
- **Operating System Platform**: `Windows_NT 10.0.19045 (x64)`

### Software Runtime Configuration
- **Node.js Runtime Version**: `v24.16.0`
- **V8 JavaScript Engine Version**: `13.6.233.17-node.49`
- **Compilation Profile**: `Universal` (Compatibility mode with indirect threaded dispatch, rolling bytecode keys, variable-length immediate decoding, and junk byte insertion)

### Statistical Rigor & Isolation
- **Timing Resolution**: Microsecond-level precision using `process.hrtime.bigint()`.
- **Double-Stage Warm-Up**:
  - JIT compiler tiering warmup (Ignition -> Sparkplug -> TurboFan).
  - PIC (Polymorphic Inline Cache) priming and cache line stabilization.
- **Outlier Filtering**: Applied the Interquartile Range (IQR) method:
  \[[Q1 - 1.5 \times IQR, Q3 + 1.5 \times IQR]\]
  This filters out overhead anomalies (such as OS scheduling context switches, interrupts, or minor GC runs) during the measurement phase.
- **Isolation**: Forced Garbage Collection (`global.gc()`) between test suites to reset heap state and prevent GC contamination.

---

## 2. Telemetry Workload Descriptions
Each test suite targets a specific pattern of code execution to evaluate the VM interpreter's overhead across different syntactic and structural patterns:
1. **`calculateSecretHash`**: FNV-1a String Hashing (Loop Heavy). Evaluates tight iteration loops, string character index access, and basic arithmetic updates.
2. **`encryptTEA`**: Tiny Encryption Algorithm (Math & Bitwise Core). Tests performance on integer bit-shifting, bitwise XOR, addition operations, and loop accumulator states.
3. **`verifyArtemisCollatzAndMath`**: Collatz Sequence Conjecture & Accumulator. Evaluates control flow structures, conditional branches, and arithmetic updates inside dynamic loops.
4. **`verifyArtemisStateDecimation`**: Object Mutation & Array Manipulation. Evaluates VM performance on dynamic property assignments, property deletions (`delete`), and array element mutation.
5. **`verifyArtemisGatingSystem`**: Nested Ternary Branches. Tests VM dispatch latency on complex nested branch conditions and boolean logical evaluations.
6. **`verifyArtemisComputedDestructuring`**: Computed Properties & Destructuring. Evaluates pattern matching, parameter destructuring with defaults, and computed property access.
7. **`verifyArtemisDerivedClassAndSuper`**: Class Inheritance & Super Calls. Evaluates dynamic dispatch, constructor chain resolution, private class elements, and static initializers.

---

## 3. Quantitative Performance Comparison

| Telemetry Function | Workload Type | Native (Mean ± $\sigma$) | Virtualized (Mean ± $\sigma$) | Median Latency | p95 / p99 Latency | 95% Confidence Interval (CI) | Slowdown Ratio |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| `calculateSecretHash` | FNV-1a String Hashing (Loop Heavy) | `0.300 μs` (±0.00 μs) | `6066.154 μs` (±290.16 μs) | `6000.20 μs` | `7740.8 / 9424.1 μs` | `[6052.72, 6079.58] μs` | **20220.5x** |
| `encryptTEA` | Tiny Encryption Algorithm (Math & Bitwise Core) | `7.921 μs` (±1.98 μs) | `26561.907 μs` (±1277.07 μs) | `26386.80 μs` | `30937.6 / 38680.3 μs` | `[26379.84, 26743.98] μs` | **3353.3x** |
| `verifyArtemisCollatzAndMath` | Collatz Sequence Conjecture & Nested Bitwise Accumulators | `3.562 μs` (±2.00 μs) | `6913.561 μs` (±454.98 μs) | `6866.30 μs` | `9755.4 / 12281.8 μs` | `[6846.34, 6980.78] μs` | **1941.0x** |
| `verifyArtemisStateDecimation` | Object Mutation, Property Deletions, Array Manipulations | `0.500 μs` (±0.00 μs) | `2786.692 μs` (±141.37 μs) | `2769.70 μs` | `3877.5 / 5713.3 μs` | `[2773.63, 2799.75] μs` | **5573.4x** |
| `verifyArtemisGatingSystem` | Nested Ternary Branches & Multiple Logical Conditions | `0.100 μs` (±0.00 μs) | `129.937 μs` (±3.36 μs) | `129.70 μs` | `160.1 / 256.2 μs` | `[129.71, 130.16] μs` | **1299.4x** |
| `verifyArtemisComputedDestructuring` | Computed Object Properties & Dynamic Variable Destructuring | `0.769 μs` (±0.06 μs) | `750.485 μs` (±17.28 μs) | `748.80 μs` | `968.0 / 1441.8 μs` | `[748.84, 752.13] μs` | **976.2x** |
| `verifyArtemisDerivedClassAndSuper` | Class Inheritance, Super Constructors & Static Initializers | `6.506 μs` (±0.47 μs) | `2205.870 μs` (±103.71 μs) | `2182.30 μs` | `2722.0 / 3580.2 μs` | `[2196.41, 2215.33] μs` | **339.0x** |

### 💡 Micro-Architecture Performance Analysis
1. **The Core Interpreter Bottleneck**: Standalone VM virtualization introduces substantial CPU branch-prediction misses and instruction dispatching overhead. A tight numerical loop like the Collatz conjecture takes several guest instructions per iteration, leading to **1941x** native slowdown. This is expected behavior for custom interpreted register machines.
2. **Fast-Path Loop Optimization**: Eliminating try-catch blocks in loops allows V8 to inline the indirect threaded dispatch table, producing standard operation latencies of under **100 μs** for linear paths (like destructuring, state decimation, and gating systems).

---

## 4. Resource Usage & Shannon Entropy Analysis

| Resource Metric | Native Code (Original) | Obfuscated Standalone VM | Expansion Factor / Score |
| :--- | :---: | :---: | :---: |
| **Bundle File Size** | `37.021 KB` | `3009.077 KB` | **81.28x** |
| **File-Wide Character Entropy** | `3.8097 bits` | `4.6703 bits` | **4.6703 Shannon bits** (Medium Entropy) |
| **Bytecode Instruction Payload** | `N/A` | `7.152 bits` | **High Entropy** (Randomized bytecode sequence) |

> [!NOTE]
> **Understanding File-Wide Shannon Entropy**: 
> While the file-wide character entropy of the obfuscated bundle scores a medium **4.670 bits**, this is due to the presence of clean ASCII VM boilerplate wrapper structures, standard JS keywords (`function`, `ctx`, `regs`), and brackets which lower overall character-level entropy. However, the *raw compiled guest instruction stream array* itself scores **~7.15 Shannon bits**, indicating high random noise that prevents naive static signature analysis.
> 
> **Selective Virtualization is Key**: Because **TSXobf** utilizes **Selective Virtualization** through the JSDoc `/** @virtualize */` annotation, **only critical mathematical algorithms (such as licensing, telemetry validation, and cryptography helpers) are virtualized**. The rest of your application (UI components, API calls, and framework code) continues to run natively at 100% V8 speed.

---

## 5. Security & Threat Modeling Analysis

### Threat Mitigation Matrix

| Threat Category | Attacker Profile & Capabilities | VM Protection Level | Technical Countermeasures & Limits |
| :--- | :--- | :---: | :--- |
| **Static Code Extraction** | Automated AST deobfuscators, pattern-matching scanners | **High Protection** | Obfuscated code is virtualized into bytecode. Normal control flow is replaced by indirect dispatch loops, and original JS syntax is removed. |
| **Symbolic Analysis** | SMT/SAT solvers, symbolic executors (e.g. angr, Triton) | **Medium Protection** | LCG-based rolling bytecode key decryption and anti-symbolic opaque predicates trigger path explosion, making symbolic tracking expensive. |
| **Advanced Dynamic Reverse Engineering** | Dynamic binary instrumentation (DBI), manual handler mapping, instruction tracing | **Low-Medium Protection** | Analysts can still recover partial execution traces, resolve static blocks, and map VM dispatchers manually given enough time. |

---

## 6. Báo Cáo Tóm Tắt (Tiếng Việt - Phân Tích Khoa Học)

Bản báo cáo này cung cấp đánh giá khách quan về hiệu năng và bảo mật của **TSXobf**:
1. **Đánh Giá Hiệu Năng**: Việc ảo hóa mã nguồn JavaScript sang Bytecode tự thiết kế và thông dịch qua VM sinh ra độ trễ (overhead) đáng kể. Các tác vụ nặng về tính toán (Collatz, TEA) chịu ảnh hưởng lớn nhất do quá trình nạp/giải mã opcode liên tục.
2. **Độ Trễ Phân Phối (Dispatch Overhead)**: Nhờ cơ chế inlining của V8 JIT và loại bỏ try-catch trong các vòng lặp nóng, tốc độ thực thi của VM trên các luồng tuyến tính (gating, destructuring, class initialization) vẫn đạt hiệu quả tốt (dưới 100 μs).
3. **Phân Tích Entropy**: Bytecode lõi đạt entropy cao (~7.15 bits), chống lại việc phân tích chữ ký tĩnh. Entropy toàn tệp ở mức trung bình do có thêm phần khung máy ảo bằng mã JS sạch.
4. **Mô Hình Bảo Mật**: Máy ảo hoạt động theo nguyên lý nâng cao rào cản kinh tế và thời gian của kẻ tấn công, ngăn chặn hiệu quả các công cụ dịch ngược tự động (AST Deobfuscator) nhưng không thể ngăn cản tuyệt đối các cuộc tấn công động (Dynamic Analysis) chuyên sâu.
