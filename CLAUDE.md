# CLAUDE.md – Kontext für Claude-Sitzungen

Eigene Kanban-App (Boards, Listen, Karten) mit Entra-ID-Anmeldung und Rechten pro Board. Mehrere Benutzer. Sprache in UI, Kommentaren und Doku: **Deutsch**. Aufbau bewusst wie der Planer (`mdrollo/planer`).

## Architektur in Kürze

- **Datenmodell** in `packages/shared/src/index.ts` (Board, List, CardSummary/CardDetail, Permission, Activity …). Zeitstempel ISO in UTC.
- **Backend** (`packages/server`): Fastify 5. `app.ts` (Anmeldung, CSRF, Fehler, statische PWA), `routes/api.ts` (alle Routen, Validierung mit zod), `store.ts` (Datenzugriff und Geschäftsregeln), `events.ts` (Live-Kanal), `files.ts` (Anhänge auf Platte).
- **Rechte**: jede Route ermittelt das Board (`store.boardOfCard` usw.) und ruft `store.require(me, boardId, 'read' | 'write' | 'manage')`. Ohne Leserecht 404 (nicht 403), damit Boards unsichtbar bleiben. Verwalten ⇒ Schreiben ⇒ Lesen (`normalizePermission`). Archivierte Boards sind schreibgeschützt. Letzter Verwalter kann nicht herabgestuft werden (409). Admins (`ADMIN_USERS`, sonst erster Benutzer) dürfen alles.
- **Anmeldung**: Azure Easy Auth setzt `X-MS-CLIENT-PRINCIPAL*` (`auth/principal.ts`, aus dem Planer). Ohne `REQUIRE_AUTH` gilt `DEV_USER_*`. `store.touchUser` legt Benutzer an und übernimmt Einladungen (`board_invites`) per E-Mail. Ändernde Anfragen brauchen `X-Requested-With: XMLHttpRequest`.
- **Datenbank**: SQLite über `node:sqlite`, Migrationen als Liste in `server/src/db/index.ts` (`PRAGMA user_version`). Neue Migration = neuer Eintrag am Ende, bestehende nie ändern. Kein WAL (Azure `/home` ist ein Netzlaufwerk). `tx()` für Transaktionen.
- **Reihenfolge** von Listen/Karten: ganzzahlige `pos`, beim Verschieben schreibt `store.reorder` die Positionen der Liste neu (`{ listId, index }` vom Client). Archivierte zählen nicht mit; Wiederhergestellte kommen ans Ende.
- **Karte auf anderes Board** (`store.moveCard`, Ziel-Liste eines anderen Boards): Route prüft Schreibrecht auf Quelle und Ziel, `cards.board_id` wird umgesetzt, Labels über Name+Farbe abgebildet (fehlende im Ziel angelegt, `transferLabels`), Mitglieder ohne Leserecht am Ziel entfernt. Verlauf `card.transferred` in beiden Boards (im alten ohne `cardId`). Live-Ereignis an beide Boards. Der Kartendialog springt zum neuen Board, wenn `card.boardId` nicht mehr passt.
- **Verlauf**: `store.log()` mit Typ (`ActivityType`) und Namens-Schnappschüssen in `data`; Texte erzeugt der Client in `web/src/lib/format.ts` (`describeActivity`).
- **Anhänge**: Datei unter `DATA_DIR/attachments/<32 hex>`, Auslieferung nur Bilder (PNG/JPEG/GIF/WebP/AVIF) inline, alles andere als Download, immer `nosniff` + CSP `sandbox`. Erstes Bild wird Titelbild. Beim Löschen von Karte/Liste/Board die Dateien mit entfernen (Store liefert Schlüssel zurück).
- **Live-Kanal**: `GET /api/boards/:id/events` (SSE, `reply.hijack()`), `BoardEvents` im Prozess. Jede Änderung → `changed(req, boardId, cardId)`. Beim Herunterfahren schließt `preClose` alle Streams (sonst hängt `app.close()`).
- **PWA** (`packages/web`): React 19 + Vite + vite-plugin-pwa, Mini-Router (`/`, `/b/:id`, `/b/:id/c/:cardId`). Drag & Drop mit `@dnd-kit/core` + `sortable` in `BoardPage.tsx` (Mehr-Container-Muster: `onDragOver` verschiebt zwischen Listen lokal, `onDragEnd` ruft die API). Während des Ziehens werden Board-Neuladungen zurückgestellt. Bei aktivem Filter ist Ziehen aus. `BoardContext`/`useBoard()` hält Board, Rechte, `reload` und `version` (Kartendialog lädt bei jeder Änderung neu).
- Eingabefelder in ziehbaren Elementen stoppen `mousedown`/`touchstart` (dnd-kit nutzt Maus-/Touch-Sensor, nicht Pointer).
- Service Worker darf `/api/*/events` und `/api/attachments/` nicht cachen (vite.config.ts).
- Aus dem Planer übernommen: `principal.ts`, `web/src/lib/auth.ts`, `router.ts`, `richText.tsx`, `NoteEditor.tsx` (mit `alwaysEdit`).

## Befehle

```bash
npm install
npm run dev          # Backend :8080 (tsx, watch) + Vite :5173 mit /api-Proxy
npm test             # vitest (server)
npm run typecheck
npm run build
docker compose up --build
```

## Regeln

- **Nie Zugangsdaten committen.** Konfiguration nur über Umgebungsvariablen (`server/src/config.ts`), neue Variablen in `.env.example` dokumentieren.
- Keine echten Personendaten als Beispiel- oder Testdaten.
- Neue Route: Board ermitteln, `require(...)` aufrufen, nach Änderung `changed(...)`; Test in `server.test.ts` inkl. Rechtefall.
- Look & Feel: an bekannte Kanban-Boards angelehnt, aber eigene Gestaltung – keine fremden Logos, Namen oder Grafiken.

## Stand und nächste Schritte

Fertig: alles aus dem README (Boards, Listen, Karten, Drag & Drop, Karten zwischen Boards verschieben, Labels, Mitglieder, Fälligkeit, Checklisten, Anhänge, Kommentare, Verlauf, Archiv, Filter, Rechte, Einladungen, Live-Kanal, Docker, CI, Azure-Skripte).

Ideen:
1. Checklisten-Einträge per Drag & Drop sortieren
2. Anbindung an den Planer (Karten mit Fälligkeit als Quelle dort)
3. Benachrichtigungen (z. B. bei Erwähnung oder Zuweisung)
4. Backup der Datenbank und Anhänge
5. Karte kopieren (auch auf ein anderes Board)
