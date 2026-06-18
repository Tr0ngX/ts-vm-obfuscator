// @ts-nocheck
/** @virtualize */
function testVMBlockerWith(val1: any): any {
  const obj = { a: val1 };
  let out = 0;
  with (obj) {
    out = a;
  }
  return out;
}

(globalThis as any).testVMBlockerWith = testVMBlockerWith;
