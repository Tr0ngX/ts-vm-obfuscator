"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.testVal = void 0;
exports.calculateFibonacci = calculateFibonacci;
exports.run = run;
/** @virtualize */
function calculateFibonacci(n) {
    if (n <= 1)
        return n;
    let a = 0;
    let b = 1;
    for (let i = 2; i <= n; i++) {
        let temp = a + b;
        a = b;
        b = temp;
    }
    return b;
}
exports.testVal = 42;
function run() {
    console.log("Fibonacci of 10 is:", calculateFibonacci(10));
}
run();
