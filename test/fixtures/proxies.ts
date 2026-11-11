import type { Proxy } from '../../src/domain/types.js';

export function makeProxy(id: string, overrides: Partial<Proxy> = {}): Proxy {
  return {
    id,
    label: `Proxy ${id}`,
    dolphinProxyId: id,
    changeIpUrl: `https://fake-reset/${id}`,
    host: null,
    port: null,
    login: null,
    password: null,
    status: 'idle',
    assignedProfileId: null,
    lastResetAt: null,
    consecutiveResetFailures: 0,
    deadSince: null,
    ...overrides,
  };
}

export function makeProfile(id: string, name = `Profile ${id}`) {
  return { id, name, tags: [], folderId: null, folderName: null };
}
