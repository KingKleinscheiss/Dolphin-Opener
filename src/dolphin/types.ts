/**
 * Shapes for the Dolphin Anty Local API.
 *
 * ASSUMPTION / TO VERIFY: none of these shapes have been confirmed against a
 * live Dolphin Anty installation yet. They are the most likely shapes based
 * on Dolphin Anty's public docs conventions, but every field name here must
 * be checked with a real `curl` against the running app (see README "API
 * discovery") before relying on this in production. Where multiple shapes
 * are plausible, DolphinClient normalizes defensively (see client.ts) so a
 * confirmed deviation can usually be fixed by adjusting one `pick*` helper
 * instead of every call site.
 */

export interface DolphinTagRaw {
  id: string | number;
  name: string;
}

export interface DolphinFolderRaw {
  id: string | number;
  name: string;
}

export interface DolphinProxyRaw {
  id?: string | number;
  name?: string;
  host?: string;
  port?: number;
  login?: string;
  password?: string;
  type?: string;
  // VERIFY: field name for the IP-rotation trigger URL — candidates seen in
  // the wild across proxy providers integrated with anti-detect browsers:
  changeIpUrl?: string;
  change_ip_url?: string;
  changeIpLink?: string;
  renewUrl?: string;
}

export interface DolphinProfileRaw {
  id: string | number;
  name: string;
  tags?: DolphinTagRaw[] | string[];
  folder?: DolphinFolderRaw | string | null;
  folderId?: string | number | null;
  folderName?: string | null;
  proxy?: DolphinProxyRaw | null;
  status?: string;
}

export interface DolphinListResponse<T> {
  data?: T[];
  items?: T[];
  // some Dolphin endpoints are known to paginate with total/page/pageSize
  total?: number;
  page?: number;
}

export interface DolphinStartResponseRaw {
  success?: boolean;
  automation?: {
    port?: number;
    wsEndpoint?: string;
    ws_endpoint?: string;
  };
  // VERIFY: alternates seen for the CDP endpoint field
  wsEndpoint?: string;
  port?: number;
  endpoint?: string;
}
