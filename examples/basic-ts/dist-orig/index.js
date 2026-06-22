"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateSecretHash = calculateSecretHash;
exports.encryptTEA = encryptTEA;
exports.main = main;
exports.verifyArtemisCollatzAndMath = verifyArtemisCollatzAndMath;
exports.verifyArtemisStateDecimation = verifyArtemisStateDecimation;
exports.verifyArtemisGatingSystem = verifyArtemisGatingSystem;
exports.verifyArtemisComputedDestructuring = verifyArtemisComputedDestructuring;
exports.verifyArtemisAsyncLoop = verifyArtemisAsyncLoop;
exports.verifyArtemisDerivedClassAndSuper = verifyArtemisDerivedClassAndSuper;
exports.testConstructorParamProperties = testConstructorParamProperties;
exports.testPrivateMethods = testPrivateMethods;
exports.testPrivateAccessors = testPrivateAccessors;
exports.testComplexSuperCalls = testComplexSuperCalls;
exports.testComplexDestructuring = testComplexDestructuring;
exports.testLoopHeaders = testLoopHeaders;
exports.testReactHooksJSX = testReactHooksJSX;
exports.testVMBlockers = testVMBlockers;
exports.testCrossFeatureCombinations = testCrossFeatureCombinations;
exports.testRealWorldScenarios = testRealWorldScenarios;
/** @virtualize */
function calculateSecretHash(input) {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
        hash = (hash << 5) - hash + input.charCodeAt(i);
        hash |= 0;
    }
    return hash;
}
/** @virtualize */
function encryptTEA(v0, v1, k0, k1, k2, k3) {
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
function main() {
    console.log("Secret Hash:", calculateSecretHash("hello-world"));
    console.log("TEA Encrypted:", encryptTEA(12345, 67890, 1, 2, 3, 4));
}
/** @virtualize */
function verifyArtemisCollatzAndMath(n, seed) {
    if (n <= 0 || seed <= 0)
        return 0;
    let current = n;
    let iterations = 0;
    let accumulator = seed;
    while (current > 1 && iterations < 100) {
        if ((current % 2) === 0) {
            current = (current / 2) | 0;
        }
        else {
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
function verifyArtemisStateDecimation(key, multiplier, limit) {
    if (!key || multiplier === 0)
        return -1;
    const telemetry = {
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
    }
    else {
        score = telemetry.pressure;
    }
    let idx = 0;
    while (idx < limit && idx < 5) {
        const baseValue = telemetry.sensorData[idx];
        telemetry.sensorData[idx] = (baseValue * multiplier) | 0;
        score = (score + telemetry.sensorData[idx]) | 0;
        idx++;
    }
    return score;
}
/** @virtualize */
function verifyArtemisGatingSystem(sensorA, sensorB, threshold) {
    let criticalLevel = 0;
    if ((sensorA > threshold && sensorB > threshold) || ((sensorA + sensorB) > ((threshold * 2) | 0))) {
        if (sensorA === sensorB) {
            criticalLevel = 100;
        }
        else if (sensorA > sensorB) {
            criticalLevel = ((sensorA - sensorB) * 2) | 0;
        }
        else {
            criticalLevel = ((sensorB - sensorA) * 3) | 0;
        }
    }
    else if (sensorA < 0 || sensorB < 0) {
        criticalLevel = -999;
    }
    else {
        criticalLevel = (sensorA ^ sensorB) | 0;
    }
    return criticalLevel;
}
/** @virtualize */
function verifyArtemisComputedDestructuring(key, value, defaultVal) {
    const obj = { [key]: value, otherKey: 99 };
    const { [key]: extracted, otherKey, ...rest } = obj;
    let assigned;
    let fallback;
    ({ [key]: assigned, missingKey: fallback = defaultVal } = obj);
    return [extracted, otherKey, rest, assigned, fallback];
}
/** @virtualize */
async function verifyArtemisAsyncLoop(count) {
    const asyncIterable = {
        [Symbol.asyncIterator]() {
            let i = 1;
            return {
                async next() {
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
function verifyArtemisDerivedClassAndSuper() {
    class BaseTelemetry {
        value;
        constructor(val) {
            this.value = val;
        }
        getStatus() {
            return `Base:${this.value}`;
        }
    }
    class DerivedTelemetry extends BaseTelemetry {
        bonus;
        static blockValue = 0;
        static {
            this.blockValue = 42;
        }
        constructor(val, bonus) {
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
function testConstructorParamProperties(tier, caseId, val1, val2) {
    if (tier === 1) {
        if (caseId === 1) {
            class Basic {
                x;
                constructor(x) {
                    this.x = x;
                }
            }
            return new Basic(val1).x;
        }
        if (caseId === 2) {
            class Multi {
                a;
                b;
                c;
                constructor(a, b, c) {
                    this.a = a;
                    this.b = b;
                    this.c = c;
                }
                getValues() { return `${this.a}:${this.b}:${this.c}`; }
            }
            return new Multi(val1, val2, true).getValues();
        }
        if (caseId === 3) {
            class DefaultVal {
                x;
                constructor(x = 42) {
                    this.x = x;
                }
            }
            return new DefaultVal(val1 === undefined ? undefined : val1).x;
        }
        if (caseId === 4) {
            class Mixed {
                x;
                z;
                constructor(x, y) {
                    this.x = x;
                    this.z = y + "!";
                }
            }
            const instance = new Mixed(val1, val2);
            return `${instance.x}:${instance.z}`;
        }
        if (caseId === 5) {
            class Parent {
                p;
                constructor(p) {
                    this.p = p;
                }
            }
            class Child extends Parent {
                c;
                constructor(p, c) {
                    super(p);
                    this.c = c;
                }
            }
            const inst = new Child(val1, val2);
            return `${inst.p}:${inst.c}`;
        }
    }
    else if (tier === 2) {
        if (caseId === 1) {
            class Empty {
                x;
                constructor(x) {
                    this.x = x;
                }
            }
            return new Empty(val1).x;
        }
        if (caseId === 2) {
            class Extreme {
                x;
                y;
                constructor(x, y) {
                    this.x = x;
                    this.y = y;
                }
            }
            return new Extreme(val1, val2).x + new Extreme(val1, val2).y;
        }
        if (caseId === 3) {
            class ComplexTypes {
                arr;
                obj;
                constructor(arr, obj) {
                    this.arr = arr;
                    this.obj = obj;
                }
            }
            const inst = new ComplexTypes(val1, val2);
            return `${inst.arr.join(",")}:${inst.obj.key}`;
        }
        if (caseId === 4) {
            class Nullish {
                x;
                y;
                constructor(x = null, y = undefined) {
                    this.x = x;
                    this.y = y;
                }
            }
            const inst = new Nullish(val1, val2);
            return `${inst.x}:${inst.y}`;
        }
        if (caseId === 5) {
            class Shadow {
                val1;
                constructor(val1) {
                    this.val1 = val1;
                }
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
function testPrivateMethods(tier, caseId, val1, val2) {
    if (tier === 1) {
        if (caseId === 1) {
            class Basic {
                #secret() { return 100; }
                getSecret() { return this.#secret(); }
            }
            return new Basic().getSecret();
        }
        if (caseId === 2) {
            class Args {
                #add(a, b) { return a + b; }
                run(x) { return this.#add(x, 10); }
            }
            return new Args().run(val1);
        }
        if (caseId === 3) {
            class Chain {
                #a() { return 5; }
                #b() { return this.#a() * 2; }
                run() { return this.#b(); }
            }
            return new Chain().run();
        }
        if (caseId === 4) {
            class Outer {
                run(x) {
                    class Inner {
                        #innerSecret() { return x * 2; }
                        get() { return this.#innerSecret(); }
                    }
                    return new Inner().get();
                }
            }
            return new Outer().run(val1);
        }
        if (caseId === 5) {
            class Parent {
                #secret() { return "parent"; }
                test() { return this.#secret(); }
            }
            class Child extends Parent {
                #secret() { return "child"; }
                testChild() { return this.#secret(); }
            }
            const c = new Child();
            return `${c.test()}:${c.testChild()}`;
        }
    }
    else if (tier === 2) {
        if (caseId === 1) {
            class Recursive {
                #fact(n) {
                    if (n <= 1)
                        return 1;
                    return n * this.#fact(n - 1);
                }
                run(n) { return this.#fact(n); }
            }
            return new Recursive().run(val1);
        }
        if (caseId === 2) {
            class ArrowCtx {
                #privateVal() { return val1; }
                run() {
                    const fn = () => this.#privateVal();
                    return fn();
                }
            }
            return new ArrowCtx().run();
        }
        if (caseId === 3) {
            class Nullish {
                #process(x) { return x === null ? "wasNull" : "notNull"; }
                run(v) { return this.#process(v); }
            }
            return new Nullish().run(val1);
        }
        if (caseId === 4) {
            class ClosureReturn {
                #secret = val1;
                #get() { return this.#secret; }
                run() {
                    return () => this.#get();
                }
            }
            return new ClosureReturn().run()();
        }
        if (caseId === 5) {
            class Dynamic {
                #secret() { return 42; }
                run() {
                    const self = this;
                    try {
                        return self["#secret"]();
                    }
                    catch (e) {
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
function testPrivateAccessors(tier, caseId, val1, val2) {
    if (tier === 1) {
        if (caseId === 1) {
            class Basic {
                #val = 0;
                get #value() { return this.#val; }
                set #value(v) { this.#val = v; }
                run(v) {
                    this.#value = v;
                    return this.#value;
                }
            }
            return new Basic().run(val1);
        }
        if (caseId === 2) {
            class GetterOnly {
                get #value() { return val1; }
                run() { return this.#value; }
            }
            return new GetterOnly().run();
        }
        if (caseId === 3) {
            class SetterOnly {
                #store = "";
                set #value(v) { this.#store = v + "!"; }
                run(v) {
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
                set #multiplied(v) { this.#base = v / 2; }
                run(v) {
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
                run() { return this.#v; }
            }
            class B {
                get #v() { return "B"; }
                run() { return this.#v; }
            }
            return `${new A().run()}:${new B().run()}`;
        }
    }
    else if (tier === 2) {
        if (caseId === 1) {
            class Extreme {
                #val = 0;
                get #value() { return this.#val; }
                set #value(v) { this.#val = v; }
                run(v) {
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
                set #value(v) {
                    if (v < 0)
                        throw new Error("negative");
                    this.#val = v;
                }
                run(v) {
                    try {
                        this.#value = v;
                        return "ok";
                    }
                    catch (e) {
                        return e.message;
                    }
                }
            }
            return new Validation().run(val1);
        }
        if (caseId === 3) {
            class SideEffects {
                log = "";
                set #value(v) {
                    this.log += v;
                }
                run(v) {
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
                set #value(v) { }
                run() {
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
                set #value(v) { this.#x = v; }
                run(v) {
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
function testComplexSuperCalls(tier, caseId, val1, val2) {
    class Base {
        bVal;
        constructor(bVal) {
            this.bVal = bVal;
        }
        getVal() { return this.bVal; }
    }
    if (tier === 1) {
        if (caseId === 1) {
            class Derived extends Base {
                dVal;
                constructor(b, d) {
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
                dVal;
                constructor(b, d) {
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
                constructor(b) {
                    if (b > 0) {
                        super(b);
                    }
                    else {
                        super(0);
                    }
                }
            }
            return new ConditionalDerived(val1).getVal();
        }
        if (caseId === 5) {
            class Level1 extends Base {
            }
            class Level2 extends Level1 {
                l2Val;
                constructor(b, l2Val) {
                    super(b);
                    this.l2Val = l2Val;
                }
            }
            const inst = new Level2(val1, val2);
            return `${inst.getVal()}:${inst.l2Val}`;
        }
    }
    else if (tier === 2) {
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
                dVal;
                constructor(b) {
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
                args;
                constructor(...args) {
                    this.args = args;
                }
            }
            class DerivedRest extends BaseRest {
                constructor(arr) {
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
            }
            catch (e) {
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
function testComplexDestructuring(tier, caseId, val1, val2) {
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
    }
    else if (tier === 2) {
        if (caseId === 1) {
            const obj = {};
            const { a: { b = 1 } = {} } = obj;
            return b;
        }
        if (caseId === 2) {
            try {
                const obj = null;
                return obj.a;
            }
            catch (e) {
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
function testLoopHeaders(tier, caseId, val1, val2) {
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
    }
    else if (tier === 2) {
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
                for (const x of null) {
                    count++;
                }
                return count;
            }
            catch (e) {
                return "throws";
            }
        }
        if (caseId === 3) {
            const arr = [...val1];
            let sum = 0;
            for (const x of arr) {
                sum += x;
                if (x === 1)
                    arr.push(10);
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
                if (x === 2)
                    continue;
                if (x === 4)
                    break;
                sum += x;
            }
            return sum;
        }
    }
    return null;
}
/** @virtualize */
function testReactHooksJSX(tier, caseId, val1, val2) {
    if (tier === 1) {
        if (caseId === 1) {
            function useMyCustomHook(x) {
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
    }
    else if (tier === 2) {
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
            }
            catch (e) {
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
function testVMBlockers(tier, caseId, val1, val2) {
    if (tier === 1) {
        if (caseId === 1) {
            let x = val1;
            debugger;
            return x;
        }
        if (caseId === 2) {
            return globalThis.testVMBlockerWith(val1);
        }
        if (caseId === 3) {
            const load = async () => {
                try {
                    const m = await Promise.resolve().then(() => require("./custom-test.js"));
                    return m.testVal;
                }
                catch (e) {
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
    }
    else if (tier === 2) {
        if (caseId === 1) {
            return globalThis.testVMBlockerWith(val1);
        }
        if (caseId === 2) {
            try {
                debugger;
                return val1;
            }
            catch (e) {
                return val2;
            }
        }
        if (caseId === 3) {
            const load = async () => {
                try {
                    throw new Error();
                }
                catch (e) {
                    const m = await Promise.resolve().then(() => require("./custom-test.js"));
                    return m.testVal;
                }
            };
            return load();
        }
        if (caseId === 4) {
            let x = val1;
            debugger;
            x += globalThis.testVMBlockerWith(val2);
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
function testCrossFeatureCombinations(comboId, val1, val2) {
    if (comboId === 1) {
        class Combo1 {
            x;
            y;
            constructor(x, y) {
                this.x = x;
                this.y = y;
            }
            #multiply() { return this.x * this.y; }
            run() { return this.#multiply(); }
        }
        return new Combo1(val1, val2).run();
    }
    if (comboId === 2) {
        class Combo2 {
            x;
            constructor(x) {
                this.x = x;
            }
            get #val() { return this.x + 10; }
            set #val(v) { this.x = v; }
            run(v) {
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
            set #value(v) { this.#x = v; }
            #add(v) { this.#value = this.#value + v; }
            run(a, b) {
                this.#value = a;
                this.#add(b);
                return this.#value;
            }
        }
        return new Combo3().run(val1, val2);
    }
    if (comboId === 4) {
        class Base {
            bVal;
            constructor(bVal) {
                this.bVal = bVal;
            }
            runBase() { return "base:" + this.bVal; }
        }
        class Combo4 extends Base {
            #cVal = 100;
            #privateMethod() { return this.runBase() + ":" + this.#cVal; }
            run() { return this.#privateMethod(); }
        }
        return new Combo4(val1).run();
    }
    if (comboId === 5) {
        class Base {
            x;
            y;
            constructor(x, y) {
                this.x = x;
                this.y = y;
            }
        }
        class Combo5 extends Base {
            constructor(obj) {
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
            id;
            constructor(id) {
                this.id = id;
            }
        }
        const list = [];
        for (const x of val1) {
            list.push(new Element(x).id);
        }
        return list.join(",");
    }
    if (comboId === 8) {
        class Base {
            bVal;
            constructor(bVal) {
                this.bVal = bVal;
            }
        }
        class Combo8 extends Base {
            get #val() { return this.bVal + "!"; }
            set #val(v) { this.bVal = v; }
            run(v) {
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
function testRealWorldScenarios(scenarioId, val1, val2) {
    if (scenarioId === 1) {
        class StateMachine {
            id;
            #history = [];
            #currState;
            constructor(id, initialState) {
                this.id = id;
                this.#currState = initialState;
                this.#log(`Init state to ${initialState}`);
            }
            get #state() { return this.#currState; }
            set #state(s) {
                if (!s)
                    throw new Error("Invalid state");
                this.#currState = s;
                this.#log(`Transition to ${s}`);
            }
            #log(msg) {
                this.#history.push(`[${this.id}] ${msg}`);
            }
            process(actions) {
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
            name;
            nextStep;
            constructor(name, nextStep) {
                this.name = name;
                this.nextStep = nextStep;
            }
            process(data) {
                return this.nextStep ? this.nextStep.process(data) : data;
            }
        }
        class FilterStep extends PipelineStep {
            #threshold;
            constructor(name, threshold, next) {
                super(name, next);
                this.#threshold = threshold;
            }
            #isAbove(val) {
                return val > this.#threshold;
            }
            process(data) {
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
            env;
            #services = new Map();
            #accessCount = 0;
            constructor(env) {
                this.env = env;
            }
            get #count() { return this.#accessCount; }
            set #count(c) { this.#accessCount = c; }
            register(name, service) {
                this.#services.set(name, service);
            }
            resolve(names) {
                const resolved = {};
                for (const name of names) {
                    this.#count = this.#count + 1;
                    const service = this.#services.get(name) || { run: () => "default" };
                    const { run } = service;
                    resolved[name] = run();
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
            size;
            static defaultSize = 2;
            static {
                this.defaultSize = 3;
            }
            constructor(size) {
                this.size = size;
            }
        }
        class Matrix3x3 extends Matrix {
            #data;
            constructor(data) {
                super(3);
                this.#data = data;
            }
            #getDet2x2(a, b, c, d) {
                return a * d - b * c;
            }
            getDeterminant() {
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
            tag;
            props;
            constructor(tag, props) {
                this.tag = tag;
                this.props = props;
            }
        }
        class ComponentRenderer {
            name;
            #renderCount = 0;
            constructor(name) {
                this.name = name;
            }
            #log(msg) {
                return `[${this.name}] ${msg}`;
            }
            render(props) {
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
            useStateSim() {
                return "stateValue";
            }
        }
        const renderer = new ComponentRenderer(val1);
        return renderer.render(val2);
    }
    return null;
}
main();
