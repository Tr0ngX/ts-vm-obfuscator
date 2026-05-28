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

/** @virtualize */
export function verifyArtemisCollatzAndMath(n: number, seed: number): number {
  if (n <= 0 || seed <= 0) return 0;
  let current = n;
  let iterations = 0;
  let accumulator = seed;

  while (current > 1 && iterations < 100) {
    if ((current % 2) === 0) {
      current = (current / 2) | 0;
    } else {
      current = ((current * 3) + 1) | 0;
    }
    
    accumulator = (accumulator ^ (current + iterations)) | 0;
    accumulator = (accumulator << 3) - accumulator + current;
    accumulator |= 0;
    iterations++;
  }

  return accumulator;
}

/** @virtualize */
export function verifyArtemisStateDecimation(key: string, multiplier: number, limit: number): number {
  if (!key || multiplier === 0) return -1;

  const telemetry: { [key: string]: any } = {
    status: 1,
    oxygen: 100,
    pressure: 1013,
    active: true,
    sensorData: [10, 20, 30, 40, 50]
  };

  telemetry[key] = (multiplier * 42) | 0;
  
  delete telemetry.active;
  delete telemetry.status;

  let score = 0;
  
  if (telemetry[key]) {
    score = (telemetry[key] + telemetry.pressure) | 0;
  } else {
    score = telemetry.pressure;
  }

  let idx = 0;
  while (idx < limit && idx < 5) {
    const baseValue = telemetry.sensorData[idx] as number;
    telemetry.sensorData[idx] = (baseValue * multiplier) | 0;
    score = (score + telemetry.sensorData[idx]) | 0;
    idx++;
  }

  return score;
}

/** @virtualize */
export function verifyArtemisGatingSystem(sensorA: number, sensorB: number, threshold: number): number {
  let criticalLevel = 0;

  if ((sensorA > threshold && sensorB > threshold) || ((sensorA + sensorB) > ((threshold * 2) | 0))) {
    if (sensorA === sensorB) {
      criticalLevel = 100;
    } else if (sensorA > sensorB) {
      criticalLevel = ((sensorA - sensorB) * 2) | 0;
    } else {
      criticalLevel = ((sensorB - sensorA) * 3) | 0;
    }
  } else if (sensorA < 0 || sensorB < 0) {
    criticalLevel = -999;
  } else {
    criticalLevel = (sensorA ^ sensorB) | 0;
  }

  return criticalLevel;
}

/** @virtualize */
export function verifyArtemisComputedDestructuring(key: string, value: number, defaultVal: number): any[] {
  const obj: any = { [key]: value, otherKey: 99 };
  const { [key]: extracted, otherKey, ...rest } = obj;
  let assigned;
  let fallback;
  ({ [key]: assigned, missingKey: fallback = defaultVal } = obj);
  return [extracted, otherKey, rest, assigned, fallback];
}

/** @virtualize */
export async function verifyArtemisAsyncLoop(count: number): Promise<number> {
  const asyncIterable: AsyncIterable<number> = {
    [Symbol.asyncIterator](): AsyncIterator<number> {
      let i = 1;
      return {
        async next(): Promise<IteratorResult<number>> {
          if (i <= count) {
            return { value: i++, done: false };
          }
          return { value: 0, done: true };
        }
      };
    }
  };

  let sum = 0;
  for await (const x of asyncIterable) {
    sum += x;
  }
  return sum;
}

main();
