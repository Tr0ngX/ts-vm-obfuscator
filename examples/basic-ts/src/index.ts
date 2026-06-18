/** @virtualize */
export function calculateSecretHash(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

/** @virtualize */
export function encryptTEA(v0: number, v1: number, k0: number, k1: number, k2: number, k3: number): number {
  console.log("DEBUG: Starting TEA Encryption block...");
  let sum = 0;
  const delta = 0x9e3779b9;
  for (let i = 0; i < 32; i++) {
    sum = (sum + delta) | 0;
    v0 = (v0 + (((v1 << 4) + k0) ^ (v1 + sum) ^ ((v1 >>> 5) + k1))) | 0;
    v1 = (v1 + (((v0 << 4) + k2) ^ (v0 + sum) ^ ((v0 >>> 5) + k3))) | 0;
  }
  console.log("DEBUG: TEA Encryption completed!");
  return (v0 ^ v1) | 0;
}

export function main() {
  console.log("Secret Hash:", calculateSecretHash("hello-world"));
  console.log("TEA Encrypted:", encryptTEA(12345, 67890, 1, 2, 3, 4));
}

/** @virtualize */
export function verifyArtemisCollatzAndMath(n: number, seed: number): number {
  if (n <= 0 || seed <= 0) return 0;
  let current = n;
  let iterations = 0;
  let accumulator = seed;

  while (current > 1 && iterations < 100) {
    if ((current % 2) === 0) {
      current = (current / 2) | 0;
    } else {
      current = ((current * 3) + 1) | 0;
    }
    
    accumulator = (accumulator ^ (current + iterations)) | 0;
    accumulator = (accumulator << 3) - accumulator + current;
    accumulator |= 0;
    iterations++;
  }

  return accumulator;
}

/** @virtualize */
export function verifyArtemisStateDecimation(key: string, multiplier: number, limit: number): number {
  if (!key || multiplier === 0) return -1;

  const telemetry: { [key: string]: any } = {
    status: 1,
    oxygen: 100,
    pressure: 1013,
    active: true,
    sensorData: [10, 20, 30, 40, 50]
  };

  telemetry[key] = (multiplier * 42) | 0;
  
  delete telemetry.active;
  delete telemetry.status;

  let score = 0;
  
  if (telemetry[key]) {
    score = (telemetry[key] + telemetry.pressure) | 0;
  } else {
    score = telemetry.pressure;
  }

  let idx = 0;
  while (idx < limit && idx < 5) {
    const baseValue = telemetry.sensorData[idx] as number;
    telemetry.sensorData[idx] = (baseValue * multiplier) | 0;
    score = (score + telemetry.sensorData[idx]) | 0;
    idx++;
  }

  return score;
}

/** @virtualize */
export function verifyArtemisGatingSystem(sensorA: number, sensorB: number, threshold: number): number {
  let criticalLevel = 0;

  if ((sensorA > threshold && sensorB > threshold) || ((sensorA + sensorB) > ((threshold * 2) | 0))) {
    if (sensorA === sensorB) {
      criticalLevel = 100;
    } else if (sensorA > sensorB) {
      criticalLevel = ((sensorA - sensorB) * 2) | 0;
    } else {
      criticalLevel = ((sensorB - sensorA) * 3) | 0;
    }
  } else if (sensorA < 0 || sensorB < 0) {
    criticalLevel = -999;
  } else {
    criticalLevel = (sensorA ^ sensorB) | 0;
  }

  return criticalLevel;
}

/** @virtualize */
export function verifyArtemisComputedDestructuring(key: string, value: number, defaultVal: number): any[] {
  const obj: any = { [key]: value, otherKey: 99 };
  const { [key]: extracted, otherKey, ...rest } = obj;
  let assigned;
  let fallback;
  ({ [key]: assigned, missingKey: fallback = defaultVal } = obj);
  return [extracted, otherKey, rest, assigned, fallback];
}

/** @virtualize */
export async function verifyArtemisAsyncLoop(count: number): Promise<number> {
  const asyncIterable: AsyncIterable<number> = {
    [Symbol.asyncIterator](): AsyncIterator<number> {
      let i = 1;
      return {
        async next(): Promise<IteratorResult<number>> {
          if (i <= count) {
            return { value: i++, done: false };
          }
          return { value: 0, done: true };
        }
      };
    }
  };

  let sum = 0;
  for await (const x of asyncIterable) {
    sum += x;
  }
  return sum;
}

/** @virtualize */
export function verifyArtemisDerivedClassAndSuper(): string {
  class BaseTelemetry {
    public value: number;
    constructor(val: number) {
      this.value = val;
    }
    getStatus() {
      return `Base:${this.value}`;
    }
  }

  class DerivedTelemetry extends BaseTelemetry {
    public bonus: number;
    static blockValue = 0;
    static {
      this.blockValue = 42;
    }
    constructor(val: number, bonus: number) {
      super(val);
      this.bonus = bonus;
    }
    getStatus() {
      return `Derived:${this.bonus}:${super.getStatus()}:${DerivedTelemetry.blockValue}`;
    }
  }

  const derived = new DerivedTelemetry(100, 200);
  return derived.getStatus();
}

/** @virtualize */
export function testConstructorParamProperties(tier: number, caseId: number, val1: any, val2: any): any {
  if (tier === 1) {
    if (caseId === 1) {
      class Basic {
        constructor(public x: number) {}
      }
      return new Basic(val1).x;
    }
    if (caseId === 2) {
      class Multi {
        constructor(private a: number, public b: string, readonly c: boolean) {}
        getValues() { return `${this.a}:${this.b}:${this.c}`; }
      }
      return new Multi(val1, val2, true).getValues();
    }
    if (caseId === 3) {
      class DefaultVal {
        constructor(public x: number = 42) {}
      }
      return new DefaultVal(val1 === undefined ? undefined : val1).x;
    }
    if (caseId === 4) {
      class Mixed {
        public z: string;
        constructor(public x: number, y: string) {
          this.z = y + "!";
        }
      }
      const instance = new Mixed(val1, val2);
      return `${instance.x}:${instance.z}`;
    }
    if (caseId === 5) {
      class Parent {
        constructor(public p: number) {}
      }
      class Child extends Parent {
        constructor(p: number, public c: string) {
          super(p);
        }
      }
      const inst = new Child(val1, val2);
      return `${inst.p}:${inst.c}`;
    }
  } else if (tier === 2) {
    if (caseId === 1) {
      class Empty {
        constructor(public x: number) {}
      }
      return new Empty(val1).x;
    }
    if (caseId === 2) {
      class Extreme {
        constructor(public x: number, public y: number) {}
      }
      return new Extreme(val1, val2).x + new Extreme(val1, val2).y;
    }
    if (caseId === 3) {
      class ComplexTypes {
        constructor(public arr: number[], public obj: { [key: string]: any }) {}
      }
      const inst = new ComplexTypes(val1, val2);
      return `${inst.arr.join(",")}:${inst.obj.key}`;
    }
    if (caseId === 4) {
      class Nullish {
        constructor(public x: any = null, public y: any = undefined) {}
      }
      const inst = new Nullish(val1, val2);
      return `${inst.x}:${inst.y}`;
    }
    if (caseId === 5) {
      class Shadow {
        constructor(public val1: number) {}
        getVal() {
          const val1 = 100;
          return this.val1 + val1;
        }
      }
      return new Shadow(val1).getVal();
    }
  }
  return null;
}

/** @virtualize */
export function testPrivateMethods(tier: number, caseId: number, val1: any, val2: any): any {
  if (tier === 1) {
    if (caseId === 1) {
      class Basic {
        #secret() { return 100; }
        public getSecret() { return this.#secret(); }
      }
      return new Basic().getSecret();
    }
    if (caseId === 2) {
      class Args {
        #add(a: number, b: number) { return a + b; }
        public run(x: number) { return this.#add(x, 10); }
      }
      return new Args().run(val1);
    }
    if (caseId === 3) {
      class Chain {
        #a() { return 5; }
        #b() { return this.#a() * 2; }
        public run() { return this.#b(); }
      }
      return new Chain().run();
    }
    if (caseId === 4) {
      class Outer {
        public run(x: number) {
          class Inner {
            #innerSecret() { return x * 2; }
            public get() { return this.#innerSecret(); }
          }
          return new Inner().get();
        }
      }
      return new Outer().run(val1);
    }
    if (caseId === 5) {
      class Parent {
        #secret() { return "parent"; }
        public test() { return this.#secret(); }
      }
      class Child extends Parent {
        #secret() { return "child"; }
        public testChild() { return this.#secret(); }
      }
      const c = new Child();
      return `${c.test()}:${c.testChild()}`;
    }
  } else if (tier === 2) {
    if (caseId === 1) {
      class Recursive {
        #fact(n: number): number {
          if (n <= 1) return 1;
          return n * this.#fact(n - 1);
        }
        public run(n: number) { return this.#fact(n); }
      }
      return new Recursive().run(val1);
    }
    if (caseId === 2) {
      class ArrowCtx {
        #privateVal() { return val1; }
        public run() {
          const fn = () => this.#privateVal();
          return fn();
        }
      }
      return new ArrowCtx().run();
    }
    if (caseId === 3) {
      class Nullish {
        #process(x: any) { return x === null ? "wasNull" : "notNull"; }
        public run(v: any) { return this.#process(v); }
      }
      return new Nullish().run(val1);
    }
    if (caseId === 4) {
      class ClosureReturn {
        #secret = val1;
        #get() { return this.#secret; }
        public run() {
          return () => this.#get();
        }
      }
      return new ClosureReturn().run()();
    }
    if (caseId === 5) {
      class Dynamic {
        #secret() { return 42; }
        public run() {
          const self = this as any;
          try {
            return self["#secret"]();
          } catch(e) {
            return "failed";
          }
        }
      }
      return new Dynamic().run();
    }
  }
  return null;
}

/** @virtualize */
export function testPrivateAccessors(tier: number, caseId: number, val1: any, val2: any): any {
  if (tier === 1) {
    if (caseId === 1) {
      class Basic {
        #val = 0;
        get #value() { return this.#val; }
        set #value(v: number) { this.#val = v; }
        public run(v: number) {
          this.#value = v;
          return this.#value;
        }
      }
      return new Basic().run(val1);
    }
    if (caseId === 2) {
      class GetterOnly {
        get #value() { return val1; }
        public run() { return this.#value; }
      }
      return new GetterOnly().run();
    }
    if (caseId === 3) {
      class SetterOnly {
        #store = "";
        set #value(v: string) { this.#store = v + "!"; }
        public run(v: string) {
          this.#value = v;
          return this.#store;
        }
      }
      return new SetterOnly().run(val1);
    }
    if (caseId === 4) {
      class Computed {
        #base = val1;
        get #multiplied() { return this.#base * 2; }
        set #multiplied(v: number) { this.#base = v / 2; }
        public run(v: number) {
          const prev = this.#multiplied;
          this.#multiplied = v;
          return `${prev}:${this.#base}`;
        }
      }
      return new Computed().run(val2);
    }
    if (caseId === 5) {
      class A {
        get #v() { return "A"; }
        public run() { return this.#v; }
      }
      class B {
        get #v() { return "B"; }
        public run() { return this.#v; }
      }
      return `${new A().run()}:${new B().run()}`;
    }
  } else if (tier === 2) {
    if (caseId === 1) {
      class Extreme {
        #val = 0;
        get #value() { return this.#val; }
        set #value(v: number) { this.#val = v; }
        public run(v: number) {
          this.#value = v;
          return this.#value;
        }
      }
      return new Extreme().run(val1);
    }
    if (caseId === 2) {
      class Validation {
        #val = 0;
        get #value() { return this.#val; }
        set #value(v: number) {
          if (v < 0) throw new Error("negative");
          this.#val = v;
        }
        public run(v: number) {
          try {
            this.#value = v;
            return "ok";
          } catch(e: any) {
            return e.message;
          }
        }
      }
      return new Validation().run(val1);
    }
    if (caseId === 3) {
      class SideEffects {
        public log = "";
        set #value(v: string) {
          this.log += v;
        }
        public run(v: string) {
          this.#value = v;
          this.#value = v;
          return this.log;
        }
      }
      return new SideEffects().run(val1);
    }
    if (caseId === 4) {
      class NoBacking {
        get #value() { return val1; }
        set #value(v: any) { /* no-op */ }
        public run() {
          this.#value = 100;
          return this.#value;
        }
      }
      return new NoBacking().run();
    }
    if (caseId === 5) {
      class ArrowAccessor {
        #x = 0;
        get #value() { return this.#x; }
        set #value(v: number) { this.#x = v; }
        public run(v: number) {
          const setVal = () => { this.#value = v; };
          const getVal = () => this.#value;
          setVal();
          return getVal();
        }
      }
      return new ArrowAccessor().run(val1);
    }
  }
  return null;
}

/** @virtualize */
export function testComplexSuperCalls(tier: number, caseId: number, val1: any, val2: any): any {
  class Base {
    constructor(public bVal: any) {}
    public getVal() { return this.bVal; }
  }

  if (tier === 1) {
    if (caseId === 1) {
      class Derived extends Base {
        public dVal: any;
        constructor(b: any, d: any) {
          super(b);
          const init = () => {
            this.dVal = d + ":" + super.getVal();
          };
          init();
        }
      }
      const inst = new Derived(val1, val2);
      return `${inst.getVal()}:${inst.dVal}`;
    }
    if (caseId === 2) {
      class DerivedClosure extends Base {
        public dVal: any;
        constructor(b: any, d: any) {
          super(b);
          const level1 = () => {
            const level2 = () => {
              this.dVal = d + ":" + super.getVal();
            };
            level2();
          };
          level1();
        }
      }
      const inst = new DerivedClosure(val1, val2);
      return `${inst.getVal()}:${inst.dVal}`;
    }
    if (caseId === 3) {
      class ParentStatic {
        static parentVal = 10;
      }
      class ChildStatic extends ParentStatic {
        static childVal = 0;
        static {
          this.childVal = this.parentVal + 32;
        }
      }
      return ChildStatic.childVal;
    }
    if (caseId === 4) {
      class ConditionalDerived extends Base {
        constructor(b: any) {
          if (b > 0) {
            super(b);
          } else {
            super(0);
          }
        }
      }
      return new ConditionalDerived(val1).getVal();
    }
    if (caseId === 5) {
      class Level1 extends Base {}
      class Level2 extends Level1 {
        constructor(b: any, public l2Val: any) {
          super(b);
        }
      }
      const inst = new Level2(val1, val2);
      return `${inst.getVal()}:${inst.l2Val}`;
    }
  } else if (tier === 2) {
    if (caseId === 1) {
      let counter = 0;
      class DerivedSide extends Base {
        constructor() {
          super(counter++);
        }
      }
      const inst1 = new DerivedSide();
      const inst2 = new DerivedSide();
      return `${inst1.getVal()}:${inst2.getVal()}`;
    }
    if (caseId === 2) {
      class DerivedArrowReturn extends Base {
        public dVal: any;
        constructor(b: any) {
          super(b);
          const f = () => {
            this.dVal = super.getVal() + "-arrow";
          };
          f();
        }
      }
      const inst = new DerivedArrowReturn(val1);
      return `${inst.getVal()}:${inst.dVal}`;
    }
    if (caseId === 3) {
      class BaseRest {
        public args: any[];
        constructor(...args: any[]) {
          this.args = args;
        }
      }
      class DerivedRest extends BaseRest {
        constructor(arr: any[]) {
          super(...arr);
        }
      }
      return new DerivedRest(val1).args.join(",");
    }
    if (caseId === 4) {
      try {
        class Faulty {
          static {
            throw new Error("static_fail");
          }
        }
        new Faulty();
        return "ok";
      } catch(e: any) {
        return e.message;
      }
    }
    if (caseId === 5) {
      const sym = Symbol("method");
      class BaseSym {
        [sym]() { return "base-sym"; }
      }
      class DerivedSym extends BaseSym {
        run() { return super[sym](); }
      }
      return new DerivedSym().run();
    }
  }
  return null;
}

/** @virtualize */
export function testComplexDestructuring(tier: number, caseId: number, val1: any, val2: any): any {
  if (tier === 1) {
    if (caseId === 1) {
      const obj = val1 ?? { a: { b: 2 } };
      const { a: { b, c = 10 } = { b: 0, c: 99 } } = obj;
      return `${b}:${c}`;
    }
    if (caseId === 2) {
      const arr = val1 ?? [1, [2]];
      const [x, [y, z = 3] = [0, 0]] = arr;
      return `${x}:${y}:${z}`;
    }
    if (caseId === 3) {
      const obj = val1 ?? { a: [1, 2] };
      const { a: [x, y, z = 100] = [] } = obj;
      return `${x}:${y}:${z}`;
    }
    if (caseId === 4) {
      const arr = val1 ?? [1, 2, 3];
      const [head, ...tail] = arr;
      const [first = 99] = tail;
      return `${head}:${first}`;
    }
    if (caseId === 5) {
      const key = "prop";
      const obj = { [key]: val1 };
      const { [key]: extracted = 42 } = obj;
      return extracted;
    }
  } else if (tier === 2) {
    if (caseId === 1) {
      const obj = {};
      const { a: { b = 1 } = {} } = obj as any;
      return b;
    }
    if (caseId === 2) {
      try {
        const obj: any = null;
        return obj.a;
      } catch(e: any) {
        return "throws";
      }
    }
    if (caseId === 3) {
      const x = 100;
      const obj = { x: val1 };
      const { x: y = x } = obj;
      return y;
    }
    if (caseId === 4) {
      let count = 0;
      const obj = { a: undefined };
      const { a = (count += 10) } = obj;
      return `${a}:${count}`;
    }
    if (caseId === 5) {
      const obj = { a: { b: { c: { d: val1 } } } };
      const { a: { b: { c: { d = 999 } = {} } = {} } = {} } = obj;
      return d;
    }
  }
  return null;
}

/** @virtualize */
export function testLoopHeaders(tier: number, caseId: number, val1: any, val2: any): any {
  if (tier === 1) {
    if (caseId === 1) {
      let sum = 0;
      for (const [a, b] of val1) {
        sum += a + b;
      }
      return sum;
    }
    if (caseId === 2) {
      let keys = "";
      for (const k in val1) {
        keys += k + ":" + val1[k] + ";";
      }
      return keys;
    }
    if (caseId === 3) {
      let out = "";
      for (const { a: { b } } of val1) {
        out += b;
      }
      return out;
    }
    if (caseId === 4) {
      let out = 0;
      for (let [x, y] of val1) {
        x += 1;
        out += x + y;
      }
      return out;
    }
    if (caseId === 5) {
      let out = "";
      for (const [head, ...tail] of val1) {
        out += head + "-" + tail.join(",") + ";";
      }
      return out;
    }
  } else if (tier === 2) {
    if (caseId === 1) {
      let count = 0;
      for (const x of []) {
        count++;
      }
      return count;
    }
    if (caseId === 2) {
      try {
        let count = 0;
        for (const x of (null as any)) {
          count++;
        }
        return count;
      } catch(e: any) {
        return "throws";
      }
    }
    if (caseId === 3) {
      const arr = [...val1];
      let sum = 0;
      for (const x of arr) {
        sum += x;
        if (x === 1) arr.push(10);
      }
      return sum;
    }
    if (caseId === 4) {
      const x = 100;
      let sum = 0;
      for (const x of val1) {
        sum += x;
      }
      return sum + x;
    }
    if (caseId === 5) {
      let sum = 0;
      for (const x of val1) {
        if (x === 2) continue;
        if (x === 4) break;
        sum += x;
      }
      return sum;
    }
  }
  return null;
}

/** @virtualize */
export function testReactHooksJSX(tier: number, caseId: number, val1: any, val2: any): any {
  if (tier === 1) {
    if (caseId === 1) {
      function useMyCustomHook(x: number) {
        return x + 10;
      }
      return useMyCustomHook(val1);
    }
    if (caseId === 2) {
      function MyComponentProvider() {
        return val1;
      }
      return MyComponentProvider();
    }
    if (caseId === 3) {
      function useCustomState() {
        return val1;
      }
      return useCustomState();
    }
    if (caseId === 4) {
      function MainContext() {
        return val1;
      }
      return MainContext();
    }
    if (caseId === 5) {
      function useQuery() {
        return val1;
      }
      return useQuery();
    }
  } else if (tier === 2) {
    if (caseId === 1) {
      function outer() {
        function useNested() { return val1; }
        return useNested();
      }
      return outer();
    }
    if (caseId === 2) {
      function useError() {
        throw new Error("hook_err");
      }
      try {
        return useError();
      } catch(e: any) {
        return e.message;
      }
    }
    if (caseId === 3) {
      function StateProvider() {
        return { state: val1 };
      }
      return StateProvider().state;
    }
    if (caseId === 4) {
      function useX() {
        return val1;
      }
      return useX();
    }
    if (caseId === 5) {
      function UserContextComponent() {
        return val1;
      }
      return UserContextComponent();
    }
  }
  return null;
}

/** @virtualize */
export function testVMBlockers(tier: number, caseId: number, val1: any, val2: any): any {
  if (tier === 1) {
    if (caseId === 1) {
      let x = val1;
      debugger;
      return x;
    }
    if (caseId === 2) {
      return (globalThis as any).testVMBlockerWith(val1);
    }
    if (caseId === 3) {
      const load = async () => {
        try {
          const m = await import("./custom-test.js");
          return m.testVal;
        } catch(e) {
          return val1;
        }
      };
      return load();
    }
    if (caseId === 4) {
      if (val1 > 0) {
        debugger;
      }
      return val1;
    }
    if (caseId === 5) {
      for (let i = 0; i < 1; i++) {
        debugger;
      }
      return val1;
    }
  } else if (tier === 2) {
    if (caseId === 1) {
      return (globalThis as any).testVMBlockerWith(val1);
    }
    if (caseId === 2) {
      try {
        debugger;
        return val1;
      } catch(e) {
        return val2;
      }
    }
    if (caseId === 3) {
      const load = async () => {
        try {
          throw new Error();
        } catch(e) {
          const m = await import("./custom-test.js");
          return m.testVal;
        }
      };
      return load();
    }
    if (caseId === 4) {
      let x = val1;
      debugger;
      x += (globalThis as any).testVMBlockerWith(val2);
      return x;
    }
    if (caseId === 5) {
      const fn = () => {
        debugger;
        return val1;
      };
      return fn();
    }
  }
  return null;
}

/** @virtualize */
export function testCrossFeatureCombinations(comboId: number, val1: any, val2: any): any {
  if (comboId === 1) {
    class Combo1 {
      constructor(public x: number, private y: number) {}
      #multiply() { return this.x * this.y; }
      public run() { return this.#multiply(); }
    }
    return new Combo1(val1, val2).run();
  }
  if (comboId === 2) {
    class Combo2 {
      constructor(private x: number) {}
      get #val() { return this.x + 10; }
      set #val(v: number) { this.x = v; }
      public run(v: number) {
        const prev = this.#val;
        this.#val = v;
        return `${prev}:${this.x}`;
      }
    }
    return new Combo2(val1).run(val2);
  }
  if (comboId === 3) {
    class Combo3 {
      #x = 0;
      get #value() { return this.#x; }
      set #value(v: number) { this.#x = v; }
      #add(v: number) { this.#value = this.#value + v; }
      public run(a: number, b: number) {
        this.#value = a;
        this.#add(b);
        return this.#value;
      }
    }
    return new Combo3().run(val1, val2);
  }
  if (comboId === 4) {
    class Base {
      constructor(public bVal: any) {}
      public runBase() { return "base:" + this.bVal; }
    }
    class Combo4 extends Base {
      #cVal = 100;
      #privateMethod() { return this.runBase() + ":" + this.#cVal; }
      public run() { return this.#privateMethod(); }
    }
    return new Combo4(val1).run();
  }
  if (comboId === 5) {
    class Base {
      constructor(public x: number, public y: string) {}
    }
    class Combo5 extends Base {
      constructor(obj: any) {
        const { x = 42, y: { z = "default" } = {} } = obj;
        super(x, z);
      }
    }
    const inst = new Combo5(val1);
    return `${inst.x}:${inst.y}`;
  }
  if (comboId === 6) {
    let sum = 0;
    for (const { a: [x = 10, y = 20] = [] } of val1) {
      sum += x + y;
    }
    return sum;
  }
  if (comboId === 7) {
    class Element {
      constructor(public id: number) {}
    }
    const list = [];
    for (const x of val1) {
      list.push(new Element(x).id);
    }
    return list.join(",");
  }
  if (comboId === 8) {
    class Base {
      constructor(public bVal: any) {}
    }
    class Combo8 extends Base {
      get #val() { return this.bVal + "!"; }
      set #val(v: any) { this.bVal = v; }
      public run(v: any) {
        const prev = this.#val;
        this.#val = v;
        return `${prev}:${this.bVal}`;
      }
    }
    return new Combo8(val1).run(val2);
  }
  return null;
}

/** @virtualize */
export function testRealWorldScenarios(scenarioId: number, val1: any, val2: any): any {
  if (scenarioId === 1) {
    class StateMachine {
      #history: string[] = [];
      #currState: string;

      constructor(public id: string, initialState: string) {
        this.#currState = initialState;
        this.#log(`Init state to ${initialState}`);
      }

      get #state() { return this.#currState; }
      set #state(s: string) {
        if (!s) throw new Error("Invalid state");
        this.#currState = s;
        this.#log(`Transition to ${s}`);
      }

      #log(msg: string) {
        this.#history.push(`[${this.id}] ${msg}`);
      }

      public process(actions: any[]) {
        for (const { type, payload = {} } of actions) {
          const { nextState } = payload;
          if (type === "TRANSITION" && nextState) {
            this.#state = nextState;
          }
        }
        return this.#history.join("; ");
      }
    }
    const sm = new StateMachine(val1, "IDLE");
    return sm.process(val2);
  }

  if (scenarioId === 2) {
    class PipelineStep {
      constructor(public name: string, public nextStep?: PipelineStep) {}
      public process(data: any): any {
        return this.nextStep ? this.nextStep.process(data) : data;
      }
    }

    class FilterStep extends PipelineStep {
      #threshold: number;
      constructor(name: string, threshold: number, next?: PipelineStep) {
        super(name, next);
        this.#threshold = threshold;
      }

      #isAbove(val: number) {
        return val > this.#threshold;
      }

      public process(data: number[]): number[] {
        const filtered = [];
        for (const item of data) {
          if (this.#isAbove(item)) {
            filtered.push(item);
          }
        }
        return super.process(filtered);
      }
    }

    const filter = new FilterStep("ThresholdFilter", val1);
    const step2 = new PipelineStep("LoggerStep");
    filter.nextStep = step2;
    return filter.process(val2).join(",");
  }

  if (scenarioId === 3) {
    class Container {
      #services = new Map<string, any>();
      #accessCount = 0;

      constructor(public env: string) {}

      get #count() { return this.#accessCount; }
      set #count(c: number) { this.#accessCount = c; }

      public register(name: string, service: any) {
        this.#services.set(name, service);
      }

      public resolve(names: string[]) {
        const resolved = {};
        for (const name of names) {
          this.#count = this.#count + 1;
          const service = this.#services.get(name) || { run: () => "default" };
          const { run } = service;
          (resolved as any)[name] = run();
        }
        return `${this.#count}:${JSON.stringify(resolved)}`;
      }
    }

    const c = new Container(val1);
    c.register("logger", { run: () => "logged" });
    c.register("db", { run: () => "connected" });
    return c.resolve(val2);
  }

  if (scenarioId === 4) {
    class Matrix {
      static defaultSize = 2;
      static {
        this.defaultSize = 3;
      }
      constructor(public size: number) {}
    }

    class Matrix3x3 extends Matrix {
      #data: number[][];
      constructor(data: number[][]) {
        super(3);
        this.#data = data;
      }

      #getDet2x2(a: number, b: number, c: number, d: number) {
        return a * d - b * c;
      }

      public getDeterminant() {
        const [[a, b, c], [d, e, f], [g, h, i]] = this.#data;
        const detA = a * this.#getDet2x2(e, f, h, i);
        const detB = b * this.#getDet2x2(d, f, g, i);
        const detC = c * this.#getDet2x2(d, e, g, h);
        return detA - detB + detC;
      }
    }

    const m = new Matrix3x3(val1);
    return m.getDeterminant();
  }

  if (scenarioId === 5) {
    class Element {
      constructor(public tag: string, public props: any) {}
    }

    class ComponentRenderer {
      #renderCount = 0;
      constructor(public name: string) {}

      #log(msg: string) {
        return `[${this.name}] ${msg}`;
      }

      public render(props: any): any {
        this.#renderCount++;
        debugger;
        const { children = [], useHook = false } = props;
        
        if (useHook) {
          const state = this.useStateSim();
          return `${this.#log("render")}:${state}`;
        }
        
        let out = "";
        for (const child of children) {
          const el = new Element("div", { child });
          out += el.tag + ":" + el.props.child + ";";
        }
        return out;
      }

      public useStateSim() {
        return "stateValue";
      }
    }

    const renderer = new ComponentRenderer(val1);
    return renderer.render(val2);
  }

  return null;
}

main();
