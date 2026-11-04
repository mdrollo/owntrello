import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import type { Me } from '@owntrello/shared';
import { ZodError } from 'zod';
import type { Db } from './db/index.js';
import { principalFromHeaders, type Principal } from './auth/principal.js';
import { HttpError } from './errors.js';
import { BoardEvents } from './events.js';
import { Store } from './store.js';
import { registerApi } from './routes/api.js';
import { AttachmentFiles } from './files.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** angemeldeter Benutzer (nur unter /api gesetzt) */
    me: Me;
  }
}

export interface AppOptions {
  db: Db;
  /** Verzeichnis für Anhänge (Unterordner attachments) */
  dataDir: string;
  /** Verzeichnis der gebauten PWA; fehlt es, liefert der Server nur die API aus. */
  webDist?: string;
  /** /api/* nur für angemeldete Benutzer (Azure-App-Service-Anmeldung) */
  requireAuth?: boolean;
  /** Benutzer ohne Anmeldung (nur wenn requireAuth aus ist) */
  devUser?: Principal;
  adminUsers?: string[];
  maxAttachmentMb?: number;
  logger?: boolean;
}

export interface AppContext {
  store: Store;
  events: BoardEvents;
  files: AttachmentFiles;
  maxAttachmentBytes: number;
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });
  const store = new Store(options.db, options.adminUsers ?? []);
  const ctx: AppContext = {
    store,
    events: new BoardEvents(),
    files: new AttachmentFiles(path.join(options.dataDir, 'attachments')),
    maxAttachmentBytes: (options.maxAttachmentMb ?? 25) * 1024 * 1024,
  };

  // Azure leitet Anfragen ohne Inhalt (z. B. DELETE) teils ohne Content-Type weiter –
  // Fastify lehnt das sonst mit 415 ab. Fehlende Typen werden als Text angenommen.
  app.addHook('onRequest', async (req) => {
    if (!req.headers['content-type']) req.headers['content-type'] = 'text/plain';
  });

  // Leerer Body mit Content-Type JSON (z. B. PUT ohne Inhalt) ist kein Fehler
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (body === '') return done(null, undefined);
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(new HttpError(400, 'Ungültiges JSON'), undefined);
    }
  });

  await app.register(fastifyMultipart, { limits: { fileSize: ctx.maxAttachmentBytes, files: 1 } });

  app.decorateRequest('me', null as unknown as Me);

  /**
   * Anmeldung: Die App-Hülle (HTML/JS/CSS) ist öffentlich, Daten gibt es nur über
   * /api. Dort muss die Azure-App-Service-Anmeldung den Benutzer in den Headern
   * X-MS-CLIENT-PRINCIPAL* mitliefern – Azure setzt sie selbst und entfernt sie
   * aus eingehenden Anfragen. Ohne REQUIRE_AUTH (lokal) gilt der Entwicklungsbenutzer.
   *
   * CSRF: Ändernde Anfragen brauchen X-Requested-With. Fremde Seiten können
   * diesen Header nicht ohne CORS-Freigabe setzen.
   */
  app.addHook('onRequest', async (req, reply) => {
    const url = req.url.split('?')[0] ?? '';
    if (!url.startsWith('/api/') || url === '/api/health') return;
    const principal =
      principalFromHeaders(req.headers) ?? (options.requireAuth ? null : (options.devUser ?? null));
    if (!principal) return reply.code(401).send({ error: 'Nicht angemeldet' });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-requested-with'] !== 'XMLHttpRequest') {
      return reply.code(403).send({ error: 'Header X-Requested-With fehlt' });
    }
    req.me = store.touchUser(principal);
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return reply.code(400).send({ error: `Ungültige Eingabe${first ? `: ${first.path.join('.')} – ${first.message}` : ''}` });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: (err as Error).message });
    req.log.error(err);
    return reply.code(500).send({ error: 'Interner Fehler' });
  });

  // Live-Verbindungen beim Herunterfahren beenden
  app.addHook('preClose', async () => ctx.events.closeAll());

  app.get('/api/health', async () => ({ ok: true }));
  registerApi(app, ctx);

  // Gebaute PWA ausliefern, mit SPA-Fallback für Seitenpfade ohne Dateiendung
  if (options.webDist && fs.existsSync(path.join(options.webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: options.webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      const url = req.url.split('?')[0] ?? '';
      if (req.method === 'GET' && !url.startsWith('/api/') && !path.extname(url)) {
        return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
      }
      return reply.code(404).send({ error: 'Nicht gefunden' });
    });
  }

  return app;
}
