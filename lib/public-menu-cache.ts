import type { Stored } from './store';

// Published menu only. Never put Auth, owner sessions or a draft in this cache.
export class PublicMenuCache {
  private entries = new Map<string, { expires: number; value: Stored | null }>();
  private pending = new Map<string, Promise<Stored | null>>();
  private generations = new Map<string, number>();
  constructor(private ttl = 30_000, private capacity = 100) {}
  invalidate(id: string) {
    this.entries.delete(id);
    if (this.pending.has(id)) this.generations.set(id, (this.generations.get(id) || 0) + 1);
    else this.generations.delete(id);
  }
  async read(id: string, load: () => Promise<Stored | null>) {
    const cached = this.entries.get(id);
    if (cached && cached.expires > Date.now()) return structuredClone(cached.value);
    const existing = this.pending.get(id);
    if (existing) return structuredClone(await existing);
    const generation = this.generations.get(id) || 0;
    const pending = load().then(value => {
      if (value?.state.security || value?.state.recoveryHash || value?.state.password.hash || value?.state.draft.dishes.length)
        throw Error('Private state is forbidden in the public menu cache.');
      if ((this.generations.get(id) || 0) === generation) {
        if (this.entries.size >= this.capacity) this.entries.delete(this.entries.keys().next().value!);
        this.entries.set(id, { expires: Date.now() + this.ttl, value: structuredClone(value) });
      }
      return value;
    }).finally(() => { this.pending.delete(id); this.generations.delete(id); });
    this.pending.set(id, pending);
    return structuredClone(await pending);
  }
}
