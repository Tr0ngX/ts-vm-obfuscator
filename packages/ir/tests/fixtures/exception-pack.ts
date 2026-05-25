export function tryCatchPack(flag: boolean) {
  try {
    if (flag) {
      throw 'boom';
    }
    return 'ok';
  } catch (error) {
    return String(error);
  }
}

export function tryFinallyPack(value: number) {
  let total = value;
  try {
    return total;
  } finally {
    total += 1;
    return total;
  }
}

export function tryCatchFinallyPack(flag: boolean) {
  let suffix = '';
  try {
    if (flag) {
      throw 'boom';
    }
    return 'clean';
  } catch (error) {
    return String(error);
  } finally {
    suffix = ':done';
  }
}

export function tryFinallyBreakPack(limit: number) {
  let count = 0;
  let trace = '';
  while (count < limit) {
    try {
      if (count === 3) {
        break;
      }
      trace += String(count);
    } finally {
      trace += ':';
    }
    count += 1;
  }
  return `${trace}${count}`;
}
