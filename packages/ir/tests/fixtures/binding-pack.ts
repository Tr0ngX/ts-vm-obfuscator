function sum(...values: number[]) {
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total;
}

export function bindingPack(input: { a: number; b?: number; extra?: number; drop?: number }, values: number[]) {
  let first = 0;
  let renamed = 0;
  [first, renamed = 4] = values;

  let restObject: Record<string, number | undefined> = {};
  ({ a: first, b: renamed = 6, ...restObject } = input);

  const [head, ...tail] = values;
  const { a, ...rest } = input;
  const collected = [a, ...values, tail.length];
  const merged = { head, ...rest, size: collected.length };
  let extra = 0;
  ({ extra = 10 } = restObject);
  const nested = (() => extra + tail.length)();

  try {
    throw ['boom', { message: 'detail' }];
  } catch ([code, { message } = { message: 'fallback' }]) {
    return `${code}:${message}:${head}:${first}:${renamed}:${tail.join(',')}:${merged.size}:${nested}:${new Set([...tail, renamed]).size}`;
  }
}

export function parameterPack({ a, b = 1 }: { a: number; b?: number }, ...rest: number[]) {
  const [first, ...tail] = rest;
  return sum(a, b, first ?? 0, tail.length, [...rest, a].length);
}

export const arrayPatternArrow = ([head, ...tail]: number[]) => head + tail.length;

export function callSpreadPack(base: number, args: number[]) {
  const pushed = [base, ...args, base + 1];
  const total = sum(...pushed);
  const unique = new Set([...args, base]);
  return total + unique.size;
}

export function catchPack(flag: boolean) {
  try {
    if (flag) {
      throw { message: 'boom', meta: [4, 5] };
    }
    throw { message: 'soft', meta: [] };
  } catch ({ message = 'none', meta = [] }) {
    return `${message}:${meta.length}`;
  }
}
