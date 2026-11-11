import type { ProfileLauncher, StartProfileResult } from '../../src/dolphin/client.js';
import type { DolphinProxyRaw } from '../../src/dolphin/types.js';

export class FakeDolphinClient implements ProfileLauncher {
  setProfileProxyCalls: Array<{ profileId: string; proxy: DolphinProxyRaw }> = [];
  startProfileCalls: string[] = [];
  failStartForProfileIds = new Set<string>();
  failSetProxyForProfileIds = new Set<string>();

  async setProfileProxy(profileId: string, proxy: DolphinProxyRaw): Promise<void> {
    this.setProfileProxyCalls.push({ profileId, proxy });
    if (this.failSetProxyForProfileIds.has(profileId)) {
      throw new Error(`fake setProfileProxy failure for ${profileId}`);
    }
  }

  async startProfile(profileId: string): Promise<StartProfileResult> {
    this.startProfileCalls.push(profileId);
    if (this.failStartForProfileIds.has(profileId)) {
      throw new Error(`fake startProfile failure for ${profileId}`);
    }
    return { wsEndpoint: `ws://fake/${profileId}` };
  }
}
