export function nestedCaptureFailure() {
  class LocalBox {}
  return new LocalBox();
}
