import type { Instruction, OpcodeMapping, EncodedConstant, ConstantPoolEntry, BytecodeModule } from '@tsvm/shared';
import { ImmediateEncodingScheme, ConstantEncodingScheme } from '@tsvm/shared';

import type { VMBuildConfig } from '@tsvm/shared';

export function decodeBytecode(bytes: Uint8Array, mapping: OpcodeMapping, config: VMBuildConfig): Instruction[] {
  return [];
}

export function decodeConstantPool(encoded: unknown[], scheme: ConstantEncodingScheme, seed: number): ConstantPoolEntry[] {
  return [];
}

export function disassemble(module: BytecodeModule): string {
  return "Disassembly not implemented in stub";
}
