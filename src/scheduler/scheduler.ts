import { EventEmitter } from 'node:events';
import type { ProfileLauncher } from '../dolphin/client.js';
import type { DolphinProxyRaw } from '../dolphin/types.js';
import type { ProxyPool } from '../proxy/pool.js';
import type { AttachedWindow, WindowController } from '../cdp/windowController.js';
import type { Profile, Proxy, RunConfig, SchedulerSnapshot, Slot } from '../domain/types.js';
import { ProfileQueue } from './profileQueue.js';

const MAX_PROFILE_FAILURES = 3;

function emptySlot(index: number): Slot {
  return {
    index,
    state: 'empty',
    profileId: null,
    profileName: null,
    proxyId: null,
    proxyLabel: null,
    cdpWsEndpoint: null,
    isForeground: false,
    resetStartedAt: null,
    readyAt: null,
    error: null,
  };
}

function toDolphinProxyRaw(proxy: Proxy): DolphinProxyRaw {
  const raw: DolphinProxyRaw = {};
  if (proxy.dolphinProxyId) raw.id = proxy.dolphinProxyId;
  if (proxy.host) raw.host = proxy.host;
  if (proxy.port != null) raw.port = proxy.port;
  if (proxy.login) raw.login = proxy.login;
  if (proxy.password) raw.password = proxy.password;
  return raw;
}

/**
 * Drives the whole slot pipeline: event-driven `tryFillSlot` per index, not
 * a lockstep batch of 4 — see plan/README for the rationale (a single dead
 * proxy must never stall or desync a whole block).
 */
export class Scheduler extends EventEmitter {
  private slots: Slot[] = [];
  private queue: ProfileQueue = new ProfileQueue([]);
  private runConfig: RunConfig | null = null;
  private running = false;
  private readonly attachedWindows = new Map<number, AttachedWindow>();
  private readonly activeProfiles = new Map<number, Profile>();
  private readonly failureCounts = new Map<string, number>();

  constructor(
    private readonly dolphin: ProfileLauncher,
    private readonly proxyPool: ProxyPool,
    private readonly windowController: WindowController,
  ) {
    super();
    this.proxyPool.on('freed', () => this.onProxyFreed());
    this.proxyPool.on('change', () => this.emitChange());
  }

  private emitChange(): void {
    this.emit('change', this.getSnapshot());
  }

  private onProxyFreed(): void {
    if (!this.running) return;
    for (let i = 0; i < this.slots.length; i++) {
      if (this.slots[i]?.state === 'empty') void this.tryFillSlot(i);
    }
  }

  getSnapshot(): SchedulerSnapshot {
    return {
      running: this.running,
      slots: this.slots.map((s) => ({ ...s })),
      proxies: this.proxyPool.list(),
      queue: this.queue.progress(),
    };
  }

  start(profiles: Profile[], config: RunConfig): void {
    this.runConfig = config;
    this.queue = new ProfileQueue(profiles);
    this.slots = Array.from({ length: config.slotCount }, (_, i) => emptySlot(i));
    this.activeProfiles.clear();
    this.failureCounts.clear();
    this.running = true;
    this.emitChange();
    for (let i = 0; i < config.slotCount; i++) void this.tryFillSlot(i);
  }

  async stop(): Promise<void> {
    this.running = false;
    for (const [index, win] of this.attachedWindows) {
      await this.windowController.detach(win).catch(() => undefined);
      const slot = this.slots[index];
      if (slot?.proxyId) this.proxyPool.release(slot.proxyId);
    }
    this.attachedWindows.clear();
    this.slots = this.slots.map((s) => emptySlot(s.index));
    this.activeProfiles.clear();
    this.emitChange();
  }

  retryProxy(proxyId: string): void {
    this.proxyPool.retryDead(proxyId);
  }

  /** Manual "bring to front" action from the UI for an already-foreground slot. */
  async focusSlot(index: number): Promise<void> {
    const win = this.attachedWindows.get(index);
    if (win) await this.windowController.restore(win, { focus: true });
  }

  /** Safety-net action if CDP disconnect detection ever misses a real close. */
  forceCloseSlot(index: number): void {
    this.handleWindowClosed(index);
  }

  private countActiveForeground(): number {
    return this.slots.filter((s) => s.isForeground).length;
  }

  private resetSlot(index: number): void {
    this.slots[index] = emptySlot(index);
    this.activeProfiles.delete(index);
    this.attachedWindows.delete(index);
  }

  private checkCompletion(): void {
    if (this.running && this.queue.isEmpty() && this.slots.every((s) => s.state === 'empty')) {
      this.running = false;
      this.emit('completed');
    }
    this.emitChange();
  }

  private async promoteNextBackgroundSlot(): Promise<void> {
    const candidates = this.slots.filter((s) => s.state === 'background_ready');
    if (candidates.length === 0) return;
    candidates.sort((a, b) => (a.readyAt ?? 0) - (b.readyAt ?? 0));
    const slot = candidates[0]!;
    const win = this.attachedWindows.get(slot.index);
    if (!win) return;
    slot.state = 'promoting';
    this.emitChange();
    try {
      await this.windowController.restore(win, { focus: this.runConfig?.autoFocusOnPromote ?? false });
      slot.isForeground = true;
      slot.state = 'foreground';
      this.emitChange();
    } catch (err) {
      slot.error = err instanceof Error ? err.message : String(err);
      this.emitChange();
    }
  }

  private handleWindowClosed(index: number): void {
    const slot = this.slots[index];
    if (!slot || !slot.profileId) return; // already cleaned up (e.g. via stop())

    const reachedUsableState =
      slot.state === 'foreground' || slot.state === 'background_ready' || slot.state === 'promoting';
    const wasForeground = slot.isForeground;
    const profile = this.activeProfiles.get(index);

    if (slot.proxyId) this.proxyPool.release(slot.proxyId);

    if (reachedUsableState) {
      this.queue.markDone();
    } else if (profile) {
      // closed/crashed before it ever became usable — retry, bounded
      const failures = (this.failureCounts.get(profile.id) ?? 0) + 1;
      this.failureCounts.set(profile.id, failures);
      if (failures <= MAX_PROFILE_FAILURES) {
        this.queue.pushFront(profile);
      } else {
        // give up on this one profile so it can never wedge the whole run
        this.queue.markDone();
      }
    }

    slot.state = 'done';
    slot.isForeground = false;
    this.emitChange();

    this.resetSlot(index);
    this.checkCompletion();
    if (wasForeground) void this.promoteNextBackgroundSlot();
    void this.tryFillSlot(index);
  }

  private async tryFillSlot(index: number): Promise<void> {
    if (!this.running || !this.runConfig) return;
    const slot = this.slots[index];
    if (!slot || slot.state !== 'empty') return;
    if (this.queue.isEmpty()) {
      this.checkCompletion();
      return;
    }

    const profile = this.queue.pop()!;
    this.activeProfiles.set(index, profile);
    slot.state = 'assigning_proxy';
    slot.profileId = profile.id;
    slot.profileName = profile.name;
    slot.error = null;
    this.emitChange();

    const proxy = await this.proxyPool.acquireForProfile(profile.id, (resettingProxy) => {
      slot.state = 'resetting_proxy';
      slot.proxyId = resettingProxy.id;
      slot.proxyLabel = resettingProxy.label;
      slot.resetStartedAt = Date.now();
      this.emitChange();
    });

    if (!proxy) {
      // pool exhausted right now — park the profile and wait for `freed`
      this.queue.pushFront(profile);
      this.resetSlot(index);
      this.emitChange();
      return;
    }

    slot.proxyId = proxy.id;
    slot.proxyLabel = proxy.label;
    slot.state = 'launching_profile';
    this.emitChange();

    try {
      await this.dolphin.setProfileProxy(profile.id, toDolphinProxyRaw(proxy));
      const { wsEndpoint } = await this.dolphin.startProfile(profile.id);
      slot.cdpWsEndpoint = wsEndpoint;
      slot.state = 'navigating';
      this.emitChange();

      const win = await this.windowController.attach(wsEndpoint);
      this.attachedWindows.set(index, win);
      this.windowController.onClosed(win, () => this.handleWindowClosed(index));
      await this.windowController.navigate(win, this.runConfig.targetDomain);

      if (this.countActiveForeground() < this.runConfig.foregroundCount) {
        slot.isForeground = true;
        slot.state = 'foreground';
        slot.readyAt = Date.now();
      } else {
        slot.state = 'minimizing';
        this.emitChange();
        await this.windowController.moveOffscreen(win);
        slot.isForeground = false;
        slot.state = 'background_ready';
        slot.readyAt = Date.now();
      }
      this.emitChange();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      slot.error = message;
      console.error(`[slot ${index}] failed to open profile ${profile.name} (${profile.id}): ${message}`);
      this.emitChange();
      this.proxyPool.release(proxy.id);
      const existing = this.attachedWindows.get(index);
      if (existing) await this.windowController.detach(existing).catch(() => undefined);
      this.resetSlot(index);
      this.emitChange();

      const failures = (this.failureCounts.get(profile.id) ?? 0) + 1;
      this.failureCounts.set(profile.id, failures);
      if (failures <= MAX_PROFILE_FAILURES) {
        this.queue.pushFront(profile);
      } else {
        this.queue.markDone();
      }
      this.checkCompletion();
    }
  }
}
