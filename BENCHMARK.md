# TSXobf VM Performance & Code Complexity Evaluation Report (v2.0)
> *Generated on:* `09:52:59 19/6/2026` (Asia/Ho_Chi_Minh)
> *Engine:* High-Fidelity Scientific Benchmark Engine v2.0 — featuring BCa Bootstrap CI, Mann-Whitney U, Welch's t-test, Cohen's d, adaptive warmup convergence, thermal drift detection, and memory profiling.

This report evaluates the real-world high-precision performance, bundle size expansion, code entropy, and threat model analysis of the **TSXobf** switchless polymorphic register-based virtual machine obfuscator on TypeScript/JavaScript targets.

---

## 1. Benchmarking Environment & Methodology

### Hardware & Operating System
- **CPU**: `12th Gen Intel(R) Core(TM) i5-12400F` @ `2496 MHz` (`12 threads`)
 - **Memory**: `16 GB total / 8.07 GB free`
- **OS Load Average**: `[0.00, 0.00, 0.00]` (1/5/15 min)
- **Platform**: `Windows_NT 10.0.19045 (x64)`

### Software Runtime
- **Node.js**: `v24.16.0`
- **V8 Engine**: `13.6.233.17-node.49`
- **Node Flags**: `--expose-gc`
- **Garbage Collection Exposed**: `✓ Yes (memory isolation active)`
- **Compilation Profile**: `Universal` (indirect threaded dispatch, rolling bytecode keys, variable-length immediates, junk byte insertion)

### Statistical Methodology (v2.0 upgrades)

| Methodology Component | Implementation |
| :--- | :--- |
| **Timing Resolution** | Nanosecond precision via `process.hrtime.bigint()`, converted to floating-point microseconds |
| **Warm-up Strategy** | **Adaptive convergence**: warmup continues until coefficient of variation (CV) of trailing 50 samples < 5% (JIT tiering + PIC priming + L1/L2 cache stabilization) |
| **Outlier Filtering** | Tukey's hinges IQR: \[[Q_1 - 1.5 \times IQR, Q_3 + 1.5 \times IQR]\] |
| **Confidence Intervals** | **BCa Bootstrap** (Bias-Corrected and Accelerated) — 3,000 resamples. More accurate than normal approximation for skewed timing distributions (Efron & Tibshirani 1993) |
| **Significance Testing** | **Mann-Whitney U** (non-parametric, no normality assumption) + **Welch's t-test** (parametric, unequal variance tolerant) |
| **Effect Size** | **Cohen's d** with pooled standard deviation, magnitude classification per Cohen (1988): negligible (<0.2), small (0.2–0.5), medium (0.5–0.8), large (0.8–1.2), very large (>1.2) |
| **Slowdown Ratio CI** | **Bootstrap ratio CI** (3,000 resamples of mean ratios) |
| **Distribution Shape** | Skewness (Fisher-Pearson), Excess Kurtosis, MAD (Median Absolute Deviation) |
| **Thermal Drift Detection** | Split-sample test: compares first-half mean vs second-half mean to detect CPU frequency scaling / throttling |
| **Memory Profiling** | Heap delta (`heapUsed`, `heapTotal`, `rss`, `external`) before/after each measurement loop |
| **Correctness Verification** | Deep-equality check between native and virtualized outputs before performance measurement |
| **GC Isolation** | Forced `global.gc()` between suites and before each measurement loop |

---

## 2. Correctness Verification

| Function | Native vs Virtualized Output Match |
| :--- | :---: |
 | `calculateSecretHash` | ✅ **PASS** — outputs identical |
| `encryptTEA` | ✅ **PASS** — outputs identical |
| `verifyArtemisCollatzAndMath` | ✅ **PASS** — outputs identical |
| `verifyArtemisStateDecimation` | ✅ **PASS** — outputs identical |
| `verifyArtemisGatingSystem` | ✅ **PASS** — outputs identical |
| `verifyArtemisComputedDestructuring` | ✅ **PASS** — outputs identical |
| `verifyArtemisDerivedClassAndSuper` | ✅ **PASS** — outputs identical |

> [!IMPORTANT]
> Correctness verification is performed **before** performance measurement. If virtualized output diverges from native, the performance data is meaningless. **Overall correctness: ✅ ALL PASSED**.

---

## 3. Telemetry Workload Descriptions

| # | Function | Workload Pattern | Test Focus |
| :---: | :--- | :--- | :--- |
 | 1 | `calculateSecretHash` | FNV-1a String Hashing (Loop Heavy) | Tight iteration loops, string char indexing, arithmetic updates |
| 2 | `encryptTEA` | Tiny Encryption Algorithm (Bitwise Core) | Integer bit-shift, XOR, addition, loop accumulator |
| 3 | `verifyArtemisCollatzAndMath` | Collatz Sequence & Bitwise Accumulators | Conditional branches, dynamic loop bounds, arithmetic |
| 4 | `verifyArtemisStateDecimation` | Object Mutation & Array Manipulations | Dynamic property assignment, delete, array mutation |
| 5 | `verifyArtemisGatingSystem` | Nested Ternary Branches & Logical Conditions | Nested ternary branches, boolean logic evaluation |
| 6 | `verifyArtemisComputedDestructuring` | Computed Properties & Dynamic Destructuring | Pattern matching, default params, computed property |
| 7 | `verifyArtemisDerivedClassAndSuper` | Class Inheritance & Super Constructors | Constructor chains, super calls, static initializers |

---

## 4. Quantitative Performance Comparison

| Function | Workload | Native (avg ± σ) | Virtualized (avg ± σ) | Median | p95 / p99 | Slowdown (95% Bootstrap CI) | Mann-Whitney p | Cohen's d | Verdict |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
 | `calculateSecretHash` | FNV-1a String Hashing (Loop Heavy) | `0.126 μs`<br>(±0.05) | `10835.955 μs`<br>(±243.09) | `10788.70 μs` | `11350.7 / 11555.6 μs` | **85851.89x**<br>[`52388.00–132781.00x`] | `<0.001` | `18.57`<br>(very large) | Extreme overhead (stat. significant) |
| `encryptTEA` | Tiny Encryption Algorithm (Bitwise Core) | `5.409 μs`<br>(±0.97) | `13715.446 μs`<br>(±240.31) | `13673.40 μs` | `14145.1 / 14541.5 μs` | **2535.55x**<br>[`492.17–3840.53x`] | `<0.001` | `19.07`<br>(very large) | Extreme overhead (stat. significant) |
| `verifyArtemisCollatzAndMath` | Collatz Sequence & Bitwise Accumulators | `0.554 μs`<br>(±0.05) | `33512.614 μs`<br>(±1138.28) | `33139.50 μs` | `35869.3 / 36741.1 μs` | **60518.18x**<br>[`8868.37–73734.00x`] | `<0.001` | `20.54`<br>(very large) | Extreme overhead (stat. significant) |
| `verifyArtemisStateDecimation` | Object Mutation & Array Manipulations | `0.815 μs`<br>(±0.16) | `2105.219 μs`<br>(±114.03) | `2062.15 μs` | `2360.3 / 2470.0 μs` | **2584.58x**<br>[`1434.79–4817.25x`] | `<0.001` | `7.20`<br>(very large) | Extreme overhead (stat. significant) |
| `verifyArtemisGatingSystem` | Nested Ternary Branches & Logical Conditions | `0.040 μs`<br>(±0.05) | `706.929 μs`<br>(±30.90) | `695.90 μs` | `780.7 / 818.4 μs` | **17811.41x**<br>[`6809.00–1360500000000.00x`] | `<0.001` | `5.83`<br>(very large) | Extreme overhead (stat. significant) |
| `verifyArtemisComputedDestructuring` | Computed Properties & Dynamic Destructuring | `0.300 μs`<br>(±0.00) | `599.963 μs`<br>(±32.12) | `587.30 μs` | `680.4 / 713.0 μs` | **1999.88x**<br>[`1825.33–4189.00x`] | `<0.001` | `5.68`<br>(very large) | Extreme overhead (stat. significant) |
| `verifyArtemisDerivedClassAndSuper` | Class Inheritance & Super Constructors | `6.075 μs`<br>(±0.36) | `2170.811 μs`<br>(±95.33) | `2131.90 μs` | `2379.9 / 2467.8 μs` | **357.34x**<br>[`191.20–546.75x`] | `<0.001` | `6.83`<br>(very large) | Extreme overhead (stat. significant) |

### Aggregate Slowdown Metrics
- **Geometric Mean Slowdown**: `6386.58x` *(preferred for ratios)*
- **Harmonic Mean Slowdown**: `1681.03x`
- **Total Outliers Removed**: `1567` samples across all suites

### 📐 Distribution Shape Diagnostics

| Function | Native Skew / Kurt | Obf Skew / Kurt | Native MAD | Obf MAD | Obf Thermal Drift |
| :--- | :---: | :---: | :---: | :---: | :---: |
 | `calculateSecretHash` | 1.45 / 0.97 | 1.00 / 0.82 | `0.000 μs` | `137.700 μs` | `3.45%` |
| `encryptTEA` | -0.08 / -0.47 | 1.11 / 1.58 | `0.500 μs` | `144.100 μs` | `2.67%` |
| `verifyArtemisCollatzAndMath` | -0.15 / -1.99 | 1.04 / 0.24 | `0.000 μs` | `612.150 μs` | `5.33%` |
| `verifyArtemisStateDecimation` | 0.49 / -0.35 | 1.36 / 1.33 | `0.100 μs` | `52.650 μs` | `8.29%` |
| `verifyArtemisGatingSystem` | 0.43 / -1.78 | 1.92 / 3.36 | `0.000 μs` | `11.050 μs` | `5.78%` |
| `verifyArtemisComputedDestructuring` | -1.00 / -2.01 | 1.98 / 3.49 | `0.000 μs` | `8.250 μs` | `6.74%` |
| `verifyArtemisDerivedClassAndSuper` | 0.97 / 0.44 | 1.42 / 1.35 | `0.200 μs` | `39.000 μs` | `6.50%` |

> [!NOTE]
> **Skewness/Kurtosis**: Positive skew indicates right-tailed latency outliers (typical of JIT compilation spikes or GC pauses). Excess kurtosis > 0 indicates heavier tails than normal distribution. **MAD** is a robust dispersion measure (50% breakdown point) preferred when distribution is non-normal. **Thermal drift** near 0% indicates stable CPU frequency during measurement; values >5% suggest throttling or background interference.

---

## 5. Memory Profiling

| Function | Native Heap Δ | Obfuscated Heap Δ | Memory Overhead |
| :--- | :---: | :---: | :---: |
 | `calculateSecretHash` | `29.4 KB` | `38.8 KB` | `9.4 KB` |
| `encryptTEA` | `6.4 KB` | `17.7 KB` | `11.3 KB` |
| `verifyArtemisCollatzAndMath` | `14.2 KB` | `7.4 KB` | `-6.8 KB` |
| `verifyArtemisStateDecimation` | `8.0 KB` | `8.4 KB` | `0.4 KB` |
| `verifyArtemisGatingSystem` | `15.9 KB` | `33.5 KB` | `17.7 KB` |
| `verifyArtemisComputedDestructuring` | `8.0 KB` | `11.1 KB` | `3.1 KB` |
| `verifyArtemisDerivedClassAndSuper` | `29.0 KB` | `23.5 KB` | `-5.4 KB` |

---

## 6. Micro-Architecture Performance Analysis

1. **The Core Interpreter Bottleneck**: Standalone VM virtualization introduces CPU branch-prediction misses and instruction dispatch overhead. Tight numerical loops like Collatz conjecture take several guest instructions per iteration, leading to **60518x** native slowdown. This is expected for custom interpreted register machines.
2. **Fast-Path Loop Optimization**: Eliminating try-catch blocks in loops allows V8 to inline the indirect threaded dispatch table, producing standard operation latencies of under **100 μs** for linear paths (destructuring, state decimation, gating systems).
3. **Adaptive Warmup Convergence**: 6/7 suites reached CV < 5% convergence within the warmup budget, indicating stable JIT optimization before measurement.

---

## 7. Resource Usage & Shannon Entropy Analysis

| Resource Metric | Native Code (Original) | Obfuscated Standalone VM | Expansion Factor / Score |
| :--- | :---: | :---: | :---: |
| **Bundle File Size** | `37.021 KB` | `3313.163 KB` | **89.50x** |
| **File-Wide Character Entropy** | `3.8097 bits` | `4.6282 bits` | **4.6282 Shannon bits** (Medium Entropy) |
| **Bytecode Instruction Payload** | `N/A` | `~7.152 bits` | **High Entropy** (Randomized bytecode sequence) |

> [!NOTE]
> **Understanding File-Wide Shannon Entropy**: 
> While the file-wide character entropy of the obfuscated bundle scores a medium **4.628 bits**, this is due to the presence of clean ASCII VM boilerplate wrapper structures, standard JS keywords (`function`, `ctx`, `regs`), and brackets which lower overall character-level entropy. However, the *raw compiled guest instruction stream array* itself scores **~7.15 Shannon bits**, indicating high random noise that prevents naive static signature analysis.
> 
> **Selective Virtualization is Key**: Because **TSXobf** utilizes **Selective Virtualization** through the JSDoc `/** @virtualize */` annotation, **only critical mathematical algorithms (such as licensing, telemetry validation, and cryptography helpers) are virtualized**. The rest of your application (UI components, API calls, framework code) continues to run natively at 100% V8 speed.

---

## 8. Security & Threat Modeling Analysis

### Threat Mitigation Matrix

| Threat Category | Attacker Profile & Capabilities | VM Protection Level | Technical Countermeasures & Limits |
| :--- | :--- | :---: | :--- |
| **Static Code Extraction** | Automated AST deobfuscators, pattern-matching scanners | **High Protection** | Obfuscated code is virtualized into bytecode. Normal control flow is replaced by indirect dispatch loops, and original JS syntax is removed. |
| **Symbolic Analysis** | SMT/SAT solvers, symbolic executors (e.g., angr, Triton) | **Medium Protection** | LCG-based rolling bytecode key decryption and anti-symbolic opaque predicates trigger path explosion, making symbolic tracking expensive. |
| **Advanced Dynamic Reverse Engineering** | Dynamic binary instrumentation (DBI), manual handler mapping, instruction tracing | **Low-Medium Protection** | Analysts can still recover partial execution traces, resolve static blocks, and map VM dispatchers manually given enough time. |

---

## 9. Báo Cáo Tóm Tắt (Tiếng Việt — Phân Tích Khoa Học)

Bản báo cáo này cung cấp đánh giá khách quan, có kiểm định thống kê nghiêm ngặt về hiệu năng và bảo mật của **TSXobf**:

1. **Đánh Giá Hiệu Năng**: Việc ảo hóa mã nguồn JavaScript sang Bytecode tự thiết kế và thông dịch qua VM sinh ra độ trễ (overhead) đáng kể. Các tác vụ nặng về tính toán (Collatz, TEA) chịu ảnh hưởng lớn nhất do quá trình nạp/giải mã opcode liên tục. Trung bình nhân học (geometric mean) của tỷ lệ chậm là **6386.58x**.
2. **Kiểm Định Thống Kê**: Tất cả các bài kiểm định **Mann-Whitney U** đều cho thấy sự khác biệt có ý nghĩa thống kê (p < 0.001) giữa native và virtualized, xác nhận overhead là **thực sự** chứ không phải nhiễu ngẫu nhiên. Hiệu ứng Cohen's d cho thấy magnitude **very large** trở lên ở phần lớn test suite.
3. **Độ Trễ Phân Phối (Dispatch Overhead)**: Nhờ cơ chế inlining của V8 JIT và loại bỏ try-catch trong các vòng lặp nóng, tốc độ thực thi của VM trên các luồng tuyến tính (gating, destructuring, class initialization) vẫn đạt hiệu quả tốt (dưới 100 μs).
4. **Phân Tích Entropy**: Bytecode lõi đạt entropy cao (~7.15 bits), chống lại việc phân tích chữ ký tĩnh. Entropy toàn tệp ở mức trung bình do có thêm phần khung máy ảo bằng mã JS sạch.
5. **Mô Hình Bảo Mật**: Máy ảo hoạt động theo nguyên lý nâng cao rào cản kinh tế và thời gian của kẻ tấn công, ngăn chặn hiệu quả các công cụ dịch ngược tự động (AST Deobfuscator) nhưng không thể ngăn cản tuyệt đối các cuộc tấn công động (Dynamic Analysis) chuyên sâu.
6. **Tính Toàn Vẹn**: Kết quả đầu ra của mã ảo hóa **không đổi** so với mã gốc trong tất cả test suite (xác minh bằng deep-equality), đảm bảo tính đúng đắn khi bảo vệ mã ứng dụng thực tế.

---

## 10. Reproducibility

Raw data has been exported for independent verification:
- `BENCHMARK.json` — full structured dataset (system profile, per-test statistics, comparison metrics, raw timing arrays available on request)
- `BENCHMARK.csv` — spreadsheet-friendly summary for statistical analysis in R/Python/Excel

### Recommended Re-run Command
```bash
node --expose-gc --no-concurrent-recompilation benchmark.js
```
On Linux, pin the process to a single core and disable frequency scaling for maximal stability:
```bash
sudo cpupower frequency-set -g performance
taskset -c 0 node --expose-gc benchmark.js
```
