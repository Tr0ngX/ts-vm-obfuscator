export async function asyncPack(flag: boolean, value: number) {
  try {
    const first = await Promise.resolve(value + 1);
    if (flag) {
      return first;
    }
    throw new Error('boom');
  } catch (error) {
    return `${(error as Error).message}:${value}`;
  } finally {
    await Promise.resolve(0);
  }
}

export const asyncArrowPack = async (value: number) => {
  const doubled = await Promise.resolve(value * 2);
  return doubled + 1;
};
