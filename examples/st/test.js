/* obf-test.js */
"use strict";

const SECRET_SEED = 0x9e3779b97f4a7c15n;

/** @virtualize */
function rotl32(x, r) {
  x >>>= 0;
  return ((x << r) | (x >>> (32 - r))) >>> 0;
}

/** @virtualize */
function fnv1a(str, seed = 0x811c9dc5) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function makeMixer(key) {
  const salt = fnv1a(key);
  let counter = 0;

  return function mix(input, rounds = 4) {
    let x = fnv1a(String(input), salt ^ counter++);
    for (let i = 0; i < rounds; i++) {
      x ^= rotl32(x, 7);
      x = Math.imul(x ^ 0x85ebca6b, 0xc2b2ae35) >>> 0;
      x ^= x >>> 16;
    }
    return x >>> 0;
  };
}

class TokenVault {
  #mix;
  #store = new Map();

  constructor(key) {
    this.#mix = makeMixer(key);
  }

  put(name, value) {
    const id = this.#mix(name + ":" + value).toString(16);
    this.#store.set(id, { name, value, at: Date.now() });
    return id;
  }

  get(id) {
    return this.#store.get(id)?.value ?? null;
  }

  *entries() {
    for (const [id, item] of this.#store) {
      yield [id, item.name, item.value];
    }
  }
}

function createStateMachine(rules) {
  let state = "INIT";

  return {
    step(event) {
      const next = rules[state]?.[event] ?? "ERROR";
      state = next;
      return state;
    },
    get state() {
      return state;
    }
  };
}

async function fakeRemoteScore(payload) {
  await new Promise(r => setTimeout(r, 5));

  const normalized = payload
    .trim()
    .replace(/\s+/g, "_")
    .toLowerCase();

  return fnv1a(normalized) % 10_000;
}

function parseCommand(cmd = "") {
  const match = /^(?<action>[a-z]+):(?<target>[a-z0-9_-]+)(?:#(?<flag>\w+))?$/i.exec(cmd);
  if (!match?.groups) return null;

  const { action, target, flag = "none" } = match.groups;
  return { action, target, flag };
}

function guardedCompute(input, options = {}) {
  const {
    rounds = 3,
    prefix = "tx",
    strict = true,
    transform = x => x
  } = options;

  if (strict && typeof input !== "string") {
    throw new TypeError("input must be string");
  }

  let acc = 0x12345678;
  const chars = [...String(input)];

  for (const [i, ch] of chars.entries()) {
    const code = ch.codePointAt(0) ?? 0;
    acc ^= rotl32(code + i + rounds, i % 13);
    acc = Math.imul(acc, 2654435761) >>> 0;
  }

  return `${prefix}_${transform(acc.toString(36))}`;
}

const api = new Proxy(
  {
    version: "1.0.0",
    vault: new TokenVault("demo-key")
  },
  {
    get(target, prop, receiver) {
      if (prop === "signature") {
        return fnv1a(target.version + ":" + target.vault.constructor.name).toString(16);
      }
      return Reflect.get(target, prop, receiver);
    }
  }
);

async function main() {
  const commands = [
    "login:user_01#fast",
    "read:profile",
    "write:cache#safe",
    "bad command"
  ];

  const sm = createStateMachine({
    INIT: { login: "AUTHED" },
    AUTHED: { read: "READING", write: "WRITING" },
    READING: { write: "WRITING" },
    WRITING: { read: "READING" },
    ERROR: {}
  });

  const results = [];

  for (const cmd of commands) {
    const parsed = parseCommand(cmd);

    if (!parsed) {
      results.push({ cmd, ok: false, reason: "parse_failed" });
      continue;
    }

    const id = api.vault.put(parsed.target, parsed.flag);
    const score = await fakeRemoteScore(`${parsed.action}:${parsed.target}:${id}`);
    const token = guardedCompute(parsed.target, {
      rounds: parsed.flag === "fast" ? 2 : 5,
      prefix: parsed.action,
      transform: s => s.split("").reverse().join("")
    });

    results.push({
      cmd,
      state: sm.step(parsed.action),
      id,
      token,
      score,
      sig: api.signature
    });
  }

  const bigintCheck =
    (SECRET_SEED ^ BigInt(results.length)) * 0x100000001b3n;

  return {
    ok: true,
    count: results.length,
    checksum: fnv1a(JSON.stringify(results)).toString(16),
    bigintTail: bigintCheck.toString(16).slice(-12),
    vaultDump: [...api.vault.entries()],
    results
  };
}

main()
  .then(out => console.log(JSON.stringify(out, null, 2)))
  .catch(err => console.error("ERR:", err));