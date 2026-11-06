import path from 'node:path';

const list = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

/**
 * Konfiguration ausschließlich über Umgebungsvariablen.
 * Lokal: .env im Repo-Root (siehe .env.example), auf Azure: App-Einstellungen.
 * Niemals Zugangsdaten ins Repo committen.
 */
export const config = {
  port: Number(process.env.PORT ?? 8080),
  host: process.env.HOST ?? '0.0.0.0',
  /** Verzeichnis für SQLite-Datenbank und Anhänge. Auf Azure App Service: /home/data (persistent). */
  dataDir: process.env.DATA_DIR ?? path.resolve('data'),
  /** Gebaute PWA, die der Server im Produktivbetrieb ausliefert. */
  webDist: process.env.WEB_DIST ?? path.resolve(import.meta.dirname, '../../web/dist'),
  /**
   * /api/* nur mit Azure-Anmeldung (Header X-MS-CLIENT-PRINCIPAL-ID). Auf Azure
   * setzen; lokal aus, dort arbeitet man als Entwicklungsbenutzer (DEV_USER_*).
   */
  requireAuth: process.env.REQUIRE_AUTH === 'true',
  /** Benutzer für die lokale Entwicklung ohne Anmeldung */
  devUser: {
    id: process.env.DEV_USER_ID || 'dev',
    name: process.env.DEV_USER_NAME || 'Entwickler',
    email: process.env.DEV_USER_EMAIL || 'dev@localhost',
  },
  /**
   * Administratoren (Entra-Objekt-IDs oder E-Mail-Adressen, kommagetrennt). Sie
   * sehen und verwalten alle Boards. Leer = der erste Benutzer, der sich anmeldet.
   */
  adminUsers: list(process.env.ADMIN_USERS),
  /** Höchstgröße eines Anhangs in MB */
  maxAttachmentMb: Number(process.env.MAX_ATTACHMENT_MB ?? 25),
};

export type Config = typeof config;
