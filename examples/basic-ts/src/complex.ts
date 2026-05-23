/** @virtualize */
export function encryptTEA(v0: number, v1: number, k0: number, k1: number, k2: number, k3: number): number {
  let sum = 0;
  let delta = 2654435769; // 0x9E3779B9
  for (let i = 0; i < 32; i++) {
    sum = sum + delta;
    sum |= 0;
    
    let t1 = (v1 << 4) + k0;
    let t2 = v1 + sum;
    let t3 = (v1 >> 5) + k1;
    v0 = v0 + (t1 ^ t2 ^ t3);
    v0 |= 0;

    let t4 = (v0 << 4) + k2;
    let t5 = v0 + sum;
    let t6 = (v0 >> 5) + k3;
    v1 = v1 + (t4 ^ t5 ^ t6);
    v1 |= 0;
  }
  // Return a combination of v0 and v1
  return (v0 ^ v1) | 0;
}
