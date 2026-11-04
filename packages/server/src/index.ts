import { config } from './config.js';
import { openDb } from './db/index.js';
import { buildApp } from './app.js';

const db = openDb(config.dataDir);
const app = await buildApp({
  db,
  dataDir: config.dataDir,
  webDist: config.webDist,
  requireAuth: config.requireAuth,
  devUser: config.devUser,
  adminUsers: config.adminUsers,
  maxAttachmentMb: config.maxAttachmentMb,
  logger: true,
});

const shutdown = async () => {
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port: config.port, host: config.host });
