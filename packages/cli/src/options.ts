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
