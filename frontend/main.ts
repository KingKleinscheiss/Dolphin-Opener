import type { AppConfig, Folder, ProfileFilter, Proxy, SchedulerSnapshot, Slot, Tag } from './types';

const qs = <T extends Element>(sel: string): T => document.querySelector(sel) as T;

const SLOT_STATE_LABELS: Record<Slot['state'], string> = {
  empty: 'leer',
  assigning_proxy: 'Proxy wird zugewiesen…',
  resetting_proxy: 'Proxy wird zurückgesetzt…',
  launching_profile: 'Profil wird gestartet…',
  navigating: 'Seite wird geladen…',
  minimizing: 'wird in den Hintergrund geschoben…',
  background_ready: 'bereit (Hintergrund)',
  promoting: 'wird nach vorne geholt…',
  foreground: 'im Vordergrund',
  closing: 'wird geschlossen…',
  done: 'fertig',
};

let config: AppConfig | null = null;
let snapshot: SchedulerSnapshot | null = null;
let tags: Tag[] = [];
let folders: Folder[] = [];

function setError(message: string): void {
  qs<HTMLDivElement>('#controlError').textContent = message;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => undefined);
  if (!res.ok) {
    throw new Error((body && body.error) || `${path} fehlgeschlagen (${res.status})`);
  }
  return body as T;
}

function currentFilterMode(): ProfileFilter['mode'] {
  const checked = document.querySelector<HTMLInputElement>('input[name="filterMode"]:checked');
  return (checked?.value as ProfileFilter['mode']) ?? 'tag';
}

function selectedValues(select: HTMLSelectElement): string[] {
  return Array.from(select.selectedOptions).map((o) => o.value);
}

function populateFilterUI(): void {
  const tagSelect = qs<HTMLSelectElement>('#tagSelect');
  const folderSelect = qs<HTMLSelectElement>('#folderSelect');
  tagSelect.innerHTML = tags.map((t) => `<option value="${t.id}">${t.name}</option>`).join('');
  folderSelect.innerHTML = folders.map((f) => `<option value="${f.id}">${f.name}</option>`).join('');

  if (config) {
    const mode = config.lastFilter.mode;
    document.querySelector<HTMLInputElement>(`input[name="filterMode"][value="${mode}"]`)?.click();
    for (const opt of Array.from(tagSelect.options)) {
      opt.selected = config.lastFilter.tagIds.includes(opt.value);
    }
    for (const opt of Array.from(folderSelect.options)) {
      opt.selected = config.lastFilter.folderIds.includes(opt.value);
    }
  }
}

async function loadTagsAndFolders(): Promise<void> {
  try {
    [tags, folders] = await Promise.all([api<Tag[]>('/api/tags'), api<Folder[]>('/api/folders')]);
    setError('');
  } catch (err) {
    setError(
      `Tags/Ordner konnten nicht geladen werden (ist Dolphin Anty gestartet und die Local API erreichbar?): ${(err as Error).message}`,
    );
  }
  populateFilterUI();
}

async function loadConfig(): Promise<void> {
  config = await api<AppConfig>('/api/config');
  qs<HTMLInputElement>('#targetDomain').value = config.targetDomain;
  qs<HTMLInputElement>('#slotCount').value = String(config.slotCount);
  qs<HTMLInputElement>('#foregroundCount').value = String(config.foregroundCount);
  qs<HTMLInputElement>('#autoFocus').checked = config.autoFocusOnPromote;
  qs<HTMLInputElement>('#dolphinBaseUrl').value = config.dolphin.baseUrl;
  qs<HTMLInputElement>('#dolphinToken').value = config.dolphin.token;
  renderProxyList();
}

function renderProxyList(): void {
  if (!config) return;
  const container = qs<HTMLDivElement>('#proxyList');
  container.innerHTML = config.proxies
    .map(
      (p) => `
    <div class="proxy-row" data-id="${p.id}">
      <input class="p-label" value="${p.label}" placeholder="Label" />
      <input class="p-dolphinId" value="${p.dolphinProxyId ?? ''}" placeholder="Dolphin Proxy ID" />
      <input class="p-changeIpUrl" value="${p.changeIpUrl ?? ''}" placeholder="Change-IP-URL" />
      <input class="p-host" value="${p.host ?? ''}" placeholder="Host (Fallback)" />
      <input class="p-port" value="${p.port ?? ''}" placeholder="Port" />
      <input class="p-login" value="${p.login ?? ''}" placeholder="Login" />
      <input class="p-password" type="password" value="${p.password ?? ''}" placeholder="Passwort" />
      <button class="danger p-delete">Entfernen</button>
    </div>`,
    )
    .join('');

  container.querySelectorAll<HTMLButtonElement>('.p-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const row = btn.closest<HTMLDivElement>('.proxy-row')!;
      const id = row.dataset.id!;
      try {
        await api(`/api/proxies/${id}`, { method: 'DELETE' });
        await loadConfig();
      } catch (err) {
        setError((err as Error).message);
      }
    });
  });
}

async function saveProxyList(): Promise<void> {
  if (!config) return;
  const rows = Array.from(document.querySelectorAll<HTMLDivElement>('.proxy-row'));
  const proxies: Proxy[] = rows.map((row) => {
    const id = row.dataset.id!;
    const existing = config!.proxies.find((p) => p.id === id)!;
    return {
      ...existing,
      label: row.querySelector<HTMLInputElement>('.p-label')!.value,
      dolphinProxyId: row.querySelector<HTMLInputElement>('.p-dolphinId')!.value || null,
      changeIpUrl: row.querySelector<HTMLInputElement>('.p-changeIpUrl')!.value || null,
      host: row.querySelector<HTMLInputElement>('.p-host')!.value || null,
      port: Number(row.querySelector<HTMLInputElement>('.p-port')!.value) || null,
      login: row.querySelector<HTMLInputElement>('.p-login')!.value || null,
      password: row.querySelector<HTMLInputElement>('.p-password')!.value || null,
    };
  });
  await api('/api/config', { method: 'POST', body: JSON.stringify({ proxies }) });
  await loadConfig();
}

function renderProxyStrip(): void {
  const strip = qs<HTMLDivElement>('#proxyStrip');
  const proxies = snapshot?.proxies ?? config?.proxies ?? [];
  strip.innerHTML = proxies
    .map((p) => {
      const retry =
        p.status === 'dead' ? `<button class="retry-btn" data-id="${p.id}">Retry</button>` : '';
      return `<div class="proxy-chip status-${p.status}"><span>${p.label}</span><small>${p.status}</small>${retry}</div>`;
    })
    .join('');
  strip.querySelectorAll<HTMLButtonElement>('.retry-btn').forEach((btn) => {
    btn.addEventListener('click', () => api(`/api/proxies/${btn.dataset.id}/retry`, { method: 'POST' }));
  });
}

function renderQueue(): void {
  const q = snapshot?.queue;
  qs<HTMLDivElement>('#queueProgress').textContent = q
    ? `${q.done} / ${q.total} fertig (${q.remaining} verbleibend)`
    : '0 / 0 fertig';
  qs<HTMLDivElement>('#queueNext').textContent = q?.nextUp.length
    ? `Als Nächstes: ${q.nextUp.join(', ')}`
    : '';
}

function formatElapsed(since: number | null): string {
  if (!since) return '';
  const seconds = Math.floor((Date.now() - since) / 1000);
  return `${seconds}s`;
}

function renderSlots(): void {
  const grid = qs<HTMLDivElement>('#slotGrid');
  const slots = snapshot?.slots ?? [];
  if (slots.length === 0) {
    grid.innerHTML = '<p>Kein Lauf aktiv.</p>';
    return;
  }
  grid.innerHTML = slots
    .map((s) => {
      const classes = ['slot-card', `state-${s.state}`, s.isForeground ? 'foreground' : ''].join(' ');
      const timer = s.state === 'resetting_proxy' ? `<div class="timer">${formatElapsed(s.resetStartedAt)}</div>` : '';
      const errorHtml = s.error ? `<div class="slot-error">${s.error}</div>` : '';
      const focusBtn =
        s.state === 'foreground'
          ? `<button class="focus-btn" data-index="${s.index}">Fokussieren</button>`
          : '';
      const forceCloseBtn =
        s.state !== 'empty'
          ? `<button class="force-close-btn" data-index="${s.index}">Als geschlossen markieren</button>`
          : '';
      return `
        <div class="${classes}">
          <div class="slot-index">Slot ${s.index + 1}</div>
          <div class="slot-profile">${s.profileName ?? '—'}</div>
          <div class="slot-proxy">${s.proxyLabel ?? '—'}</div>
          <div class="slot-state">${SLOT_STATE_LABELS[s.state]}</div>
          ${timer}
          ${errorHtml}
          <div class="slot-actions">${focusBtn}${forceCloseBtn}</div>
        </div>`;
    })
    .join('');

  grid.querySelectorAll<HTMLButtonElement>('.focus-btn').forEach((btn) => {
    btn.addEventListener('click', () => api(`/api/slots/${btn.dataset.index}/focus`, { method: 'POST' }));
  });
  grid.querySelectorAll<HTMLButtonElement>('.force-close-btn').forEach((btn) => {
    btn.addEventListener('click', () =>
      api(`/api/slots/${btn.dataset.index}/force-close`, { method: 'POST' }),
    );
  });
}

function renderRunStatus(): void {
  qs<HTMLDivElement>('#runStatus').textContent = snapshot?.running ? 'läuft' : 'gestoppt';
}

function renderAll(): void {
  renderRunStatus();
  renderQueue();
  renderProxyStrip();
  renderSlots();
}

function connectWebSocket(): void {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'snapshot') {
      snapshot = msg.snapshot as SchedulerSnapshot;
      renderAll();
    }
  });
  ws.addEventListener('close', () => {
    setTimeout(connectWebSocket, 2000);
  });
}

function bindControlPanel(): void {
  qs<HTMLButtonElement>('#startBtn').addEventListener('click', async () => {
    setError('');
    const filter: ProfileFilter = {
      mode: currentFilterMode(),
      tagIds: selectedValues(qs<HTMLSelectElement>('#tagSelect')),
      folderIds: selectedValues(qs<HTMLSelectElement>('#folderSelect')),
    };
    const body = {
      targetDomain: qs<HTMLInputElement>('#targetDomain').value,
      filter,
      slotCount: Number(qs<HTMLInputElement>('#slotCount').value),
      foregroundCount: Number(qs<HTMLInputElement>('#foregroundCount').value),
    };
    try {
      await api('/api/run/start', { method: 'POST', body: JSON.stringify(body) });
    } catch (err) {
      setError((err as Error).message);
    }
  });

  qs<HTMLButtonElement>('#stopBtn').addEventListener('click', () =>
    api('/api/run/stop', { method: 'POST' }).catch((err) => setError((err as Error).message)),
  );

  qs<HTMLButtonElement>('#reloadFiltersBtn').addEventListener('click', loadTagsAndFolders);

  qs<HTMLButtonElement>('#addProxyBtn').addEventListener('click', async () => {
    await api('/api/proxies', { method: 'POST', body: JSON.stringify({}) });
    await loadConfig();
  });

  qs<HTMLInputElement>('#autoFocus').addEventListener('change', (e) => {
    const checked = (e.target as HTMLInputElement).checked;
    api('/api/config', { method: 'POST', body: JSON.stringify({ autoFocusOnPromote: checked }) });
  });

  qs<HTMLButtonElement>('#saveDolphinBtn').addEventListener('click', async () => {
    const dolphin = {
      baseUrl: qs<HTMLInputElement>('#dolphinBaseUrl').value,
      token: qs<HTMLInputElement>('#dolphinToken').value,
    };
    await api('/api/config', { method: 'POST', body: JSON.stringify({ dolphin }) });
    setError('');
  });

  qs<HTMLDivElement>('#proxySettings').addEventListener('toggle', () => {
    // nothing needed, rows already rendered by loadConfig()
  });

  // delegate a save action for the whole proxy table via double-click on the panel header,
  // and also expose it through a dedicated button appended once proxies exist.
  const proxyPanel = qs<HTMLElement>('#proxySettings');
  const saveProxiesBtn = document.createElement('button');
  saveProxiesBtn.textContent = 'Proxy-Änderungen speichern';
  saveProxiesBtn.addEventListener('click', () => saveProxyList().catch((err) => setError(err.message)));
  proxyPanel.appendChild(saveProxiesBtn);
}

async function init(): Promise<void> {
  bindControlPanel();
  await loadConfig();
  await loadTagsAndFolders();
  connectWebSocket();
  setInterval(renderSlots, 1000); // keep reset timers ticking between WS pushes
}

init().catch((err) => setError((err as Error).message));
