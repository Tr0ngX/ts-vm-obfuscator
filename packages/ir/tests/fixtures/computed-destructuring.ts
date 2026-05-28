export function testComputedDestruct(key: string, obj: any) {
  const { [key]: value, ...rest } = obj;
  let val2;
  ({ [key]: val2 } = obj);
  return [value, rest, val2];
}
