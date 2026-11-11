import { describe, expect, it, vi } from 'vitest';
import { ProxyPool } from '../src/proxy/pool.js';
import { makeProxy } from './fixtures/proxies.js';

const fastConfig = { resetTimeoutMs: 1000, resetMaxRetries: 2, postResetSettleMs: 0 };

describe('ProxyPool', () => {
  it('resets an idle proxy and marks it in_use for the requesting profile', async () => {
    const resetFn = vi.fn().mockResolvedValue(undefined);
    const pool = new ProxyPool([makeProxy('p1')], fastConfig, resetFn);

    const resettingEvents: string[] = [];
    const proxy = await pool.acquireForProfile('profile-1', (p) => resettingEvents.push(p.status));

    expect(resetFn).toHaveBeenCalledTimes(1);
    expect(resettingEvents).toEqual(['resetting']);
    expect(proxy?.status).toBe('in_use');
    expect(proxy?.assignedProfileId).toBe('profile-1');
    expect(pool.get('p1')?.status).toBe('in_use');
  });

  it('never reuses a released proxy without resetting it again first', async () => {
    const resetFn = vi.fn().mockResolvedValue(undefined);
    const pool = new ProxyPool([makeProxy('p1')], fastConfig, resetFn);
    const first = await pool.acquireForProfile('profile-1');
    pool.release(first!.id);

    const second = await pool.acquireForProfile('profile-2');
    expect(second?.id).toBe('p1');
    // released proxies go back to 'idle', never 'ready' — so every reuse
    // goes through a fresh reset, satisfying "never reused with a stale IP".
    expect(resetFn).toHaveBeenCalledTimes(2);
  });

  it('never double-assigns the same proxy to two concurrent acquisitions', async () => {
    const resetFn = vi.fn().mockResolvedValue(undefined);
    const pool = new ProxyPool([makeProxy('p1'), makeProxy('p2')], fastConfig, resetFn);

    const [a, b] = await Promise.all([
      pool.acquireForProfile('profile-1'),
      pool.acquireForProfile('profile-2'),
    ]);

    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.id).not.toBe(b!.id);
  });

  it('marks a proxy dead after resetMaxRetries consecutive failures and tries another', async () => {
    const resetFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(undefined);
    const pool = new ProxyPool([makeProxy('bad'), makeProxy('good')], fastConfig, resetFn);

    const deadHandler = vi.fn();
    pool.on('dead', deadHandler);

    const proxy = await pool.acquireForProfile('profile-1');

    expect(proxy?.id).toBe('good');
    expect(deadHandler).toHaveBeenCalledTimes(1);
    expect(pool.get('bad')?.status).toBe('dead');
    expect(pool.hasAnyActiveProxy()).toBe(true);
  });

  it('returns null when every proxy is dead or in_use, and emits freed on release', async () => {
    const resetFn = vi.fn().mockResolvedValue(undefined);
    const pool = new ProxyPool([makeProxy('p1')], fastConfig, resetFn);
    const proxy = await pool.acquireForProfile('profile-1');
    expect(proxy).not.toBeNull();

    const second = await pool.acquireForProfile('profile-2');
    expect(second).toBeNull();

    const freedHandler = vi.fn();
    pool.on('freed', freedHandler);
    pool.release(proxy!.id);
    expect(freedHandler).toHaveBeenCalledTimes(1);
    expect(pool.get('p1')?.status).toBe('idle');
  });

  it('retryDead moves a dead proxy back to idle and emits freed', () => {
    const pool = new ProxyPool([makeProxy('p1', { status: 'dead', deadSince: Date.now() })], fastConfig);
    const freedHandler = vi.fn();
    pool.on('freed', freedHandler);
    pool.retryDead('p1');
    expect(pool.get('p1')?.status).toBe('idle');
    expect(freedHandler).toHaveBeenCalledTimes(1);
  });
});
