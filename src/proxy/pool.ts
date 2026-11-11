import { EventEmitter } from 'node:events';
import type { Proxy } from '../domain/types.js';

export interface ProxyPoolConfig {
  resetTimeoutMs: number;
  resetMaxRetries: number;
  postResetSettleMs: number;
}

export type ResetFn = (proxy: Proxy) => Promise<void>;

async function defaultResetFn(proxy: Proxy): Promise<void> {
  if (!proxy.changeIpUrl) {
    throw new Error(`Proxy ${proxy.label} has no changeIpUrl configured`);
  }
  const res = await fetch(proxy.changeIpUrl);
  if (!res.ok) {
    throw new Error(`changeIpUrl for ${proxy.label} returned HTTP ${res.status}`);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * Owns the full lifecycle and the double-assignment invariant for the
 * shared proxy pool. A proxy only ever becomes `in_use` immediately after a
 * freshly completed reset — never reused with its previous IP, never handed
 * to two open profiles at once. All 10 proxies (8 "primary" + 2 spare) are
 * treated identically; there is no special-cased spare behavior.
 */
export class ProxyPool extends EventEmitter {
  private readonly proxies: Map<string, Proxy>;

  constructor(
    initial: Proxy[],
    private readonly config: ProxyPoolConfig,
    private readonly resetFn: ResetFn = defaultResetFn,
  ) {
    super();
    this.proxies = new Map(initial.map((p) => [p.id, { ...p }]));
  }

  list(): Proxy[] {
    return [...this.proxies.values()].map((p) => ({ ...p }));
  }

  get(id: string): Proxy | undefined {
    const p = this.proxies.get(id);
    return p ? { ...p } : undefined;
  }

  /** True if at least one proxy is usable right now or will free up. */
  hasAnyActiveProxy(): boolean {
    return [...this.proxies.values()].some((p) => p.status !== 'dead');
  }

  private pickCandidate(): Proxy | undefined {
    const all = [...this.proxies.values()];
    return all.find((p) => p.status === 'ready') ?? all.find((p) => p.status === 'idle');
  }

  /**
   * Finds a proxy that is either already reset (`ready`) or `idle` (needs a
   * reset first), reserves it synchronously (so no concurrent caller can
   * double-pick it), performs the reset if needed, and on success marks it
   * `in_use` for the given profile. On repeated reset failure the proxy is
   * marked `dead` and a different candidate is tried, until the pool is
   * exhausted (returns null — caller should leave its slot empty and retry
   * on the next `freed` event).
   *
   * `onResettingStart` lets the caller (the scheduler) record a UI-facing
   * timestamp/state transition without the pool needing to know about Slots.
   */
  async acquireForProfile(
    profileId: string,
    onResettingStart?: (proxy: Proxy) => void,
  ): Promise<Proxy | null> {
    for (;;) {
      const candidate = this.pickCandidate();
      if (!candidate) return null;

      if (candidate.status === 'ready') {
        candidate.status = 'in_use';
        candidate.assignedProfileId = profileId;
        this.emit('change', this.get(candidate.id));
        return { ...candidate };
      }

      // status === 'idle' — reserve immediately, before any await, so no
      // other concurrent caller can pick the same proxy.
      candidate.status = 'resetting';
      candidate.assignedProfileId = profileId;
      this.emit('change', this.get(candidate.id));
      onResettingStart?.({ ...candidate });

      try {
        await withTimeout(
          this.resetFn(candidate),
          this.config.resetTimeoutMs,
          `Reset of ${candidate.label}`,
        );
        if (this.config.postResetSettleMs > 0) {
          await delay(this.config.postResetSettleMs);
        }
        candidate.status = 'in_use';
        candidate.lastResetAt = Date.now();
        candidate.consecutiveResetFailures = 0;
        this.emit('change', this.get(candidate.id));
        return { ...candidate };
      } catch (err) {
        candidate.consecutiveResetFailures += 1;
        candidate.assignedProfileId = null;
        if (candidate.consecutiveResetFailures >= this.config.resetMaxRetries) {
          candidate.status = 'dead';
          candidate.deadSince = Date.now();
          this.emit('change', this.get(candidate.id));
          this.emit('dead', this.get(candidate.id), err);
        } else {
          candidate.status = 'idle';
          this.emit('change', this.get(candidate.id));
        }
        // loop and try another candidate; pickCandidate() will skip this one now
      }
    }
  }

  /** Called when a slot using this proxy reaches `done`. */
  release(proxyId: string): void {
    const p = this.proxies.get(proxyId);
    if (!p) return;
    p.status = 'idle';
    p.assignedProfileId = null;
    this.emit('change', this.get(proxyId));
    this.emit('freed', this.get(proxyId));
  }

  /** Adds a newly configured proxy to the live pool without a restart. */
  addProxy(proxy: Proxy): void {
    this.proxies.set(proxy.id, { ...proxy, status: 'idle', assignedProfileId: null });
    this.emit('change', this.get(proxy.id));
    this.emit('freed', this.get(proxy.id));
  }

  /** Removes a proxy from the live pool. Refuses while it's actively in use or resetting. */
  removeProxy(proxyId: string): void {
    const p = this.proxies.get(proxyId);
    if (!p) return;
    if (p.status === 'in_use' || p.status === 'resetting') {
      throw new Error(`Cannot remove proxy ${p.label} while it is ${p.status} — stop the run first.`);
    }
    this.proxies.delete(proxyId);
    this.emit('change', undefined);
  }

  /** Manual "retry" action from the UI for a proxy marked dead. */
  retryDead(proxyId: string): void {
    const p = this.proxies.get(proxyId);
    if (!p || p.status !== 'dead') return;
    p.status = 'idle';
    p.deadSince = null;
    p.consecutiveResetFailures = 0;
    this.emit('change', this.get(proxyId));
    this.emit('freed', this.get(proxyId));
  }
}
