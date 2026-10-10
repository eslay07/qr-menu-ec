export function releaseCompatibilityFlags(existing, publicFetch) {
  if (![undefined, 'false', 'true'].includes(publicFetch)) throw Error('Invalid public fetch opt-in');
  if (!Array.isArray(existing) || existing.some(flag => typeof flag !== 'string')) throw Error('Invalid existing runtime flags');
  if (publicFetch !== 'true') return [...existing];
  return [...new Set([...existing, 'global_fetch_strictly_public'])];
}
