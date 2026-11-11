import { describe, expect, it, vi } from 'vitest';
import { Scheduler } from '../src/scheduler/scheduler.js';
import { ProxyPool } from '../src/proxy/pool.js';
import { FakeDolphinClient } from './fixtures/fakeDolphin.js';
import { FakeWindowController } from './fixtures/fakeWindowController.js';
import { makeProfile, makeProxy } from './fixtures/proxies.js';
import type { RunConfig, SchedulerSnapshot, Slot } from '../src/domain/types.js';

const baseRunConfig: RunConfig = {
  targetDomain: 'https://example.com',
  filter: { mode: 'tag', tagIds: [], folderIds: [] },
  slotCount: 2,
  foregroundCount: 1,
  resetTimeoutMs: 1000,
  resetMaxRetries: 2,
  postResetSettleMs: 0,
  autoFocusOnPromote: false,
};

function setup(proxyLabels: string[]) {
  const dolphin = new FakeDolphinClient();
  const windowController = new FakeWindowController();
  const pool = new ProxyPool(
    proxyLabels.map((id) => makeProxy(id)),
    { resetTimeoutMs: 1000, resetMaxRetries: 2, postResetSettleMs: 0 },
    vi.fn().mockResolvedValue(undefined),
  );
  const scheduler = new Scheduler(dolphin, pool, windowController as never);
  return { dolphin, windowController, pool, scheduler };
}

async function waitFor(scheduler: Scheduler, predicate: (s: SchedulerSnapshot) => boolean): Promise<SchedulerSnapshot> {
  return vi.waitFor(
    () => {
      const snap = scheduler.getSnapshot();
      if (!predicate(snap)) throw new Error('condition not met yet');
      return snap;
    },
    { timeout: 2000, interval: 5 },
  );
}

function slotFor(snap: SchedulerSnapshot, profileId: string): Slot | undefined {
  return snap.slots.find((s) => s.profileId === profileId);
}

describe('Scheduler', () => {
  it('fills the foreground slot visibly and pre-stages the rest in the background without stealing focus', async () => {
    const { dolphin, windowController, scheduler } = setup(['p1', 'p2']);
    scheduler.start([makeProfile('a'), makeProfile('b')], baseRunConfig);

    const snap = await waitFor(scheduler, (s) => s.slots.every((sl) => sl.state === 'foreground' || sl.state === 'background_ready'));

    const foreground = snap.slots.filter((s) => s.isForeground);
    const background = snap.slots.filter((s) => !s.isForeground);
    expect(foreground).toHaveLength(1);
    expect(background).toHaveLength(1);
    expect(windowController.offscreenCalls).toContain(`ws://fake/${background[0]!.profileId}`);
    expect(dolphin.startProfileCalls.sort()).toEqual(['a', 'b']);
  });

  it('promotes the background slot to foreground once the foreground window closes, and backfills the freed slot', async () => {
    const { windowController, scheduler } = setup(['p1', 'p2']);
    scheduler.start([makeProfile('a'), makeProfile('b'), makeProfile('c')], baseRunConfig);

    let snap = await waitFor(scheduler, (s) => s.slots.filter((sl) => sl.state === 'background_ready').length === 1);
    const foregroundSlot = snap.slots.find((s) => s.isForeground)!;

    windowController.closeWindow(`ws://fake/${foregroundSlot.profileId}`);

    snap = await waitFor(scheduler, (s) => s.slots.filter((sl) => sl.isForeground).length === 1);
    const newForeground = snap.slots.find((s) => s.isForeground)!;
    expect(newForeground.profileId).not.toBe(foregroundSlot.profileId);
    expect(windowController.restoreCalls.some((c) => c.wsEndpoint === `ws://fake/${newForeground.profileId}`)).toBe(
      true,
    );

    // the slot that just freed up should have started preparing profile "c"
    snap = await waitFor(scheduler, (s) => s.slots.some((sl) => sl.profileId === 'c'));
    expect(slotFor(snap, 'c')).toBeDefined();
  });

  it('keeps the pipeline going when a proxy dies during reset, excluding it from the active pool', async () => {
    const dolphin = new FakeDolphinClient();
    const windowController = new FakeWindowController();
    const flakyReset = vi
      .fn()
      .mockRejectedValueOnce(new Error('proxy dead'))
      .mockRejectedValueOnce(new Error('proxy dead'))
      .mockResolvedValue(undefined);
    const pool = new ProxyPool(
      [makeProxy('bad'), makeProxy('good')],
      { resetTimeoutMs: 1000, resetMaxRetries: 2, postResetSettleMs: 0 },
      flakyReset,
    );
    const scheduler = new Scheduler(dolphin, pool, windowController as never);

    scheduler.start([makeProfile('a')], { ...baseRunConfig, slotCount: 1, foregroundCount: 1 });

    const snap = await waitFor(scheduler, (s) => s.slots[0]?.state === 'foreground');
    expect(snap.slots[0]!.proxyLabel).toBe('Proxy good');
    expect(snap.proxies.find((p) => p.id === 'bad')?.status).toBe('dead');
  });

  it('leaves a slot empty/pending when all proxies are busy, then fills it as soon as one frees', async () => {
    const { windowController, scheduler } = setup(['p1']);
    scheduler.start([makeProfile('a'), makeProfile('b')], { ...baseRunConfig, slotCount: 2, foregroundCount: 1 });

    let snap = await waitFor(scheduler, (s) => s.slots.some((sl) => sl.state === 'foreground'));
    expect(snap.slots.filter((sl) => sl.state === 'empty')).toHaveLength(1);

    const active = snap.slots.find((sl) => sl.state === 'foreground')!;
    windowController.closeWindow(`ws://fake/${active.profileId}`);

    snap = await waitFor(scheduler, (s) => s.slots.some((sl) => sl.profileId === 'b'));
    expect(slotFor(snap, 'b')).toBeDefined();
  });

  it('completes the run once the queue is empty and every slot returns to empty', async () => {
    const { windowController, scheduler } = setup(['p1']);
    const completed = vi.fn();
    scheduler.on('completed', completed);

    scheduler.start([makeProfile('a')], { ...baseRunConfig, slotCount: 1, foregroundCount: 1 });

    const snap = await waitFor(scheduler, (s) => s.slots[0]?.state === 'foreground');
    windowController.closeWindow(`ws://fake/${snap.slots[0]!.profileId}`);

    await waitFor(scheduler, () => completed.mock.calls.length > 0);
    expect(scheduler.getSnapshot().running).toBe(false);
  });

  it('does not promote anything when a foreground slot closes and no background slot is ready yet', async () => {
    const { windowController, scheduler } = setup(['p1', 'p2']);
    scheduler.start([makeProfile('a'), makeProfile('b')], { ...baseRunConfig, slotCount: 2, foregroundCount: 2 });

    const snap = await waitFor(scheduler, (s) => s.slots.every((sl) => sl.state === 'foreground'));
    expect(snap.slots.every((sl) => sl.isForeground)).toBe(true);

    const [first] = snap.slots;
    windowController.closeWindow(`ws://fake/${first!.profileId}`);

    const after = await waitFor(scheduler, (s) => s.slots[first!.index]!.state === 'empty');
    expect(after.slots[first!.index]!.state).toBe('empty');
  });

  it('ignores a second force-close on an already-empty slot instead of throwing', async () => {
    const { scheduler } = setup(['p1']);
    scheduler.start([makeProfile('a')], { ...baseRunConfig, slotCount: 1, foregroundCount: 1 });
    await waitFor(scheduler, (s) => s.slots[0]?.state === 'foreground');

    expect(() => {
      scheduler.forceCloseSlot(0);
      scheduler.forceCloseSlot(0);
    }).not.toThrow();
  });
});
