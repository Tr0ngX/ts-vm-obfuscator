export function controlFlowPack(limit: number) {
  let total = 0;
  let i = 0;

  do {
    i++;
    if (i === 2) {
      continue;
    }
    if (i === 5) {
      break;
    }

    switch (i) {
      case 1:
        total += 10;
        break;
      case 3:
        total += 30;
        break;
      case 4:
        total += 40;
        break;
      default:
        total += 1;
        break;
    }
  } while (i < limit);

  return total + i;
}

export function throwingPack(flag: boolean) {
  if (flag) {
    throw new Error('boom');
  }

  return 'ok';
}
