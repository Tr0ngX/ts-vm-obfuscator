import type { Instruction, OpcodeMapping, EncodedConstant, ConstantPoolEntry, BytecodeModule } from '@tsvm/shared';
import { ImmediateEncodingScheme, ConstantEncodingScheme } from '@tsvm/shared';

export function decodeBytecode(bytes: Uint8Array, mapping: OpcodeMapping, encoding: ImmediateEncodingScheme): Instruction[] {
  return [];
}

export function decodeConstantPool(encoded: unknown[], scheme: ConstantEncodingScheme, seed: number): ConstantPoolEntry[] {
  return [];
}

export function disassemble(module: BytecodeModule): string {
  return "Disassembly not implemented in stub";
}
