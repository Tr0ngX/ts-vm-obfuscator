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
