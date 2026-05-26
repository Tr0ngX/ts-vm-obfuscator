export const SUPPORTED_PROFILE_TARGETS = ['generic', 'react', 'electron', 'library', 'universal'] as const;
export type SupportedProfileTarget = (typeof SUPPORTED_PROFILE_TARGETS)[number];

const PROFILE_ALIASES: Record<string, SupportedProfileTarget> = {
  default: 'generic',
  generic: 'generic',
  react: 'react',
  electron: 'electron',
  library: 'library',
  universal: 'universal',
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

export function parseRuntimeBackend(runtimeOption?: string): 'js' | 'wasm_hybrid' {
  const normalized = (runtimeOption ?? 'js').trim().toLowerCase();
  if (normalized === 'js') {
    return 'js';
  }
  if (normalized === 'wasm-hybrid' || normalized === 'wasm_hybrid') {
    return 'wasm_hybrid';
  }
  throw new Error(`Unsupported runtime "${runtimeOption}". Expected one of: js, wasm-hybrid.`);
}

export function applyRuntimeBackendToProfile<T extends { vm: { runtimeBackend?: 'js' | 'wasm_hybrid' } }>(
  profile: T,
  runtimeBackend: 'js' | 'wasm_hybrid',
): T {
  return {
    ...profile,
    vm: {
      ...profile.vm,
      runtimeBackend,
    },
  };
}

export function parseRuntimeHardening(hardeningOption?: string): 'off' | 'stealth' | 'paranoid' {
  const normalized = (hardeningOption ?? 'stealth').trim().toLowerCase();
  if (normalized === 'off' || normalized === 'stealth' || normalized === 'paranoid') {
    return normalized;
  }
  throw new Error(`Unsupported hardening "${hardeningOption}". Expected one of: off, stealth, paranoid.`);
}

export function applyRuntimeHardeningToProfile<
  T extends {
    vm: {
      runtimeHardening?: 'off' | 'stealth' | 'paranoid';
      stealthDispatch?: boolean;
      tamperDetection?: boolean;
      antiDebug?: boolean;
      junkInsertion?: boolean;
      rollingKeys?: boolean;
    };
  },
>(profile: T, runtimeHardening: 'off' | 'stealth' | 'paranoid'): T {
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
