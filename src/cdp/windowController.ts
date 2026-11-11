import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from 'playwright-core';

export interface AttachedWindow {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  client: CDPSession;
}

const OFFSCREEN_BOUNDS = { left: -3000, top: -3000, width: 1, height: 1 } as const;
const NORMAL_BOUNDS = { left: 80, top: 80, width: 1280, height: 900 } as const;

/**
 * Controls a single Dolphin-launched Chromium window over its CDP
 * endpoint: navigation, and — the core requirement — moving a background
 * profile out of view without ever stealing OS focus, then restoring it on
 * promotion to the visible working set.
 *
 * TECHNICAL RISK (see plan/README "CDP spike"): moving the window
 * off-screen via `Browser.setWindowBounds` is the primary strategy because
 * it has proven more consistently non-focus-stealing across OS/window
 * managers than `windowState: 'minimized'`, which can briefly flash on
 * some platforms. This must be confirmed on the user's real machines
 * before relying on it for an unattended background batch.
 */
export class WindowController {
  async attach(wsEndpoint: string): Promise<AttachedWindow> {
    const browser = await chromium.connectOverCDP(wsEndpoint);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    const client = await context.newCDPSession(page);
    return { browser, context, page, client };
  }

  async navigate(win: AttachedWindow, url: string): Promise<void> {
    await win.page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  private async getWindowId(win: AttachedWindow): Promise<number> {
    const result = (await win.client.send('Browser.getWindowForTarget' as never)) as { windowId: number };
    return result.windowId;
  }

  /** Moves the window off-screen. Primary background strategy — see class doc. */
  async moveOffscreen(win: AttachedWindow): Promise<void> {
    const windowId = await this.getWindowId(win);
    await win.client.send('Browser.setWindowBounds' as never, {
      windowId,
      bounds: { windowState: 'normal', ...OFFSCREEN_BOUNDS },
    } as never);
  }

  /** Alternate background strategy, kept for the CDP spike comparison (see README). */
  async minimizeState(win: AttachedWindow): Promise<void> {
    const windowId = await this.getWindowId(win);
    await win.client.send('Browser.setWindowBounds' as never, {
      windowId,
      bounds: { windowState: 'minimized' },
    } as never);
  }

  /** Restores a backgrounded window to a normal visible position/size. */
  async restore(win: AttachedWindow, opts: { focus?: boolean } = {}): Promise<void> {
    const windowId = await this.getWindowId(win);
    await win.client.send('Browser.setWindowBounds' as never, {
      windowId,
      bounds: { windowState: 'normal', ...NORMAL_BOUNDS },
    } as never);
    if (opts.focus) {
      await win.page.bringToFront();
    }
  }

  /** Fires when the whole browser window (not just a tab) closes. */
  onClosed(win: AttachedWindow, cb: () => void): void {
    win.browser.on('disconnected', cb);
  }

  async detach(win: AttachedWindow): Promise<void> {
    try {
      await win.browser.close();
    } catch {
      // the underlying profile window may already be gone — nothing to do
    }
  }
}
