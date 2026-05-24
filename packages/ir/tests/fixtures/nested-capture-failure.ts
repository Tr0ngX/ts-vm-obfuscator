export function nestedCaptureFailure() {
  const local = 1;
  const fn = () => local + 1;
  return fn();
}
