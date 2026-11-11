import type { AttachedWindow, WindowController } from '../../src/cdp/windowController.js';

interface FakeWindow {
  wsEndpoint: string;
  closedListeners: Array<() => void>;
  closed: boolean;
}

/**
 * Stands in for the real CDP-backed WindowController in tests: no real
 * browser is launched. `closeWindow(wsEndpoint)` simulates the human (or a
 * crash) closing a profile's browser, firing the same `onClosed` callback
 * the real controller would fire on a CDP disconnect.
 */
export class FakeWindowController implements Pick<
  WindowController,
  'attach' | 'navigate' | 'moveOffscreen' | 'minimizeState' | 'restore' | 'onClosed' | 'detach'
> {
  private readonly windows = new Map<string, FakeWindow>();
  navigateCalls: Array<{ wsEndpoint: string; url: string }> = [];
  offscreenCalls: string[] = [];
  restoreCalls: Array<{ wsEndpoint: string; focus: boolean }> = [];

  async attach(wsEndpoint: string): Promise<AttachedWindow> {
    const fake: FakeWindow = { wsEndpoint, closedListeners: [], closed: false };
    this.windows.set(wsEndpoint, fake);
    return fake as unknown as AttachedWindow;
  }

  async navigate(win: AttachedWindow, url: string): Promise<void> {
    const fake = win as unknown as FakeWindow;
    this.navigateCalls.push({ wsEndpoint: fake.wsEndpoint, url });
  }

  async moveOffscreen(win: AttachedWindow): Promise<void> {
    const fake = win as unknown as FakeWindow;
    this.offscreenCalls.push(fake.wsEndpoint);
  }

  async minimizeState(): Promise<void> {
    // not used by the scheduler's default path; present to satisfy the type
  }

  async restore(win: AttachedWindow, opts: { focus?: boolean } = {}): Promise<void> {
    const fake = win as unknown as FakeWindow;
    this.restoreCalls.push({ wsEndpoint: fake.wsEndpoint, focus: !!opts.focus });
  }

  onClosed(win: AttachedWindow, cb: () => void): void {
    (win as unknown as FakeWindow).closedListeners.push(cb);
  }

  async detach(win: AttachedWindow): Promise<void> {
    const fake = win as unknown as FakeWindow;
    fake.closed = true;
  }

  /** Test helper: simulate the human closing this profile's browser window. */
  closeWindow(wsEndpoint: string): void {
    const fake = this.windows.get(wsEndpoint);
    if (!fake || fake.closed) return;
    fake.closed = true;
    for (const cb of fake.closedListeners) cb();
  }
}
