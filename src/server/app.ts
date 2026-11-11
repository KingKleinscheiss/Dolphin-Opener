import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { ConfigStore } from '../config/store.js';
import { DolphinClient } from '../dolphin/client.js';
import { ProxyPool } from '../proxy/pool.js';
import { WindowController } from '../cdp/windowController.js';
import { Scheduler } from '../scheduler/scheduler.js';
import { registerRoutes } from './routes.js';
import { registerWebSocket } from './ws.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface AppHandles {
  app: FastifyInstance;
  scheduler: Scheduler;
}

export async function buildApp(configStore: ConfigStore): Promise<AppHandles> {
  const app = Fastify({ logger: true });
  await app.register(fastifyWebsocket);

  const frontendDist = join(__dirname, '..', '..', 'frontend', 'dist');
  if (existsSync(frontendDist)) {
    await app.register(fastifyStatic, { root: frontendDist });
  }

  const initialConfig = configStore.get();
  const dolphin = new DolphinClient({
    baseUrl: initialConfig.dolphin.baseUrl,
    token: initialConfig.dolphin.token || undefined,
  });
  const proxyPool = new ProxyPool(initialConfig.proxies, {
    resetTimeoutMs: initialConfig.resetTimeoutMs,
    resetMaxRetries: initialConfig.resetMaxRetries,
    postResetSettleMs: initialConfig.postResetSettleMs,
  });
  const windowController = new WindowController();
  const scheduler = new Scheduler(dolphin, proxyPool, windowController);

  registerRoutes(app, {
    configStore,
    scheduler,
    proxyPool,
    getDolphinClient: () => dolphin,
    rebuildDolphinClient: () => {
      const cfg = configStore.get().dolphin;
      dolphin.setOptions({ baseUrl: cfg.baseUrl, token: cfg.token || undefined });
    },
  });
  registerWebSocket(app, scheduler);

  return { app, scheduler };
}
