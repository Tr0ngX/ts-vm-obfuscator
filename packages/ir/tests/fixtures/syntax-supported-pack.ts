function tag(strings: TemplateStringsArray, ...values: any[]) {
  return String.raw(strings, ...values);
}
export function taggedTemplateExample() {
  return tag`hello ${1} world`;
}

export function bigIntLiteralExample() {
  return 1n;
}
