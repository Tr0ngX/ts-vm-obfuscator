# Monorepo Obfuscation & VM Weaknesses Security Report

This report consolidates the security weaknesses, architectural limits, and vulnerabilities identified across all core areas of the VM compiler and runtime by our 5 specialized research subagents.

---

## 🔴 CRITICAL SEVERITY

### 1. VM Global Scope Exposure & Direct Sandbox Escape
* **Location:** [polymorphic-builder.ts](file:///d:/ts-vm-obfuscator/packages/vm-runtime/src/polymorphic-builder.ts)
* **Weakness:** The VM runtime binds the guest's global scope directly to the host's actual global object (`globalThis`, `window`, or `global`). 
* **Impact:** Guest code has direct, unmediated access to critical host APIs (like `process`, `require`, `eval`, or `document`). An attacker can run arbitrary shell commands, read local files, or perform network requests, escaping the sandbox by design.
* **Exploitation:** 
  ```javascript
  // Bytecode executing on the VM resolves loadGlobal('process') to actual process
  const process = loadGlobal('process');
  process.mainModule.require('child_process').execSync('calc');
  ```

### 2. Deterministic Key & Seed Materialization
* **Location:** [encoder.ts](file:///d:/ts-vm-obfuscator/packages/bytecode/src/encoder.ts) & [shared/src/index.ts](file:///d:/ts-vm-obfuscator/packages/shared/src/index.ts)
* **Weakness:** 
  * The compiler randomizes opcode mappings, instruction junk counts, register indexes, and constants using a single `seed` processed via a mathematically weak Park-Miller LCG ($X_{n+1} = (16807 \times X_n) \pmod{2^{31} - 1}$).
  * This seed is written in plain text directly to the output wrapper wrapper scripts.
* **Impact:** An attacker can extract the seed from the wrapper file, predict all LCG outputs, map randomized opcodes back to their canonical forms, and bypass rolling-key decryption completely.
* **Exploitation:**
  $$\text{Key} = \text{LCG}(\text{extracted\_seed})$$

### 3. Reversible Self-Modifying Bytecode via Shadow Buffer
* **Location:** [polymorphic-builder.ts](file:///d:/ts-vm-obfuscator/packages/vm-runtime/src/polymorphic-builder.ts)
* **Weakness:** The self-modifying code stores a shadow buffer of the XOR modification history (`ctx.xorLog`) within the same VM context object to reverse mutations on loops and backward jumps.
* **Impact:** Because the bit-reversal operation is mathematically linear under XOR ($\text{rev}(A \oplus B) = \text{rev}(A) \oplus \text{rev}(B)$), the original clean bytecode can be fully recovered from memory at any point.
* **Exploitation:**
  $$\text{CleanBytecode}[i] = \text{ctx.bytecode}[i] \oplus \text{reverse8}(\text{ctx.xorLog}[i])$$

---

## 🟡 HIGH SEVERITY

### 4. Jump Table Extraction in CFF
* **Location:** [control-flow-flattening.ts](file:///d:/ts-vm-obfuscator/packages/transforms/src/passes/control-flow-flattening.ts)
* **Weakness:** The entry block (`cff_entry`) populates the jump table array with literal `BlockLabel` operands in straight-line initialization code. 
* **Impact:** An analyst or static tool can extract the array assignments to construct a complete mapping of indices to block labels, bypassing control flow flattening.
* **Exploitation:** Scanning the entry block's `ComputedSet` instructions reveals all target block addresses.

### 5. String Pool XOR Key Leaks
* **Location:** [string-pool-encoding.ts](file:///d:/ts-vm-obfuscator/packages/transforms/src/passes/string-pool-encoding.ts)
* **Weakness:** For inline string fragmentation under 128 characters, the XOR decryption keys and ciphertext values are stored as plain number constants in the constant pool.
* **Impact:** Attackers can extract character-by-character values and keys directly from the constant pool and decode strings offline without running the VM.
* **Exploitation:**
  $$\text{char} = \text{ciphertext\_constant} \oplus \text{key\_constant}$$

### 6. Prototype Pollution via PropSet / ComputedSet
* **Location:** [polymorphic-builder.ts](file:///d:/ts-vm-obfuscator/packages/vm-runtime/src/polymorphic-builder.ts)
* **Weakness:** The VM write handlers assign property values to objects directly without checking for dangerous prototype keys like `"__proto__"`, `"constructor"`, or `"prototype"`.
* **Impact:** An attacker can pollute the global host prototype chain, resulting in remote code execution or process-wide state corruption.

### 7. Incorrect Electron Hardening Logic (Broken by Design)
* **Location:** [index.ts](file:///d:/ts-vm-obfuscator/packages/electron-hardening/src/index.ts)
* **Weakness:** The hardening guard pattern performs a direct parameterless `Call` on retrieved objects (like `webPreferences` or `ipcRenderer`), which are non-callable.
* **Impact:** Invoking a VM `Call` on non-callable properties throws a `TypeError` and crashes the application at runtime. Furthermore, since the guard script simply performs a call, an attacker can proxy the globals and spoof the result.

---

## 🟠 MEDIUM SEVERITY

### 8. Static Solving of Opaque Predicates
* **Location:** [type-level-fake-path.ts](file:///d:/ts-vm-obfuscator/packages/transforms/src/passes/type-level-fake-path.ts)
* **Weakness:** Predicate templates use simple mathematical properties (quadratic non-residuosity, Fermat parity) that hold true for all integers $x$.
* **Impact:** Modern symbolic execution engines (like Triton or angr) backed by SMT solvers (Z3) can statically simplify all conditions to `true`, pruning all fake blocks.

### 9. Environment-Bound Predicate Fragility
* **Location:** [type-level-fake-path.ts](file:///d:/ts-vm-obfuscator/packages/transforms/src/passes/type-level-fake-path.ts)
* **Weakness:** The environment checks verify global property lengths and expect the name of a new Error object to be a string.
* **Impact:** Any environment hooking or prototype overrides (common in testing or sandbox profiling) will break the check and crash the application.

### 10. API Renaming Invariant Leak
* **Location:** [symbol-indirection.ts](file:///d:/ts-vm-obfuscator/packages/transforms/src/passes/symbol-indirection.ts)
* **Weakness:** Exported functions and virtualized entry points must retain their original names to remain callable by the host.
* **Impact:** These un-obfuscated names act as entry-point anchors, giving reverse engineers immediate hints about the internal flow.

### 11. String Decryption Hooking
* **Location:** [vm-runtime/src](file:///d:/ts-vm-obfuscator/packages/vm-runtime/src)
* **Weakness:** Decrypted strings are reconstructed using `String.fromCharCode.apply` inside the VM.
* **Impact:** Analysts can hook `String.fromCharCode` at the JavaScript level to log every decrypted string in real-time.

---

## 🔵 LOW SEVERITY

### 12. Register Proxy Overhead
* **Location:** [polymorphic-builder.ts](file:///d:/ts-vm-obfuscator/packages/vm-runtime/src/polymorphic-builder.ts)
* **Weakness:** The register buffer is wrapped in a JavaScript `Proxy` for boundary checks.
* **Impact:** Read/write proxy intercepts slow down instruction dispatch by up to 20x and make register updates easy to trace dynamically.

### 13. Block Shuffling Irrelevance
* **Location:** [transforms/src](file:///d:/ts-vm-obfuscator/packages/transforms/src)
* **Weakness:** Shuffling blocks in the output array is purely physical.
* **Impact:** Disassemblers construct CFGs from logical jump targets, meaning shuffling basic blocks does not change the graph representation.
