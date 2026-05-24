/** @virtualize */
export function calculateSecretHash(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

/** @virtualize */
export function encryptTEA(v0: number, v1: number, k0: number, k1: number, k2: number, k3: number): number {
  console.log("DEBUG: Starting TEA Encryption block...");
  let sum = 0;
  const delta = 0x9e3779b9;
  for (let i = 0; i < 32; i++) {
    sum = (sum + delta) | 0;
    v0 = (v0 + (((v1 << 4) + k0) ^ (v1 + sum) ^ ((v1 >>> 5) + k1))) | 0;
    v1 = (v1 + (((v0 << 4) + k2) ^ (v0 + sum) ^ ((v0 >>> 5) + k3))) | 0;
  }
  console.log("DEBUG: TEA Encryption completed!");
  return (v0 ^ v1) | 0;
}

export function main() {
  console.log("Secret Hash:", calculateSecretHash("hello-world"));
  console.log("TEA Encrypted:", encryptTEA(12345, 67890, 1, 2, 3, 4));
}

main();
