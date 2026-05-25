export function nestedCaptureFailure() {
  const values = [1, , 2];
  return values.length;
}
