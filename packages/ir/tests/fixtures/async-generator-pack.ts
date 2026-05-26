export async function* asyncGeneratorPack(seed: number) {
  const first = await Promise.resolve(seed + 1);
  yield first;
  yield* [first + 1, await Promise.resolve(first + 2)];
  return first + 3;
}
