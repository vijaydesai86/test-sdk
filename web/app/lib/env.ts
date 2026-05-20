const PLACEHOLDER_PATTERNS = [
  /^your[_-]/i,
  /[_-]here$/i,
  /^placeholder$/i,
  /^changeme$/i,
  /^todo$/i,
  /^ghp_your_token_here$/i,
];

export function isPlaceholderEnvValue(value: string | undefined | null): boolean {
  const normalized = (value ?? '').trim();
  if (!normalized) return true;
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function getConfiguredEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return isPlaceholderEnvValue(value) ? undefined : value;
}

export function getConfiguredEnvAny(names: string[]): string | undefined {
  for (const name of names) {
    const value = getConfiguredEnv(name);
    if (value) return value;
  }
  return undefined;
}

export function hasConfiguredEnv(name: string): boolean {
  return Boolean(getConfiguredEnv(name));
}
