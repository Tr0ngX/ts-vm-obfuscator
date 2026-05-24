/** @virtualize */
export function nestedCounter(start: number) {
  let counter = start;
  const increment = (delta: number) => {
    counter = counter + delta;
    return counter;
  };

  counter = counter + 1;
  return increment(2) + counter;
}
