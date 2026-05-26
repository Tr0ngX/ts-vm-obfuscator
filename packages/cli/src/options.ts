export const SUPPORTED_PROFILE_TARGETS = ['generic', 'react', 'electron', 'library', 'universal'] as const;
export type SupportedProfileTarget = (typeof SUPPORTED_PROFILE_TARGETS)[number];
export const SUPPORTED_RUNTIME_BACKENDS = ['js', 'wasm-hybrid'] as const;
export type SupportedRuntimeBackend = 'js' | 'wasm_hybrid';
export const SUPPORTED_HARDENING_LEVELS = ['off', 'stealth', 'paranoid'] as const;
export type SupportedRuntimeHardening = (typeof SUPPORTED_HARDENING_LEVELS)[number];

const PROFILE_ALIASES: Record<string, SupportedProfileTarget> = {
  default: 'generic',
  generic: 'generic',
  react: 'react',
  electron: 'electron',
  library: 'library',
  universal: 'universal',
};

const RUNTIME_ALIASES: Record<string, SupportedRuntimeBackend> = {
  js: 'js',
  javascript: 'js',
  default: 'js',
  wasm: 'wasm_hybrid',
  hybrid: 'wasm_hybrid',
  'wasm-hybrid': 'wasm_hybrid',
  wasm_hybrid: 'wasm_hybrid',
};

const HARDENING_ALIASES: Record<string, SupportedRuntimeHardening> = {
  off: 'off',
  none: 'off',
  debug: 'off',
  plain: 'off',
  false: 'off',
  stealth: 'stealth',
  default: 'stealth',
  balanced: 'stealth',
  true: 'stealth',
  paranoid: 'paranoid',
  strict: 'paranoid',
  max: 'paranoid',
  maximum: 'paranoid',
};

export function parseSeed(seedOption?: string): number {
  if (seedOption === undefined) {
    return Math.floor(Math.random() * 1_000_000);
  }

  const seed = Number.parseInt(seedOption, 10);
  if (!Number.isInteger(seed)) {
    throw new Error(`Invalid seed "${seedOption}". Expected an integer.`);
  }

  return seed;
}

export function resolveProfileTarget(profileOption: string): SupportedProfileTarget {
  const normalized = profileOption.trim().toLowerCase();
  const target = PROFILE_ALIASES[normalized];

  if (!target) {
    throw new Error(
      `Unsupported profile "${profileOption}". Expected one of: default, ${SUPPORTED_PROFILE_TARGETS.join(', ')}.`,
    );
  }

  return target;
}

export function applySeedToProfile<T extends { seed: number; vm: { seed: number } }>(profile: T, seed: number): T {
  return {
    ...profile,
    seed,
    vm: {
      ...profile.vm,
      seed,
    },
  };
}

export function parseRuntimeBackend(runtimeOption?: string): SupportedRuntimeBackend {
  const normalized = (runtimeOption ?? 'js').trim().toLowerCase();
  const runtimeBackend = RUNTIME_ALIASES[normalized];
  if (runtimeBackend) {
    return runtimeBackend;
  }
  throw new Error(
    `Unsupported runtime "${runtimeOption}". Expected one of: ${SUPPORTED_RUNTIME_BACKENDS.join(', ')}.`,
  );
}

export function applyRuntimeBackendToProfile<T extends { vm: { runtimeBackend?: SupportedRuntimeBackend } }>(
  profile: T,
  runtimeBackend: SupportedRuntimeBackend,
): T {
  return {
    ...profile,
    vm: {
      ...profile.vm,
      runtimeBackend,
    },
  };
}

export function parseRuntimeHardening(hardeningOption?: string): SupportedRuntimeHardening {
  const normalized = (hardeningOption ?? 'stealth').trim().toLowerCase();
  const runtimeHardening = HARDENING_ALIASES[normalized];
  if (runtimeHardening) {
    return runtimeHardening;
  }
  throw new Error(
    `Unsupported hardening "${hardeningOption}". Expected one of: ${SUPPORTED_HARDENING_LEVELS.join(', ')}.`,
  );
}

export function resolveRuntimeHardening(
  hardeningOption?: string,
  flags: { readonly debugVm?: boolean; readonly paranoid?: boolean } = {},
): SupportedRuntimeHardening {
  if (flags.debugVm && flags.paranoid) {
    throw new Error('Conflicting VM hardening options: --debug-vm cannot be used with --paranoid.');
  }
  if (flags.debugVm) {
    return 'off';
  }
  if (flags.paranoid) {
    return 'paranoid';
  }
  return parseRuntimeHardening(hardeningOption);
}

export function applyRuntimeHardeningToProfile<
  T extends {
    vm: {
      runtimeHardening?: SupportedRuntimeHardening;
      stealthDispatch?: boolean;
      tamperDetection?: boolean;
      antiDebug?: boolean;
      junkInsertion?: boolean;
      rollingKeys?: boolean;
    };
  },
>(profile: T, runtimeHardening: SupportedRuntimeHardening): T {
  const enabled = runtimeHardening !== 'off';
  return {
    ...profile,
    vm: {
      ...profile.vm,
      runtimeHardening,
      stealthDispatch: enabled,
      tamperDetection: enabled,
      antiDebug: runtimeHardening === 'paranoid',
      junkInsertion: enabled,
      rollingKeys: profile.vm.rollingKeys ?? false,
    },
  };
}
