export function thisPack(this: { label?: string } | undefined, prefix: string) {
  return `${prefix}:${this?.label ?? 'none'}`;
}

export function newTargetPack(this: { value?: number }, value: number) {
  if (new.target) {
    this.value = value;
    return value + 1;
  }
  return value - 1;
}
