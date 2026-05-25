export function vmAdd(a: number, b: number) {
  return a + b;
}

export const vmArrow = (left: number, right: number) => left * right + 1;

export function switchTry(value: number) {
  try {
    switch (value) {
      case 1:
        return 'one';
      default:
        return 'other';
    }
  } catch {
    return 'error';
  }
}

export function destructured({ a, b = 1 }: { a: number; b?: number }, ...rest: number[]) {
  const [first, ...tail] = rest;
  const values = [a, ...rest];
  return a + b + first + tail.length + values.length;
}

export const lifted = ({ value }: { value: number }) => {
  const values = [value, ...[1, 2]];
  return values[0] + values.length;
};

export function spreadHoles() {
  const sparse = [1, , ...new Set([2, 3]), , ...'45'];
  const mark = Object.keys(sparse).join('|');
  const upper = String.fromCharCode(...new Set([65, 66]));
  return `${sparse.length}:${mark}:${upper}:${new Date(...new Set([2020, 1, 2])).getDate()}`;
}

export function thisAware(this: { label?: string } | undefined, prefix: string) {
  return `${prefix}:${this?.label ?? 'none'}`;
}

export function ctorAware(this: { value?: number }, value: number) {
  if (new.target) {
    this.value = value;
    return value + 1;
  }
  return value - 1;
}

export async function asyncVm(value: number) {
  const first = await Promise.resolve(value + 2);
  return first * 2;
}

export const asyncLifted = async (value: number) => {
  const next = await Promise.resolve(value + 1);
  return next * 3;
};
