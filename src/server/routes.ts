import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { ConfigStore } from '../config/store.js';
import { DolphinClient } from '../dolphin/client.js';
import type { Proxy, RunConfig } from '../domain/types.js';
import type { ProxyPool } from '../proxy/pool.js';
import type { Scheduler } from '../scheduler/scheduler.js';

interface RouteDeps {
  configStore: ConfigStore;
  scheduler: Scheduler;
  proxyPool: ProxyPool;
  getDolphinClient: () => DolphinClient;
  rebuildDolphinClient: () => void;
}

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { configStore, scheduler, proxyPool, getDolphinClient, rebuildDolphinClient } = deps;

  app.get('/api/config', async () => configStore.get());

  app.post<{ Body: Record<string, unknown> }>('/api/config', async (req) => {
    const next = await configStore.save(req.body as never);
    rebuildDolphinClient();
    return next;
  });

  app.get('/api/tags', async () => getDolphinClient().listTags());
  app.get('/api/folders', async () => getDolphinClient().listFolders());

  app.get('/api/snapshot', async () => scheduler.getSnapshot());

  app.post('/api/proxies', async (req) => {
    const body = req.body as Partial<Proxy>;
    const config = configStore.get();
    const newProxy: Proxy = {
      id: body.id || randomUUID(),
      label: body.label ?? `Proxy ${config.proxies.length + 1}`,
      dolphinProxyId: body.dolphinProxyId ?? null,
      changeIpUrl: body.changeIpUrl ?? null,
      host: body.host ?? null,
      port: body.port ?? null,
      login: body.login ?? null,
      password: body.password ?? null,
      status: 'idle',
      assignedProfileId: null,
      lastResetAt: null,
      consecutiveResetFailures: 0,
      deadSince: null,
    };
    const proxies = [...config.proxies, newProxy];
    const saved = await configStore.save({ proxies });
    proxyPool.addProxy(newProxy);
    return saved;
  });

  app.delete<{ Params: { id: string }; Reply: unknown }>('/api/proxies/:id', async (req, reply) => {
    try {
      proxyPool.removeProxy(req.params.id);
    } catch (err) {
      reply.code(409);
      return { error: (err as Error).message };
    }
    const config = configStore.get();
    const proxies = config.proxies.filter((p) => p.id !== req.params.id);
    return configStore.save({ proxies });
  });

  app.post<{ Params: { id: string } }>('/api/proxies/:id/retry', async (req) => {
    scheduler.retryProxy(req.params.id);
    return { ok: true };
  });

  app.post<{ Params: { index: string } }>('/api/slots/:index/focus', async (req) => {
    await scheduler.focusSlot(Number(req.params.index));
    return { ok: true };
  });

  app.post<{ Params: { index: string } }>('/api/slots/:index/force-close', async (req) => {
    scheduler.forceCloseSlot(Number(req.params.index));
    return { ok: true };
  });

  app.post('/api/run/start', async (req, reply) => {
    const config = configStore.get();
    const body = req.body as Partial<RunConfig> | undefined;
    const runConfig: RunConfig = {
      targetDomain: body?.targetDomain ?? config.targetDomain,
      filter: body?.filter ?? config.lastFilter,
      slotCount: body?.slotCount ?? config.slotCount,
      foregroundCount: body?.foregroundCount ?? config.foregroundCount,
      resetTimeoutMs: config.resetTimeoutMs,
      resetMaxRetries: config.resetMaxRetries,
      postResetSettleMs: config.postResetSettleMs,
      autoFocusOnPromote: config.autoFocusOnPromote,
    };
    await configStore.save({
      targetDomain: runConfig.targetDomain,
      lastFilter: runConfig.filter,
      slotCount: runConfig.slotCount,
      foregroundCount: runConfig.foregroundCount,
    });

    if (config.proxies.length === 0) {
      reply.code(400);
      return { error: 'No proxies configured. Add at least one proxy in settings before starting a run.' };
    }
    if (!proxyPool.hasAnyActiveProxy()) {
      reply.code(400);
      return { error: 'All configured proxies are marked dead. Retry or add a proxy before starting a run.' };
    }

    let profiles;
    try {
      profiles = await getDolphinClient().listProfiles(runConfig.filter);
    } catch (err) {
      reply.code(502);
      return { error: `Could not load profiles from Dolphin Anty: ${(err as Error).message}` };
    }
    if (profiles.length === 0) {
      reply.code(400);
      return { error: 'No profiles matched the selected tag/folder filter.' };
    }

    scheduler.start(profiles, runConfig);
    return { ok: true, queued: profiles.length };
  });

  app.post('/api/run/stop', async () => {
    await scheduler.stop();
    return { ok: true };
  });
}
