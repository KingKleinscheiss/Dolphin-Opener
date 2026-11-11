// Mirrors src/domain/types.ts — kept duplicated to avoid cross-root build
// coupling between the backend (NodeNext) and frontend (Vite) TS configs.

export type ProxyStatus = 'idle' | 'resetting' | 'ready' | 'in_use' | 'dead';

export interface Proxy {
  id: string;
  label: string;
  dolphinProxyId: string | null;
  changeIpUrl: string | null;
  host: string | null;
  port: number | null;
  login: string | null;
  password: string | null;
  status: ProxyStatus;
  assignedProfileId: string | null;
  lastResetAt: number | null;
  consecutiveResetFailures: number;
  deadSince: number | null;
}

export type SlotState =
  | 'empty'
  | 'assigning_proxy'
  | 'resetting_proxy'
  | 'launching_profile'
  | 'navigating'
  | 'minimizing'
  | 'background_ready'
  | 'promoting'
  | 'foreground'
  | 'closing'
  | 'done';

export interface Slot {
  index: number;
  state: SlotState;
  profileId: string | null;
  profileName: string | null;
  proxyId: string | null;
  proxyLabel: string | null;
  cdpWsEndpoint: string | null;
  isForeground: boolean;
  resetStartedAt: number | null;
  readyAt: number | null;
  error: string | null;
}

export interface QueueProgress {
  total: number;
  done: number;
  remaining: number;
  nextUp: string[];
}

export interface SchedulerSnapshot {
  running: boolean;
  slots: Slot[];
  proxies: Proxy[];
  queue: QueueProgress;
}

export type FilterMode = 'tag' | 'folder' | 'both';

export interface ProfileFilter {
  mode: FilterMode;
  tagIds: string[];
  folderIds: string[];
}

export interface Tag {
  id: string;
  name: string;
}

export interface Folder {
  id: string;
  name: string;
}

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
