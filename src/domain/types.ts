export type ProxyStatus = 'idle' | 'resetting' | 'ready' | 'in_use' | 'dead';

export interface Proxy {
  id: string;
  label: string;
  dolphinProxyId: string | null;
  changeIpUrl: string | null;
  /**
   * Fallback fields for the case where Dolphin Anty needs full proxy
   * credentials embedded per profile rather than a reference to a
   * first-class proxy entity by id — see DolphinClient.setProfileProxy and
   * README "API discovery" assumption #1. Leave null if dolphinProxyId
   * (reference by id) turns out to be sufficient.
   */
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

export interface Profile {
  id: string;
  name: string;
  tags: string[];
  folderId: string | null;
  folderName: string | null;
}

export type FilterMode = 'tag' | 'folder' | 'both';

export interface ProfileFilter {
  mode: FilterMode;
  tagIds: string[];
  folderIds: string[];
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

export interface RunConfig {
  targetDomain: string;
  filter: ProfileFilter;
  slotCount: number;
  foregroundCount: number;
  resetTimeoutMs: number;
  resetMaxRetries: number;
  postResetSettleMs: number;
  autoFocusOnPromote: boolean;
}

export interface Tag {
  id: string;
  name: string;
}

export interface Folder {
  id: string;
  name: string;
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
