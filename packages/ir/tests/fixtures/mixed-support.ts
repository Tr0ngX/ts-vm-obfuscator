export function supportedAdd(a: number, b: number) {
  return a + b;
}

export function unsupportedTryCatch(input: string) {
  try {
    return input.toUpperCase();
  } catch {
    return 'fallback';
  }
}
