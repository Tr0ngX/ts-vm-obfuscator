/** @virtualize */
export function syntaxPack(flag: boolean, input: string | null) {
  function localJoin(value: string) {
    return value ? `${value}!` : 'empty';
  }

  const label = flag ? 'yes' : 'no';
  const maybe = input ?? 'anon';
  const suffix = localJoin(input || '');
  const created = new Array(flag ? 2 : 1);
  const typed = maybe as string;

  return `${label}:${typed!.toUpperCase()}:${suffix}:${created.length}`;
}
