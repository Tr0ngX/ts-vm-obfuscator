/** @virtualize */
export function complexStructures(flag: number) {
  const arr = [1, 2, 3];
  const obj = { a: arr[1], flag };
  arr[0] = obj.a + arr[2];

  if (flag > 1) {
    return arr[0];
  }

  return obj.flag;
}
