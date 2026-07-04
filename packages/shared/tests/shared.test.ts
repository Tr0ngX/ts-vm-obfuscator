import { describe, it, expect } from 'vitest';
import { SeededRandom, isVariableLengthOpcode, isTerminator, OpCode } from '@tsvm/shared';

describe('SeededRandom', () => {
  it('produces deterministic output for the same seed', () => {
    const a = new SeededRandom(42);
    const b = new SeededRandom(42);
    for (let i = 0; i < 100; i++) {
      expect(a.nextInt()).toBe(b.nextInt());
    }
  });

  it('produces different output for different seeds', () => {
    const a = new SeededRandom(42);
    const b = new SeededRandom(99);
    const resultsA = Array.from({ length: 10 }, () => a.nextInt());
    const resultsB = Array.from({ length: 10 }, () => b.nextInt());
    expect(resultsA).not.toEqual(resultsB);
  });

  it('handles seed 0 by clamping to 1', () => {
    const rng = new SeededRandom(0);
    expect(rng['state']).toBe(1);
  });

  it('returns values in [0, 2^31-2] for nextInt', () => {
    const rng = new SeededRandom(7);
    for (let i = 0; i < 1000; i++) {
      const val = rng.nextInt();
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(2147483646);
    }
  });

  it('returns values in [0, 1) for nextFloat', () => {
    const rng = new SeededRandom(7);
    for (let i = 0; i < 1000; i++) {
      const val = rng.nextFloat();
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(1);
    }
  });

  it('next() returns the same as nextFloat() for a given state', () => {
    const rng = new SeededRandom(7);
    const snap = rng.snapshot();
    const val1 = rng.next();
    rng.restore(snap);
    const val2 = rng.nextFloat();
    expect(val1).toBe(val2);
  });

  it('nextRange returns values in [min, max] inclusive', () => {
    const rng = new SeededRandom(7);
    for (let i = 0; i < 1000; i++) {
      const val = rng.nextRange(5, 10);
      expect(val).toBeGreaterThanOrEqual(5);
      expect(val).toBeLessThanOrEqual(10);
    }
  });

  it('nextRange throws when min > max', () => {
    const rng = new SeededRandom(7);
    expect(() => rng.nextRange(10, 5)).toThrow(RangeError);
  });

  it('nextRange works with min === max', () => {
    const rng = new SeededRandom(7);
    for (let i = 0; i < 100; i++) {
      expect(rng.nextRange(7, 7)).toBe(7);
    }
  });

  it('shuffle reorders array in-place', () => {
    const rng = new SeededRandom(42);
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const original = [...arr];
    const result = rng.shuffle(arr);
    expect(result).toBe(arr);
    expect(arr).not.toEqual(original);
    expect(arr.sort((a, b) => a - b)).toEqual(original);
  });

  it('shuffle single-element array returns same', () => {
    const rng = new SeededRandom(42);
    const arr = [1];
    rng.shuffle(arr);
    expect(arr).toEqual([1]);
  });

  it('shuffle empty array returns empty', () => {
    const rng = new SeededRandom(42);
    const arr: number[] = [];
    rng.shuffle(arr);
    expect(arr).toEqual([]);
  });

  it('shuffle is deterministic for same seed', () => {
    const a = new SeededRandom(42);
    const b = new SeededRandom(42);
    const arrA = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const arrB = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    a.shuffle(arrA);
    b.shuffle(arrB);
    expect(arrA).toEqual(arrB);
  });

  it('pick returns element from array', () => {
    const rng = new SeededRandom(42);
    const arr = [10, 20, 30];
    const picked = rng.pick(arr);
    expect(arr).toContain(picked);
  });

  it('pick throws on empty array', () => {
    const rng = new SeededRandom(42);
    expect(() => rng.pick([])).toThrow(RangeError);
  });

  it('identifier returns string of correct length starting with letter', () => {
    const rng = new SeededRandom(42);
    for (const len of [1, 4, 8, 16, 32]) {
      const id = rng.identifier(len);
      expect(id.length).toBe(len);
      expect(id[0]!).toMatch(/[a-zA-Z]/);
      expect(id).toMatch(/^[a-zA-Z][a-zA-Z0-9_$]*$/);
    }
  });

  it('identifier is deterministic', () => {
    const a = new SeededRandom(42);
    const b = new SeededRandom(42);
    expect(a.identifier(8)).toBe(b.identifier(8));
  });

  it('snapshot and restore allow replay', () => {
    const rng = new SeededRandom(42);
    const values1 = Array.from({ length: 5 }, () => rng.nextInt());
    const snap = rng.snapshot();
    const values2 = Array.from({ length: 5 }, () => rng.nextInt());
    rng.restore(snap);
    const values3 = Array.from({ length: 5 }, () => rng.nextInt());
    expect(values2).toEqual(values3);
    expect(values2).not.toEqual(values1);
  });

  it('restore clamps state to [1, 2^31-1]', () => {
    const rng = new SeededRandom(42);
    rng.restore(0);
    expect(rng['state']).toBe(1);
    rng.restore(0xffffffff);
    expect(rng['state']).toBe(0x7fffffff);
  });
});

describe('isVariableLengthOpcode', () => {
  it('returns true for variable-length opcodes', () => {
    expect(isVariableLengthOpcode(OpCode.Call)).toBe(true);
    expect(isVariableLengthOpcode(OpCode.CallMethod)).toBe(true);
    expect(isVariableLengthOpcode(OpCode.New)).toBe(true);
    expect(isVariableLengthOpcode(OpCode.ArrayNew)).toBe(true);
    expect(isVariableLengthOpcode(OpCode.ObjectNew)).toBe(true);
    expect(isVariableLengthOpcode(OpCode.Spread)).toBe(true);
    expect(isVariableLengthOpcode(OpCode.SpreadIntoArray)).toBe(true);
    expect(isVariableLengthOpcode(OpCode.SuperCall)).toBe(true);
    expect(isVariableLengthOpcode(OpCode.SuperInstruction)).toBe(true);
  });

  it('returns false for fixed-length opcodes', () => {
    expect(isVariableLengthOpcode(OpCode.Add)).toBe(false);
    expect(isVariableLengthOpcode(OpCode.Move)).toBe(false);
    expect(isVariableLengthOpcode(OpCode.Return)).toBe(false);
    expect(isVariableLengthOpcode(OpCode.LoadConst)).toBe(false);
    expect(isVariableLengthOpcode(OpCode.JmpIf)).toBe(false);
    expect(isVariableLengthOpcode(OpCode.Nop)).toBe(false);
  });
});

describe('isTerminator', () => {
  it('returns true for terminator opcodes', () => {
    expect(isTerminator(OpCode.Jmp)).toBe(true);
    expect(isTerminator(OpCode.JmpIf)).toBe(true);
    expect(isTerminator(OpCode.JmpIfNot)).toBe(true);
    expect(isTerminator(OpCode.Switch)).toBe(true);
    expect(isTerminator(OpCode.Return)).toBe(true);
    expect(isTerminator(OpCode.ReturnVoid)).toBe(true);
    expect(isTerminator(OpCode.TailCall)).toBe(true);
    expect(isTerminator(OpCode.Throw)).toBe(true);
    expect(isTerminator(OpCode.Yield)).toBe(true);
    expect(isTerminator(OpCode.YieldStar)).toBe(true);
    expect(isTerminator(OpCode.Await)).toBe(true);
    expect(isTerminator(OpCode.Halt)).toBe(true);
    expect(isTerminator(OpCode.Trap)).toBe(true);
  });

  it('returns false for non-terminator opcodes', () => {
    expect(isTerminator(OpCode.Add)).toBe(false);
    expect(isTerminator(OpCode.LoadConst)).toBe(false);
    expect(isTerminator(OpCode.Move)).toBe(false);
    expect(isTerminator(OpCode.Call)).toBe(false);
    expect(isTerminator(OpCode.PropGet)).toBe(false);
    expect(isTerminator(OpCode.Nop)).toBe(false);
  });
});
