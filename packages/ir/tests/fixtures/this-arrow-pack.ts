export function lexicalThisArrowHost(this: { label?: string } | undefined, prefix: string) {
  const readLexicalThis = () => `${prefix}:${this?.label ?? 'none'}`;
  return readLexicalThis();
}

export function lexicalNewTargetArrowHost(this: { value?: number }, value: number) {
  const readLexicalNewTarget = () => {
    if (new.target) {
      this.value = value;
      return value + 1;
    }
    return value - 1;
  };
  return readLexicalNewTarget();
}
