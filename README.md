<p align="center">
  <img src="assets/logo.png" alt="TSXobf Logo" width="200px" />
</p>

# 🛡️ TSXobf — TypeScript Semantic-Aware VM Obfuscator

> **Next-Generation Code Virtualization Pipeline** for securing high-value business logic in TypeScript and JavaScript ecosystems.

---
🌐 **Languages:** [English](README.md) | [Tiếng Việt (Vietnamese)](README_VN.md)
---

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/Language-TypeScript-blue.svg)](https://www.typescriptlang.org/)
[![Architecture](https://img.shields.io/badge/Architecture-Register--Based%20VM-orange.svg)]()

Unlike traditional obfuscators that rely on easily-reversible AST transformations (like variable renaming, dead code injection, or control flow flattening), **TSXobf** introduces a professional-grade **Compiler Backend** that compiles your proprietary TypeScript algorithms down to custom bytecode and executes them inside a dynamically randomized **Polymorphic Virtual Machine (VM)**.

---

## 💎 The Technical Moat: Traditional vs. TSXobf

| Security Dimension | Traditional Obfuscators (e.g., `javascript-obfuscator`, `js-confuser`) | TSXobf (Semantic VM Obfuscator) |
| :--- | :--- | :--- |
| **Primary Protection** | Lexical scrambling, string encryption, block flattening. | **Virtualization** (Mã hóa logic thành chỉ thị máy ảo). |
| **Resilience to Deobfuscators** | Highly vulnerable to automated AST tools (e.g., `webcrack`, `ArachneJS`). | **Virtually immune** to standard deobfuscators; requires writing a custom solver for every build. |
| **Static Code Extraction** | Strings & variables are recoverable via symbolic execution. | Only dynamic byte arrays are exposed; logic is completely hidden inside the VM interpreter. |
| **Performance Overhead** | High global performance hit due to endless wrapper functions. | **Localized overhead**; only critical functions are virtualized, non-virtualized code runs at 100% native speed. |
| **Build Polymorphism** | Identical structural patterns are generated across builds. | **Dynamic instruction layouts & Opcode mapping shuffles** per compilation. |

---

## 📐 Core Architecture

TSXobf works as a compiler backend. It takes your TypeScript code, compiles target functions into a register-based Intermediate Representation (IR), applies security passes, and packages them into a lightweight JS interpreter.

```mermaid
graph TD

    A["⚡ TypeScript Source"] -->|"TS Compiler API"| B["🔍 Semantic AST Analysis"]
    B -->|"@virtualize Filter"| C["🧠 Register-Based IR"]

    subgraph T["Transforms Pipeline"]
        direction TB
        C --> D["📦 Constant Pool Extraction"]
        D --> E["🎲 Opcode Randomization"]
        E --> F["🧬 Control-Flow Mutation"]
    end

    F -->|"Assembler"| G["💾 Binary Bytecode Stream"]
    G -->|"Polymorphic Packaging"| H["📁 Production JS Bundle"]

    subgraph R["VM Execution Runtime"]
        direction TB
        H -->|"Lazy Decode"| I["🔐 Encrypted Constant Pool"]
        H -->|"Dispatch Loop"| J["⚙️ Polymorphic VM Interpreter"]
        I --> K["🧩 Runtime Values"]
        J --> K
    end

    K -->|"Semantic Output"| L["✅ Equivalent Program Behavior"]

    style T fill:#2a2b36,stroke:#007acc,stroke-width:2px,color:#ffffff;
    style R fill:#2a2b36,stroke:#007acc,stroke-width:2px,color:#ffffff;
```

---

## 🚀 Key Features

> [!IMPORTANT]
> **Semantic-Aware Compilation:**
> TSXobf does not blindly modify strings. It parses code via the official **TypeScript Compiler API**, allowing it to seamlessly resolve module exports, scope rules, typed variables, and dependency calls during virtualization.

*   **🎭 Polymorphic Virtual Machine Runtime**
    The VM's structural logic is randomized dynamically at each compilation. Register assignments, internal evaluation loops, and **Opcodes (instruction numbers) are shuffled per build**. If an attacker decodes build A, their tool will immediately fail on build B.
*   **🔒 Just-In-Time XOR Decryption**
    All strings, numerical constants, and property lookups are extracted into an encrypted constant pool. These values are dynamically decrypted using a randomly generated session seed right inside the interpreter loop, leaving zero static signatures.
*   **🎯 Targeted Protection via JSDoc**
    No need to sacrifice performance. Protect proprietary IP (e.g., license validators, cryptographic handlers, billing checkers) by placing a `/** @virtualize */` annotation above your functions.
*   **📦 Zero-Dependency Bundling**
    The final compilation is self-contained. It yields a clean vanilla JavaScript file that runs anywhere: modern web browsers, Node.js, Cloudflare Workers, or AWS Lambda.

---

## 🔎 How Obfuscation Looks

### 1. Original TypeScript Code (`src/index.ts`)
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

### 2. Obfuscated Output JavaScript (`dist/build.js`)
Your algorithms are compiled down into a secure binary block and virtual registers:

```javascript
const vmFunctions = (function() {
  const seed = 1779526130061;
  
  // Encrypted Constant Pool
  const rawCP = [{"index":0,"kind":"number","value":0},{"index":1,"kind":"string","value":"áèãêùå"}];
  const cp = rawCP.map(c => {
    return c.kind === 'string' ? decrypt(c.value, seed) : c.value;
  });

  // Unique, Dynamic VM Interpreter custom-generated for this compile session
  function createExecutor(bytecodeArr) {
    return function execute() {
      const regs = new Array(256).fill(undefined);
      // Arguments initialization in virtual registers...
      while(pc < bytecode.length) {
        const op = bytecode[pc++];
        switch(op) {
          case 105: regs[args[1].val] = cp[args[0].val]; break; // Randomized Opcode: LoadConst
          case 47:  regs[args[0].val] = regs[args[1].val]; break; // Randomized Opcode: Move
          case 55:  regs[args[2].val] = regs[args[0].val] + regs[args[1].val]; break; // Randomized Opcode: Add
          // ... randomized VM execution instructions
        }
      }
    };
  }

  var result = {};
  // The actual logic is now represented solely as linear bytecode data
  result['calculateSecretHash'] = createExecutor(new Uint8Array([105,2,2,0,0,0,0,0,2,0,0,0,47,2,0,1...]));
  return result;
})();
```

---

## ⚡ Quick Start

### Prerequisites
*   Node.js (>= 18)
*   `pnpm` (highly recommended for monorepos)

### 1. Installation & Initialization
```bash
# Clone the repository
git clone https://github.com/yourusername/TSXobf.git
cd TSXobf

# Install dependencies
pnpm install

# Compile all workspace packages
pnpm build
```

### 2. Run the Obfuscator CLI
Provide the compiler with the target TypeScript configuration:
```bash
node packages/cli/dist/cli.js -p examples/basic-ts/tsconfig.json --out dist-obf
```
The protected production files will be built and output into the `dist-obf/` directory with a timestamped build signature: `build_<session_id>.js`.

### 3. Verify Integrity
Run the integrated end-to-end semantic validation script, which compares compiled VM output against native execution results:
```bash
node test-pipeline.js
```

> [!TIP]
> **Deep Customization:**
> You can tweak transforms, adjust constant pool encryption methods, and modify instruction lowering rules directly in `packages/transforms/` and `packages/bytecode/`.

---

## 🛠️ Architecture Deep-Dive

TSXobf is constructed modularly using modern workspace standards:

*   **`packages/ir`**: Synthesizes a structured Register-based Intermediate Representation from high-level AST blocks. Handles variable allocation and control flow block linking.
*   **`packages/transforms`**: The security optimization layer. Performs constant extraction, symbol obfuscation, and applies polymorphic opcodes mappings.
*   **`packages/bytecode`**: Lowering engine. Translates IR structures into concrete, serialized instruction bytes.
*   **`packages/vm-runtime`**: Core VM generator. Packs compiled bytecode alongside the dynamic polymorphic runtime code generator.
*   **`packages/cli`**: Lightweight user interface tool integrating compiler steps seamlessly.

---

## 🛡️ License

This project is licensed under the MIT License - see the LICENSE file for details.
