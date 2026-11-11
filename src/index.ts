import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ConfigStore } from './config/store.js';
import { buildApp } from './server/app.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = process.env.DOLPHIN_OPENER_CONFIG ?? join(__dirname, '..', 'data', 'config.json');
const port = Number(process.env.PORT ?? 4545);

async function main() {
  const configStore = new ConfigStore(configPath);
  await configStore.load();
  const { app } = await buildApp(configStore);
  await app.listen({ port, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error('Fatal error starting Dolphin-Opener:', err);
  process.exit(1);
});
