// @ts-nocheck
/** @virtualize */
function testVMBlockerWith(val1) {
    const obj = { a: val1 };
    let out = 0;
    with (obj) {
        out = a;
    }
    return out;
}
globalThis.testVMBlockerWith = testVMBlockerWith;
