import type { Folder, Profile, ProfileFilter, Tag } from '../domain/types.js';
import type {
  DolphinFolderRaw,
  DolphinListResponse,
  DolphinProfileRaw,
  DolphinProxyRaw,
  DolphinStartResponseRaw,
  DolphinTagRaw,
} from './types.js';

export class DolphinApiError extends Error {
  constructor(public readonly status: number, public readonly path: string, message: string) {
    super(`Dolphin API ${path} failed (${status}): ${message}`);
  }
}

export interface StartProfileResult {
  wsEndpoint: string;
}

/** The slice of DolphinClient the scheduler needs — lets tests pass a fake without the real HTTP client's private fields. */
export interface ProfileLauncher {
  setProfileProxy(profileId: string, proxy: DolphinProxyRaw): Promise<void>;
  startProfile(profileId: string): Promise<StartProfileResult>;
}

export interface DolphinClientOptions {
  baseUrl: string;
  token?: string;
}

/**
 * Thin typed client for the Dolphin Anty Local API.
 *
 * Every endpoint path/shape below is an assumption flagged in ./types.ts —
 * see README "API discovery" for the manual verification step that must be
 * done once against the real running Dolphin Anty app before a live run.
 */
export class DolphinClient implements ProfileLauncher {
  private baseUrl: string;
  private token?: string;

  constructor(opts: DolphinClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.token = opts.token;
  }

  /** Lets the server apply settings changes without re-wiring every holder of this client. */
  setOptions(opts: DolphinClientOptions): void {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.token = opts.token;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new DolphinApiError(res.status, path, text || res.statusText);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  private unwrapList<T>(res: DolphinListResponse<T> | T[]): T[] {
    if (Array.isArray(res)) return res;
    return res.data ?? res.items ?? [];
  }

  async listTags(): Promise<Tag[]> {
    // VERIFY: path — candidates: /tags, /browser_profiles/tags
    const raw = await this.request<DolphinListResponse<DolphinTagRaw> | DolphinTagRaw[]>('/tags');
    return this.unwrapList(raw).map((t) => ({ id: String(t.id), name: t.name }));
  }

  async listFolders(): Promise<Folder[]> {
    // VERIFY: path — candidates: /folders, /browser_profiles/folders
    const raw = await this.request<DolphinListResponse<DolphinFolderRaw> | DolphinFolderRaw[]>('/folders');
    return this.unwrapList(raw).map((f) => ({ id: String(f.id), name: f.name }));
  }

  async listProfiles(filter?: ProfileFilter): Promise<Profile[]> {
    const params = new URLSearchParams();
    if (filter) {
      if (filter.mode !== 'folder') {
        for (const tagId of filter.tagIds) params.append('tags[]', tagId);
      }
      if (filter.mode !== 'tag') {
        for (const folderId of filter.folderIds) params.append('folder', folderId);
      }
    }
    const profiles: Profile[] = [];
    let page = 1;
    const pageSize = 100;
    // VERIFY: pagination param names (page/pageSize/limit) and whether the
    // API even requires explicit pagination for a reasonably sized account.
    for (;;) {
      params.set('page', String(page));
      params.set('limit', String(pageSize));
      const raw = await this.request<DolphinListResponse<DolphinProfileRaw> | DolphinProfileRaw[]>(
        `/browser_profiles?${params.toString()}`,
      );
      const batch = this.unwrapList(raw);
      profiles.push(...batch.map((p) => this.normalizeProfile(p)));
      if (batch.length < pageSize) break;
      page += 1;
      if (page > 1000) break; // safety valve against a pagination-shape mismatch looping forever
    }
    return this.applyClientSideFilter(profiles, filter);
  }

  private applyClientSideFilter(profiles: Profile[], filter?: ProfileFilter): Profile[] {
    if (!filter) return profiles;
    const tagSet = new Set(filter.tagIds);
    const folderSet = new Set(filter.folderIds);
    return profiles.filter((p) => {
      const matchesTag = filter.mode !== 'folder' ? p.tags.some((t) => tagSet.has(t)) : true;
      const matchesFolder = filter.mode !== 'tag' ? (p.folderId ? folderSet.has(p.folderId) : false) : true;
      if (filter.mode === 'both') return matchesTag && matchesFolder;
      if (filter.mode === 'tag') return matchesTag;
      return matchesFolder;
    });
  }

  async getProfile(id: string): Promise<Profile> {
    const raw = await this.request<DolphinProfileRaw>(`/browser_profiles/${id}`);
    return this.normalizeProfile(raw);
  }

  private normalizeProfile(raw: DolphinProfileRaw): Profile {
    const tags = Array.isArray(raw.tags)
      ? raw.tags.map((t) => (typeof t === 'string' ? t : String(t.id)))
      : [];
    const folderId =
      raw.folderId != null
        ? String(raw.folderId)
        : raw.folder && typeof raw.folder === 'object'
          ? String(raw.folder.id)
          : null;
    const folderName =
      raw.folderName ?? (raw.folder && typeof raw.folder === 'object' ? raw.folder.name : null) ?? null;
    return { id: String(raw.id), name: raw.name, tags, folderId, folderName };
  }

  /**
   * Point a profile's proxy at one of our pooled proxies, immediately
   * before starting it. VERIFY: exact endpoint/payload shape — see
   * ./types.ts DolphinProxyRaw and README "API discovery". Two fallback
   * shapes are tried in order; keep both until the real one is confirmed,
   * then delete the unused branch.
   */
  async setProfileProxy(profileId: string, proxy: DolphinProxyRaw): Promise<void> {
    try {
      await this.request<unknown>(`/browser_profiles/${profileId}`, {
        method: 'PATCH',
        body: JSON.stringify({ proxy }),
      });
      return;
    } catch (err) {
      if (!(err instanceof DolphinApiError) || (err.status !== 404 && err.status !== 405)) throw err;
    }
    // fallback: dedicated sub-resource
    await this.request<unknown>(`/browser_profiles/${profileId}/proxy`, {
      method: 'POST',
      body: JSON.stringify(proxy),
    });
  }

  async startProfile(profileId: string): Promise<StartProfileResult> {
    // VERIFY: GET vs POST, and whether automation=1 is the correct query param
    const raw = await this.request<DolphinStartResponseRaw>(
      `/browser_profiles/${profileId}/start?automation=1`,
    );
    const wsEndpoint =
      raw.automation?.wsEndpoint ?? raw.automation?.ws_endpoint ?? raw.wsEndpoint ?? raw.endpoint;
    if (!wsEndpoint) {
      throw new Error(
        `Dolphin start response for profile ${profileId} did not contain a recognizable CDP endpoint field — ` +
          'inspect the raw response and update DolphinStartResponseRaw/startProfile (see README "API discovery").',
      );
    }
    return { wsEndpoint };
  }

  async stopProfile(profileId: string): Promise<void> {
    await this.request<unknown>(`/browser_profiles/${profileId}/stop`);
  }

  async getProfileStatus(profileId: string): Promise<'running' | 'stopped'> {
    // VERIFY: whether this endpoint exists at all; used only as a closure-
    // detection backstop alongside the CDP disconnect event.
    const raw = await this.request<{ status?: string; running?: boolean }>(
      `/browser_profiles/${profileId}/status`,
    );
    if (typeof raw.running === 'boolean') return raw.running ? 'running' : 'stopped';
    return raw.status === 'running' ? 'running' : 'stopped';
  }
}
