import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

/**
 * SQLite über das in Node eingebaute Modul node:sqlite (keine nativen Pakete,
 * läuft unverändert lokal, im Container und auf Azure App Service).
 */
export function openDb(dataDir: string): Db {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'owntrello.db'));
  // Bewusst kein WAL-Modus: Auf Azure App Service liegt /home auf einem
  // Netzwerk-Dateisystem, dort funktioniert WAL nicht zuverlässig.
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

export function openMemoryDb(): Db {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

/**
 * Migrationen in Reihenfolge; Stand über PRAGMA user_version.
 * Neue Migration = neuer Eintrag am Ende, bestehende nie ändern.
 */
const migrations: string[] = [
  `CREATE TABLE users (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     email TEXT NOT NULL,
     is_admin INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL,
     last_seen TEXT NOT NULL
   );
   CREATE INDEX users_email ON users (lower(email));

   CREATE TABLE boards (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     title TEXT NOT NULL,
     color TEXT NOT NULL,
     archived INTEGER NOT NULL DEFAULT 0,
     created_by TEXT REFERENCES users (id) ON DELETE SET NULL,
     created_at TEXT NOT NULL
   );

   CREATE TABLE board_members (
     board_id INTEGER NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
     user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
     can_read INTEGER NOT NULL DEFAULT 1,
     can_write INTEGER NOT NULL DEFAULT 0,
     can_manage INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (board_id, user_id)
   );

   CREATE TABLE board_invites (
     board_id INTEGER NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
     email TEXT NOT NULL,
     can_read INTEGER NOT NULL DEFAULT 1,
     can_write INTEGER NOT NULL DEFAULT 0,
     can_manage INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (board_id, email)
   );

   CREATE TABLE board_stars (
     user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
     board_id INTEGER NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
     PRIMARY KEY (user_id, board_id)
   );

   CREATE TABLE labels (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     board_id INTEGER NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
     name TEXT NOT NULL DEFAULT '',
     color TEXT NOT NULL
   );

   CREATE TABLE lists (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     board_id INTEGER NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
     title TEXT NOT NULL,
     pos INTEGER NOT NULL,
     archived INTEGER NOT NULL DEFAULT 0
   );
   CREATE INDEX lists_board ON lists (board_id, pos);

   CREATE TABLE cards (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     board_id INTEGER NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
     list_id INTEGER NOT NULL REFERENCES lists (id) ON DELETE CASCADE,
     title TEXT NOT NULL,
     description TEXT NOT NULL DEFAULT '',
     pos INTEGER NOT NULL,
     archived INTEGER NOT NULL DEFAULT 0,
     due TEXT,
     due_done INTEGER NOT NULL DEFAULT 0,
     cover_attachment_id INTEGER,
     created_by TEXT REFERENCES users (id) ON DELETE SET NULL,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE INDEX cards_list ON cards (list_id, pos);
   CREATE INDEX cards_board ON cards (board_id);

   CREATE TABLE card_labels (
     card_id INTEGER NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
     label_id INTEGER NOT NULL REFERENCES labels (id) ON DELETE CASCADE,
     PRIMARY KEY (card_id, label_id)
   );

   CREATE TABLE card_members (
     card_id INTEGER NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
     user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
     PRIMARY KEY (card_id, user_id)
   );

   CREATE TABLE checklists (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     card_id INTEGER NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
     title TEXT NOT NULL,
     pos INTEGER NOT NULL
   );

   CREATE TABLE checklist_items (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     checklist_id INTEGER NOT NULL REFERENCES checklists (id) ON DELETE CASCADE,
     text TEXT NOT NULL,
     done INTEGER NOT NULL DEFAULT 0,
     pos INTEGER NOT NULL
   );

   CREATE TABLE comments (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     card_id INTEGER NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
     user_id TEXT NOT NULL REFERENCES users (id),
     text TEXT NOT NULL,
     created_at TEXT NOT NULL,
     edited_at TEXT
   );
   CREATE INDEX comments_card ON comments (card_id);

   CREATE TABLE attachments (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     card_id INTEGER NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
     user_id TEXT NOT NULL REFERENCES users (id),
     filename TEXT NOT NULL,
     mime TEXT NOT NULL,
     size INTEGER NOT NULL,
     storage_key TEXT NOT NULL UNIQUE,
     created_at TEXT NOT NULL
   );
   CREATE INDEX attachments_card ON attachments (card_id);

   CREATE TABLE activity (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     board_id INTEGER NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
     card_id INTEGER REFERENCES cards (id) ON DELETE SET NULL,
     user_id TEXT NOT NULL REFERENCES users (id),
     type TEXT NOT NULL,
     data TEXT NOT NULL DEFAULT '{}',
     created_at TEXT NOT NULL
   );
   CREATE INDEX activity_board ON activity (board_id, id);
   CREATE INDEX activity_card ON activity (card_id, id);`,
];

function migrate(db: Db): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let v = row.user_version; v < migrations.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(migrations[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

/** fn in einer Transaktion ausführen (verschachtelt: läuft in der äußeren mit) */
export function tx<T>(db: Db, fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
