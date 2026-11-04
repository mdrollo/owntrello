import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { BoardDetail, BoardSummary, CardDetail, CardSummary } from '@owntrello/shared';
import { buildApp } from './app.js';
import { openMemoryDb } from './db/index.js';

/** Header, wie sie die Azure-App-Service-Anmeldung setzt */
function principal(id: string, name: string, email: string): Record<string, string> {
  const claims = [
    { typ: 'name', val: name },
    { typ: 'preferred_username', val: email },
  ];
  return {
    'x-ms-client-principal-id': id,
    'x-ms-client-principal-name': email,
    'x-ms-client-principal': Buffer.from(JSON.stringify({ claims })).toString('base64'),
    'x-requested-with': 'XMLHttpRequest',
  };
}

const ANNA = principal('oid-anna', 'Anna Beispiel', 'anna@example.org');
const BEN = principal('oid-ben', 'Ben Muster', 'ben@example.org');
const CARLA = principal('oid-carla', 'Carla Test', 'carla@example.org');

let app: FastifyInstance;
let dataDir: string;

beforeEach(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'owntrello-'));
  app = await buildApp({ db: openMemoryDb(), dataDir, requireAuth: true });
});

afterEach(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function call<T = unknown>(
  as: Record<string, string>,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const res = await app.inject({ method, url, headers: as, payload: body as never });
  return { status: res.statusCode, body: (res.body ? JSON.parse(res.body) : undefined) as T };
}

async function newBoard(as = ANNA, title = 'Projekt'): Promise<BoardDetail> {
  const { body } = await call<{ id: number }>(as, 'POST', '/api/boards', { title });
  return (await call<BoardDetail>(as, 'GET', `/api/boards/${body.id}`)).body;
}

describe('Anmeldung', () => {
  it('lehnt /api ohne Anmeldung ab, /api/health ist offen', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/boards' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
  });

  it('verlangt X-Requested-With bei ändernden Anfragen', async () => {
    const { 'x-requested-with': _, ...headers } = ANNA;
    const res = await app.inject({ method: 'POST', url: '/api/boards', headers, payload: { title: 'X' } });
    expect(res.statusCode).toBe(403);
  });

  it('erster Benutzer wird Administrator, weitere nicht', async () => {
    expect((await call<{ isAdmin: boolean }>(ANNA, 'GET', '/api/me')).body.isAdmin).toBe(true);
    const ben = await call<{ isAdmin: boolean; name: string }>(BEN, 'GET', '/api/me');
    expect(ben.body).toMatchObject({ isAdmin: false, name: 'Ben Muster' });
  });

  it('ohne REQUIRE_AUTH gilt der Entwicklungsbenutzer', async () => {
    const local = await buildApp({
      db: openMemoryDb(),
      dataDir,
      devUser: { id: 'dev', name: 'Entwickler', email: 'dev@localhost' },
    });
    const res = await local.inject({ method: 'GET', url: '/api/me' });
    expect(JSON.parse(res.body)).toMatchObject({ id: 'dev', name: 'Entwickler' });
    await local.close();
  });
});

describe('Boards und Rechte', () => {
  beforeEach(async () => {
    // Anna ist Administratorin; Ben und Carla sind normale Benutzer
    await call(ANNA, 'GET', '/api/me');
    await call(BEN, 'GET', '/api/me');
    await call(CARLA, 'GET', '/api/me');
  });

  it('neues Board hat Standardlisten, Labels und den Ersteller als Verwalter', async () => {
    const board = await newBoard(BEN);
    expect(board.lists.map((l) => l.title)).toEqual(['Zu erledigen', 'In Arbeit', 'Erledigt']);
    expect(board.labels).toHaveLength(6);
    expect(board.members).toEqual([
      { user: expect.objectContaining({ id: 'oid-ben' }), canRead: true, canWrite: true, canManage: true },
    ]);
  });

  it('ohne Freigabe ist das Board unsichtbar (404)', async () => {
    const board = await newBoard(BEN);
    expect((await call(CARLA, 'GET', `/api/boards/${board.board.id}`)).status).toBe(404);
    expect((await call<{ boards: BoardSummary[] }>(CARLA, 'GET', '/api/boards')).body.boards).toEqual([]);
    // Administratorin sieht alles
    expect((await call(ANNA, 'GET', `/api/boards/${board.board.id}`)).status).toBe(200);
  });

  it('Leserecht: sehen ja, ändern nein', async () => {
    const board = await newBoard(BEN);
    const b = board.board.id;
    const list = board.lists[0]!.id;
    expect((await call(BEN, 'POST', `/api/boards/${b}/members`, { email: 'carla@example.org', canRead: true })).status).toBe(200);

    const seen = await call<BoardDetail>(CARLA, 'GET', `/api/boards/${b}`);
    expect(seen.status).toBe(200);
    expect(seen.body.permission).toEqual({ canRead: true, canWrite: false, canManage: false });
    expect((await call(CARLA, 'POST', `/api/lists/${list}/cards`, { title: 'Nein' })).status).toBe(403);
    expect((await call(CARLA, 'PATCH', `/api/boards/${b}`, { title: 'Nein' })).status).toBe(403);
    expect((await call(CARLA, 'POST', `/api/boards/${b}/members`, { email: 'x@example.org' })).status).toBe(403);
  });

  it('Schreibrecht: Karten anlegen ja, Rechte verwalten nein', async () => {
    const board = await newBoard(BEN);
    const b = board.board.id;
    await call(BEN, 'PUT', `/api/boards/${b}/members/oid-carla`, { canWrite: true });
    const created = await call<CardSummary>(CARLA, 'POST', `/api/lists/${board.lists[0]!.id}/cards`, { title: 'Ja' });
    expect(created.status).toBe(201);
    expect((await call(CARLA, 'PUT', `/api/boards/${b}/members/oid-carla`, { canManage: true })).status).toBe(403);
    // Schreiben schließt Lesen ein
    const detail = await call<BoardDetail>(BEN, 'GET', `/api/boards/${b}`);
    expect(detail.body.members.find((m) => m.user.id === 'oid-carla')).toMatchObject({ canRead: true, canWrite: true });
  });

  it('Leserecht entziehen entfernt das Mitglied auch von Karten', async () => {
    const board = await newBoard(BEN);
    const b = board.board.id;
    await call(BEN, 'PUT', `/api/boards/${b}/members/oid-carla`, { canWrite: true });
    const card = (await call<CardSummary>(BEN, 'POST', `/api/lists/${board.lists[0]!.id}/cards`, { title: 'K' })).body;
    expect((await call(BEN, 'PUT', `/api/cards/${card.id}/members/oid-carla`)).status).toBe(200);
    await call(BEN, 'PUT', `/api/boards/${b}/members/oid-carla`, { canRead: false });
    expect((await call(CARLA, 'GET', `/api/boards/${b}`)).status).toBe(404);
    expect((await call<CardDetail>(BEN, 'GET', `/api/cards/${card.id}`)).body.memberIds).toEqual([]);
  });

  it('Karten nur Board-Mitgliedern zuweisbar', async () => {
    const board = await newBoard(BEN);
    const card = (await call<CardSummary>(BEN, 'POST', `/api/lists/${board.lists[0]!.id}/cards`, { title: 'K' })).body;
    expect((await call(BEN, 'PUT', `/api/cards/${card.id}/members/oid-carla`)).status).toBe(400);
  });

  it('letzter Verwalter kann nicht herabgestuft werden', async () => {
    const board = await newBoard(BEN);
    const res = await call<{ error: string }>(BEN, 'PUT', `/api/boards/${board.board.id}/members/oid-ben`, { canWrite: true });
    expect(res.status).toBe(409);
  });

  it('Einladung per E-Mail wird bei der ersten Anmeldung übernommen', async () => {
    const board = await newBoard(BEN);
    const b = board.board.id;
    const res = await call<{ result: string }>(BEN, 'POST', `/api/boards/${b}/members`, {
      email: 'Dora@Example.org',
      canWrite: true,
    });
    expect(res.body.result).toBe('invite');
    expect((await call<BoardDetail>(BEN, 'GET', `/api/boards/${b}`)).body.invites).toEqual([
      { email: 'dora@example.org', canRead: true, canWrite: true, canManage: false },
    ]);

    const DORA = principal('oid-dora', 'Dora Neu', 'dora@example.org');
    const boards = (await call<{ boards: BoardSummary[] }>(DORA, 'GET', '/api/boards')).body.boards;
    expect(boards.map((x) => [x.id, x.permission.canWrite])).toEqual([[b, true]]);
    expect((await call<BoardDetail>(BEN, 'GET', `/api/boards/${b}`)).body.invites).toEqual([]);
  });

  it('archiviertes Board ist schreibgeschützt; nur Verwalter archivieren', async () => {
    const board = await newBoard(BEN);
    const b = board.board.id;
    await call(BEN, 'PUT', `/api/boards/${b}/members/oid-carla`, { canWrite: true });
    expect((await call(CARLA, 'PATCH', `/api/boards/${b}`, { archived: true })).status).toBe(403);
    expect((await call(BEN, 'PATCH', `/api/boards/${b}`, { archived: true })).status).toBe(200);
    expect((await call(CARLA, 'POST', `/api/lists/${board.lists[0]!.id}/cards`, { title: 'X' })).status).toBe(403);
    expect((await call(BEN, 'PATCH', `/api/boards/${b}`, { archived: false })).status).toBe(200);
  });

  it('Board löschen nur als Verwalter', async () => {
    const board = await newBoard(BEN);
    const b = board.board.id;
    await call(BEN, 'PUT', `/api/boards/${b}/members/oid-carla`, { canWrite: true });
    expect((await call(CARLA, 'DELETE', `/api/boards/${b}`)).status).toBe(403);
    expect((await call(BEN, 'DELETE', `/api/boards/${b}`)).status).toBe(204);
    expect((await call(BEN, 'GET', `/api/boards/${b}`)).status).toBe(404);
  });
});

describe('Listen und Karten', () => {
  it('verschiebt Karten innerhalb und zwischen Listen', async () => {
    const board = await newBoard();
    const [todo, doing] = board.lists;
    const titles = ['A', 'B', 'C'];
    const ids: number[] = [];
    for (const title of titles) {
      ids.push((await call<CardSummary>(ANNA, 'POST', `/api/lists/${todo!.id}/cards`, { title })).body.id);
    }
    // C nach oben
    await call(ANNA, 'POST', `/api/cards/${ids[2]}/move`, { listId: todo!.id, index: 0 });
    // A in die zweite Liste
    await call(ANNA, 'POST', `/api/cards/${ids[0]}/move`, { listId: doing!.id, index: 0 });

    const detail = (await call<BoardDetail>(ANNA, 'GET', `/api/boards/${board.board.id}`)).body;
    const inList = (listId: number) =>
      detail.cards.filter((c) => c.listId === listId).sort((a, b) => a.pos - b.pos).map((c) => c.title);
    expect(inList(todo!.id)).toEqual(['C', 'B']);
    expect(inList(doing!.id)).toEqual(['A']);

    const activity = (await call<CardDetail>(ANNA, 'GET', `/api/cards/${ids[0]}`)).body.activity;
    expect(activity[0]).toMatchObject({ type: 'card.moved', data: { from: 'Zu erledigen', to: 'In Arbeit' } });
  });

  it('neue Karte oben einfügen', async () => {
    const board = await newBoard();
    const list = board.lists[0]!.id;
    await call(ANNA, 'POST', `/api/lists/${list}/cards`, { title: 'unten' });
    await call(ANNA, 'POST', `/api/lists/${list}/cards`, { title: 'oben', position: 'top' });
    const cards = (await call<BoardDetail>(ANNA, 'GET', `/api/boards/${board.board.id}`)).body.cards;
    expect(cards.sort((a, b) => a.pos - b.pos).map((c) => c.title)).toEqual(['oben', 'unten']);
  });

  it('verschiebt Listen', async () => {
    const board = await newBoard();
    const last = board.lists[2]!;
    await call(ANNA, 'POST', `/api/lists/${last.id}/move`, { index: 0 });
    const lists = (await call<BoardDetail>(ANNA, 'GET', `/api/boards/${board.board.id}`)).body.lists;
    expect(lists.map((l) => l.title)).toEqual(['Erledigt', 'Zu erledigen', 'In Arbeit']);
  });

  it('archivierte Karten und Listen verschwinden vom Board und stehen im Archiv', async () => {
    const board = await newBoard();
    const [todo, doing] = board.lists;
    const card = (await call<CardSummary>(ANNA, 'POST', `/api/lists/${todo!.id}/cards`, { title: 'Alt' })).body;
    await call(ANNA, 'POST', `/api/lists/${doing!.id}/cards`, { title: 'In Liste' });
    await call(ANNA, 'PATCH', `/api/cards/${card.id}`, { archived: true });
    await call(ANNA, 'PATCH', `/api/lists/${doing!.id}`, { archived: true });

    const detail = (await call<BoardDetail>(ANNA, 'GET', `/api/boards/${board.board.id}`)).body;
    expect(detail.cards).toEqual([]);
    expect(detail.lists.map((l) => l.title)).toEqual(['Zu erledigen', 'Erledigt']);

    const archive = (await call<{ lists: { title: string }[]; cards: { title: string; listTitle: string }[] }>(
      ANNA,
      'GET',
      `/api/boards/${board.board.id}/archive`,
    )).body;
    expect(archive.lists.map((l) => l.title)).toEqual(['In Arbeit']);
    expect(archive.cards).toEqual([expect.objectContaining({ title: 'Alt', listTitle: 'Zu erledigen' })]);
  });

  it('Labels, Fälligkeit, Checklisten und Kommentare erscheinen als Badges', async () => {
    const board = await newBoard();
    const card = (await call<CardSummary>(ANNA, 'POST', `/api/lists/${board.lists[0]!.id}/cards`, { title: 'K' })).body;
    const label = board.labels[0]!;
    await call(ANNA, 'PUT', `/api/cards/${card.id}/labels/${label.id}`);
    await call(ANNA, 'PATCH', `/api/cards/${card.id}`, { due: '2026-12-01T09:00:00.000Z', description: 'Text' });
    const checklist = (await call<{ id: number }>(ANNA, 'POST', `/api/cards/${card.id}/checklists`, { title: 'Schritte' })).body;
    const item = (await call<{ id: number }>(ANNA, 'POST', `/api/checklists/${checklist.id}/items`, { text: 'eins' })).body;
    await call(ANNA, 'POST', `/api/checklists/${checklist.id}/items`, { text: 'zwei' });
    await call(ANNA, 'PATCH', `/api/checkitems/${item.id}`, { done: true });
    await call(ANNA, 'POST', `/api/cards/${card.id}/comments`, { text: 'Hallo' });

    const summary = (await call<BoardDetail>(ANNA, 'GET', `/api/boards/${board.board.id}`)).body.cards[0]!;
    expect(summary).toMatchObject({
      labelIds: [label.id],
      hasDescription: true,
      due: '2026-12-01T09:00:00.000Z',
      badges: { comments: 1, attachments: 0, checkItems: 2, checkItemsDone: 1 },
    });
  });

  it('Label eines anderen Boards wird abgelehnt', async () => {
    const one = await newBoard(ANNA, 'Eins');
    const two = await newBoard(ANNA, 'Zwei');
    const card = (await call<CardSummary>(ANNA, 'POST', `/api/lists/${one.lists[0]!.id}/cards`, { title: 'K' })).body;
    expect((await call(ANNA, 'PUT', `/api/cards/${card.id}/labels/${two.labels[0]!.id}`)).status).toBe(400);
  });

  it('Kommentare: nur eigene bearbeiten', async () => {
    const board = await newBoard();
    await call(BEN, 'GET', '/api/me');
    await call(ANNA, 'PUT', `/api/boards/${board.board.id}/members/oid-ben`, { canWrite: true });
    const card = (await call<CardSummary>(ANNA, 'POST', `/api/lists/${board.lists[0]!.id}/cards`, { title: 'K' })).body;
    const comment = (await call<{ id: number }>(ANNA, 'POST', `/api/cards/${card.id}/comments`, { text: 'von Anna' })).body;
    expect((await call(BEN, 'PATCH', `/api/comments/${comment.id}`, { text: 'geändert' })).status).toBe(403);
    expect((await call(BEN, 'DELETE', `/api/comments/${comment.id}`)).status).toBe(403);
    expect((await call(ANNA, 'PATCH', `/api/comments/${comment.id}`, { text: 'geändert' })).status).toBe(200);
    const detail = (await call<CardDetail>(ANNA, 'GET', `/api/cards/${card.id}`)).body;
    expect(detail.comments[0]).toMatchObject({ text: 'geändert', user: { name: 'Anna Beispiel' } });
    expect(detail.comments[0]!.editedAt).not.toBeNull();
  });
});

describe('Anhänge', () => {
  function multipart(filename: string, mime: string, content: Buffer) {
    const boundary = '----owntrello-test';
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
      ),
      content,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
  }

  it('lädt hoch, setzt Titelbild, liefert mit sicheren Headern aus und löscht die Datei', async () => {
    const board = await newBoard();
    const card = (await call<CardSummary>(ANNA, 'POST', `/api/lists/${board.lists[0]!.id}/cards`, { title: 'K' })).body;
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    const { payload, headers } = multipart('bild.png', 'image/png', png);
    const up = await app.inject({ method: 'POST', url: `/api/cards/${card.id}/attachments`, headers: { ...ANNA, ...headers }, payload });
    expect(up.statusCode).toBe(201);
    const att = JSON.parse(up.body) as { id: number; isImage: boolean };
    expect(att.isImage).toBe(true);
    expect((await call<CardDetail>(ANNA, 'GET', `/api/cards/${card.id}`)).body.coverAttachmentId).toBe(att.id);

    const get = await app.inject({ method: 'GET', url: `/api/attachments/${att.id}`, headers: ANNA });
    expect(get.statusCode).toBe(200);
    expect(get.headers['content-type']).toBe('image/png');
    expect(get.headers['content-security-policy']).toContain('sandbox');
    expect(get.rawPayload.equals(png)).toBe(true);

    const files = () => fs.readdirSync(path.join(dataDir, 'attachments'));
    expect(files()).toHaveLength(1);
    expect((await call(ANNA, 'DELETE', `/api/attachments/${att.id}`)).status).toBe(204);
    expect(files()).toHaveLength(0);
    expect((await call<CardDetail>(ANNA, 'GET', `/api/cards/${card.id}`)).body.coverAttachmentId).toBeNull();
  });

  it('HTML/SVG nie inline, sondern als Download', async () => {
    const board = await newBoard();
    const card = (await call<CardSummary>(ANNA, 'POST', `/api/lists/${board.lists[0]!.id}/cards`, { title: 'K' })).body;
    const { payload, headers } = multipart('x.svg', 'image/svg+xml', Buffer.from('<svg onload="alert(1)"/>'));
    const up = await app.inject({ method: 'POST', url: `/api/cards/${card.id}/attachments`, headers: { ...ANNA, ...headers }, payload });
    const att = JSON.parse(up.body) as { id: number; isImage: boolean };
    expect(att.isImage).toBe(false);
    const get = await app.inject({ method: 'GET', url: `/api/attachments/${att.id}`, headers: ANNA });
    expect(get.headers['content-type']).toBe('application/octet-stream');
    expect(get.headers['content-disposition']).toMatch(/^attachment;/);
  });

  it('ohne Leserecht kein Zugriff auf Anhänge', async () => {
    const board = await newBoard();
    const card = (await call<CardSummary>(ANNA, 'POST', `/api/lists/${board.lists[0]!.id}/cards`, { title: 'K' })).body;
    const { payload, headers } = multipart('a.txt', 'text/plain', Buffer.from('geheim'));
    const up = await app.inject({ method: 'POST', url: `/api/cards/${card.id}/attachments`, headers: { ...ANNA, ...headers }, payload });
    const att = JSON.parse(up.body) as { id: number };
    expect((await call(BEN, 'GET', `/api/attachments/${att.id}`)).status).toBe(404);
  });

  it('Board löschen entfernt auch die Dateien', async () => {
    const board = await newBoard();
    const card = (await call<CardSummary>(ANNA, 'POST', `/api/lists/${board.lists[0]!.id}/cards`, { title: 'K' })).body;
    const { payload, headers } = multipart('a.txt', 'text/plain', Buffer.from('x'));
    await app.inject({ method: 'POST', url: `/api/cards/${card.id}/attachments`, headers: { ...ANNA, ...headers }, payload });
    await call(ANNA, 'DELETE', `/api/boards/${board.board.id}`);
    expect(fs.readdirSync(path.join(dataDir, 'attachments'))).toHaveLength(0);
  });
});

describe('Live-Kanal', () => {
  it('meldet Änderungen per Server-Sent Events und blockiert das Herunterfahren nicht', async () => {
    const board = await newBoard();
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const res = await fetch(`${address}/api/boards/${board.board.id}/events`, { headers: ANNA });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    await call(ANNA, 'POST', `/api/lists/${board.lists[0]!.id}/cards`, { title: 'Neu' });
    let text = '';
    while (!text.includes('data:')) text += decoder.decode((await reader.read()).value);
    const event = JSON.parse(text.split('data: ')[1]!.split('\n')[0]!);
    expect(event).toMatchObject({ type: 'changed', boardId: board.board.id, by: 'oid-anna' });

    // app.close() im afterEach muss trotz offener Verbindung zurückkehren
    await app.close();
    await expect(reader.read()).resolves.toMatchObject({ done: true });
  });

  it('ohne Leserecht kein Live-Kanal', async () => {
    const board = await newBoard();
    expect((await call(BEN, 'GET', `/api/boards/${board.board.id}/events`)).status).toBe(404);
  });
});
