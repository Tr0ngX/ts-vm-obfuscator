export async function testAsyncLoop(iterable: any) {
  let sum = 0;
  for await (const x of iterable) {
    sum += x;
  }
  return sum;
}
