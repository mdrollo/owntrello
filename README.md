# owntrello

Eigene Kanban-App: Boards mit Listen und Karten im bekannten Kartenlook – mit Drag & Drop, Labels, Mitgliedern, Fälligkeiten, Checklisten, Anhängen, Kommentaren, Aktivitätsverlauf und Archiv. Anmeldung über **Entra ID**, Rechte **pro Board** (Lesen, Schreiben, Verwalten). Läuft als Container, Änderungen anderer erscheinen live.

Gleicher Aufbau wie der [Planer](https://github.com/mdrollo/planer): npm-Workspaces, Fastify, SQLite über `node:sqlite`, React/Vite-PWA, Azure App Service mit Easy Auth.

## Schnellstart (lokal)

Voraussetzung: Node.js 22.16 oder neuer.

```bash
npm install
cp .env.example .env      # optional, Standardwerte reichen
npm run dev               # Backend auf :8080, App auf http://localhost:5173
```

Lokal gibt es keine Anmeldung; man arbeitet als Entwicklungsbenutzer (`DEV_USER_*`), der als erster Benutzer automatisch Administrator ist.

```bash
npm test                  # Server-Tests (vitest)
npm run typecheck
npm run build
```

## Im Container

```bash
docker compose up --build
# http://localhost:8080
```

Datenbank und Anhänge liegen im Volume `owntrello-data` (`/data`).

## Funktionen

| Bereich | Was geht |
| --- | --- |
| Boards | anlegen, umbenennen, Hintergrundfarbe, Stern, archivieren (schreibgeschützt), löschen |
| Listen | anlegen, umbenennen, per Drag & Drop sortieren, archivieren, löschen |
| Karten | anlegen (Enter = nächste), per Drag & Drop innerhalb und zwischen Listen verschieben, über „Verschieben“ auch auf ein anderes Board, Dialog mit Titel, Beschreibung (Fett, Kursiv, Listen, Links), Labels, Mitglieder, Fälligkeit mit „erledigt“, Checklisten, Anhänge (auch per Drag & Drop von Dateien, Bilder als Titelbild), Kommentare, Verlauf, archivieren, löschen |
| Board-Menü | Labels verwalten, Archiv (wiederherstellen/löschen), Aktivität, Board verlassen |
| Filter | Stichwort, Labels, Mitglieder, Fälligkeit |
| Live | Änderungen anderer erscheinen sofort (Server-Sent Events) |
| Mobil | Karten per langem Drücken ziehen, Wischen scrollt |

## Rechte

Jede Person hat pro Board eine Kombination aus:

| Recht | erlaubt |
| --- | --- |
| **Lesen** | Board, Karten, Kommentare, Anhänge ansehen |
| **Schreiben** | zusätzlich alles anlegen, ändern, verschieben, kommentieren (schließt Lesen ein) |
| **Verwalten** | zusätzlich Personen freigeben, Rechte ändern, Board archivieren/löschen (schließt Schreiben ein) |

- Wer ein Board anlegt, verwaltet es. Ein Board behält immer mindestens einen Verwalter.
- Freigabe per E-Mail-Adresse („Teilen“). Hat sich die Person noch nie angemeldet, wird die Freigabe bei ihrer ersten Anmeldung übernommen.
- Boards ohne Leserecht sind unsichtbar (die API antwortet mit 404).
- **Administratoren** (`ADMIN_USERS`, sonst der erste Benutzer überhaupt) sehen und verwalten alle Boards.

## Aufbau

```
packages/
  shared/   Datenmodell und Typen (Board, List, Card, Permission …)
  server/   Fastify-Backend: REST-API, Rechteprüfung, SQLite, Anhänge, Live-Kanal
  web/      React-PWA mit @dnd-kit für Drag & Drop
scripts/    Azure-Einrichtung (Cloud Shell)
docs/       Hosting auf Azure
```

### API (Auszug)

| Methode | Pfad | Zweck |
| --- | --- | --- |
| GET | `/api/boards` | Boards mit Lesezugriff |
| GET | `/api/boards/:id` | Board mit Listen, Karten, Labels, Mitgliedern |
| GET | `/api/boards/:id/events` | Live-Kanal (Server-Sent Events) |
| POST | `/api/boards/:id/members` | Freigabe per E-Mail `{ email, canRead, canWrite, canManage }` |
| PUT | `/api/boards/:id/members/:userId` | Rechte ändern (ohne `canRead` = entfernen) |
| POST | `/api/lists/:id/cards` | Karte anlegen |
| POST | `/api/cards/:id/move` | Karte verschieben `{ listId, index }` – Liste darf auf einem anderen Board liegen (Schreibrecht auf beiden) |
| GET | `/api/cards/:id` | Karte mit Checklisten, Kommentaren, Anhängen, Verlauf |
| POST | `/api/cards/:id/attachments` | Anhang hochladen (multipart) |

Ändernde Anfragen brauchen den Header `X-Requested-With: XMLHttpRequest` (Schutz vor CSRF).

## Deployment

Jeder Push auf `main` testet, baut ein Container-Image und rollt es – sobald eingerichtet – auf Azure App Service aus. Einrichtung: [docs/azure.md](docs/azure.md).

## Zugangsdaten

Es stehen keine Zugangsdaten im Repo. Konfiguration nur über Umgebungsvariablen, siehe [.env.example](.env.example).
