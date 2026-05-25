export function iterationPack(input: string[], record: Record<string, number>) {
  let total = 0;
  let joined = '';

  for (const value of input) {
    if (value === 'skip') {
      continue;
    }
    joined += value;
    total += value.length;
    if (value === 'stop') {
      break;
    }
  }

  for (const key in record) {
    total += record[key] ?? 0;
  }

  const [first, second = 'fallback'] = input;
  const { alpha, beta = 5 } = record;

  return `${joined}:${total}:${first}:${second}:${alpha}:${beta}`;
}
