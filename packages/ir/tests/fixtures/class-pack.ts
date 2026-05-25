export function classPack(seed: number) {
  let computedCounter = 0;
  const makeKey = (prefix: string) => {
    computedCounter = computedCounter + 1;
    return `${prefix}${computedCounter}`;
  };

  const Local = class Named {
    static label = 'Named';
    static [makeKey('static')] = 7;

    value = seed + 1;
    ['field' + 1] = seed + 2;

    constructor(value: number) {
      this.value = value;
    }

    [makeKey('method')]() {
      return `${Named.label}:${this.value}:${this.field1}`;
    }

    get doubled() {
      return this.value * 2;
    }

    set doubled(next: number) {
      this.value = next / 2;
    }

    static describe() {
      return `${Named.label}:${Named.static1}`;
    }
  };

  const instance = new Local(seed + 3);
  instance.doubled = 20;
  return `${computedCounter}:${Local.describe()}:${instance.method2()}:${instance.doubled}`;
}
