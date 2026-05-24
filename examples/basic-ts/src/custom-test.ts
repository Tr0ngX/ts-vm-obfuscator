/** @virtualize */
export function calculateFibonacci(n: number): number {
  if (n <= 1) return n;
  let a = 0;
  let b = 1;
  for (let i = 2; i <= n; i++) {
    let temp = a + b;
    a = b;
    b = temp;
  }
  return b;
}

export function run() {
  console.log("Fibonacci of 10 is:", calculateFibonacci(10));
}

run();
