import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Proxy, ProfileFilter } from '../domain/types.js';

export interface AppConfig {
  dolphin: { baseUrl: string; token: string };
  proxies: Proxy[];
  lastFilter: ProfileFilter;
  targetDomain: string;
  slotCount: number;
  foregroundCount: number;
  resetTimeoutMs: number;
  resetMaxRetries: number;
  postResetSettleMs: number;
  autoFocusOnPromote: boolean;
}

const DEFAULT_CONFIG: AppConfig = {
  dolphin: { baseUrl: 'http://localhost:3001/v1.0', token: '' },
  proxies: [],
  lastFilter: { mode: 'tag', tagIds: [], folderIds: [] },
  targetDomain: 'https://example.com',
  slotCount: 10,
  foregroundCount: 4,
  resetTimeoutMs: 120_000,
  resetMaxRetries: 2,
  postResetSettleMs: 5_000,
  autoFocusOnPromote: false,
};

interface StoredProxyConfig {
  id: string;
  label: string;
  dolphinProxyId: string | null;
  changeIpUrl: string | null;
  host?: string | null;
  port?: number | null;
  login?: string | null;
  password?: string | null;
}

function toRuntimeProxy(stored: StoredProxyConfig): Proxy {
  return {
    id: stored.id,
    label: stored.label,
    dolphinProxyId: stored.dolphinProxyId,
    changeIpUrl: stored.changeIpUrl,
    host: stored.host ?? null,
    port: stored.port ?? null,
    login: stored.login ?? null,
    password: stored.password ?? null,
    status: 'idle',
    assignedProfileId: null,
    lastResetAt: null,
    consecutiveResetFailures: 0,
    deadSince: null,
  };
}

function toStoredProxy(p: Proxy): StoredProxyConfig {
  return {
    id: p.id,
    label: p.label,
    dolphinProxyId: p.dolphinProxyId,
    changeIpUrl: p.changeIpUrl,
    host: p.host,
    port: p.port,
    login: p.login,
    password: p.password,
  };
}

export class ConfigStore {
  private config: AppConfig = DEFAULT_CONFIG;

  constructor(private readonly path: string) {}

  async load(): Promise<AppConfig> {
    try {
      const raw = await readFile(this.path, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<AppConfig> & { proxies?: StoredProxyConfig[] };
      this.config = {
        ...DEFAULT_CONFIG,
        ...parsed,
        dolphin: { ...DEFAULT_CONFIG.dolphin, ...parsed.dolphin },
        proxies: (parsed.proxies ?? []).map(toRuntimeProxy),
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      // no config on disk yet — start from defaults, caller can save() later
    }
    return this.config;
  }

  get(): AppConfig {
    return this.config;
  }

  async save(next: Partial<AppConfig>): Promise<AppConfig> {
    this.config = { ...this.config, ...next };
    await mkdir(dirname(this.path), { recursive: true });
    const onDisk = { ...this.config, proxies: this.config.proxies.map(toStoredProxy) };
    await writeFile(this.path, JSON.stringify(onDisk, null, 2), 'utf-8');
    return this.config;
  }
}
