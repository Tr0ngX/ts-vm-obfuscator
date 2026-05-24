export function nestedFactories(input: number) {
  const fn = function (value: number) {
    return value + 1;
  };
  const arrow = (value: number) => value * 2;
  const obj = {
    method(value: number) {
      return value - 1;
    }
  };

  return fn(input) + arrow(input) + obj.method(input);
}
