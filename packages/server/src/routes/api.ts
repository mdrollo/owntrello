import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { BOARD_COLORS, type BoardEvent } from '@owntrello/shared';
import type { AppContext } from '../app.js';
import { badRequest, forbidden, HttpError } from '../errors.js';
import { INLINE_IMAGE_TYPES, type Access } from '../store.js';

const id = z.coerce.number().int().positive();
const idParams = z.object({ id });
const title = z.string().trim().min(1, 'darf nicht leer sein').max(500);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Farbe als #rrggbb');
const text = z.string().max(20_000);
const permissionInput = z.object({
  canRead: z.boolean().optional(),
  canWrite: z.boolean().optional(),
  canManage: z.boolean().optional(),
});
const isoDate = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), 'kein gültiges Datum')
  .transform((s) => new Date(s).toISOString());

export function registerApi(app: FastifyInstance, ctx: AppContext): void {
  const { store, events, files } = ctx;

  /** Recht prüfen und Board-ID zurückgeben */
  const guard = (req: FastifyRequest, boardId: number, access: Access) => {
    store.require(req.me, boardId, access);
    return boardId;
  };
  const changed = (req: FastifyRequest, boardId: number, cardId?: number, type: BoardEvent['type'] = 'changed') =>
    events.emit({ type, boardId, cardId, by: req.me.id });
  const removeFiles = (keys: string[]) => {
    try {
      files.remove(keys);
    } catch (err) {
      app.log.warn({ err }, 'Anhänge konnten nicht gelöscht werden');
    }
  };

  // ------------------------------------------------------------- Benutzer

  app.get('/api/me', async (req) => req.me);
  app.get('/api/users', async () => ({ users: store.listUsers() }));

  // --------------------------------------------------------------- Boards

  app.get('/api/boards', async (req) => ({ boards: store.listBoards(req.me) }));

  app.post('/api/boards', async (req, reply) => {
    const body = z
      .object({ title, color: color.optional(), withDefaultLists: z.boolean().optional() })
      .parse(req.body);
    const boardId = store.createBoard(req.me, { ...body, color: body.color ?? BOARD_COLORS[0] });
    return reply.code(201).send({ id: boardId });
  });

  app.get('/api/boards/:id', async (req) => {
    const { id: boardId } = idParams.parse(req.params);
    guard(req, boardId, 'read');
    return store.boardDetail(req.me, boardId);
  });

  app.patch('/api/boards/:id', async (req) => {
    const { id: boardId } = idParams.parse(req.params);
    const body = z.object({ title: title.optional(), color: color.optional(), archived: z.boolean().optional() }).parse(req.body);
    // Archivieren und Wiederherstellen nur für Verwalter, Titel/Farbe für alle mit Schreibrecht
    guard(req, boardId, body.archived !== undefined ? 'manage' : 'write');
    store.updateBoard(req.me, boardId, body);
    changed(req, boardId);
    return { ok: true };
  });

  app.delete('/api/boards/:id', async (req, reply) => {
    const { id: boardId } = idParams.parse(req.params);
    guard(req, boardId, 'manage');
    removeFiles(store.deleteBoard(boardId));
    changed(req, boardId, undefined, 'deleted');
    return reply.code(204).send();
  });

  app.put('/api/boards/:id/star', async (req) => {
    const { id: boardId } = idParams.parse(req.params);
    const { starred } = z.object({ starred: z.boolean() }).parse(req.body);
    guard(req, boardId, 'read');
    store.setStar(req.me, boardId, starred);
    return { starred };
  });

  app.get('/api/boards/:id/activity', async (req) => {
    const { id: boardId } = idParams.parse(req.params);
    const q = z.object({ before: id.optional(), limit: z.coerce.number().int().min(1).max(200).optional() }).parse(req.query);
    guard(req, boardId, 'read');
    return { activity: store.boardActivity(boardId, q.before, q.limit) };
  });

  app.get('/api/boards/:id/archive', async (req) => {
    const { id: boardId } = idParams.parse(req.params);
    guard(req, boardId, 'read');
    return store.archive(boardId);
  });

  /** Live-Kanal: Server-Sent Events bei jeder Änderung am Board */
  app.get('/api/boards/:id/events', async (req, reply) => {
    const { id: boardId } = idParams.parse(req.params);
    guard(req, boardId, 'read');
    const me = req.me;
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Proxys (nginx, Azure Front Door) nicht puffern lassen
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 5000\n\n');
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      unsubscribe();
      untrack();
      clearInterval(heartbeat);
      res.end();
    };
    const unsubscribe = events.subscribe(boardId, (event) => {
      // Rechte könnten entzogen worden sein
      if (event.type !== 'deleted' && !store.permission(me, boardId).canRead) {
        res.write(`data: ${JSON.stringify({ ...event, type: 'deleted' })}\n\n`);
        return close();
      }
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      if (event.type === 'deleted') close();
    });
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
    const untrack = events.track(close);
    res.on('close', close);
  });

  // ----------------------------------------------------- Mitglieder/Rechte

  app.post('/api/boards/:id/members', async (req) => {
    const { id: boardId } = idParams.parse(req.params);
    const body = permissionInput.extend({ email: z.string().trim().email('keine gültige E-Mail-Adresse') }).parse(req.body);
    guard(req, boardId, 'manage');
    const result = store.addMemberByEmail(req.me, boardId, body.email, body);
    changed(req, boardId);
    return { result };
  });

  app.put('/api/boards/:id/members/:userId', async (req) => {
    const { id: boardId, userId } = z.object({ id, userId: z.string().min(1) }).parse(req.params);
    const body = permissionInput.parse(req.body);
    guard(req, boardId, 'manage');
    store.setMember(req.me, boardId, userId, body);
    changed(req, boardId);
    return { ok: true };
  });

  app.delete('/api/boards/:id/members/:userId', async (req, reply) => {
    const { id: boardId, userId } = z.object({ id, userId: z.string().min(1) }).parse(req.params);
    // Selbst austreten darf jeder, andere entfernen nur Verwalter
    guard(req, boardId, userId === req.me.id ? 'read' : 'manage');
    store.setMember(req.me, boardId, userId, { canRead: false });
    changed(req, boardId);
    return reply.code(204).send();
  });

  app.delete('/api/boards/:id/invites/:email', async (req, reply) => {
    const { id: boardId, email } = z.object({ id, email: z.string().min(1) }).parse(req.params);
    guard(req, boardId, 'manage');
    store.removeInvite(boardId, email);
    changed(req, boardId);
    return reply.code(204).send();
  });

  // --------------------------------------------------------------- Labels

  app.post('/api/boards/:id/labels', async (req, reply) => {
    const { id: boardId } = idParams.parse(req.params);
    const body = z.object({ name: z.string().trim().max(100).default(''), color }).parse(req.body);
    guard(req, boardId, 'write');
    const label = store.createLabel(boardId, body);
    changed(req, boardId);
    return reply.code(201).send(label);
  });

  app.patch('/api/labels/:id', async (req) => {
    const { id: labelId } = idParams.parse(req.params);
    const body = z.object({ name: z.string().trim().max(100).optional(), color: color.optional() }).parse(req.body);
    const boardId = guard(req, store.boardOfLabel(labelId), 'write');
    const label = store.updateLabel(labelId, body);
    changed(req, boardId);
    return label;
  });

  app.delete('/api/labels/:id', async (req, reply) => {
    const { id: labelId } = idParams.parse(req.params);
    const boardId = guard(req, store.boardOfLabel(labelId), 'write');
    store.deleteLabel(labelId);
    changed(req, boardId);
    return reply.code(204).send();
  });

  // --------------------------------------------------------------- Listen

  app.post('/api/boards/:id/lists', async (req, reply) => {
    const { id: boardId } = idParams.parse(req.params);
    const body = z.object({ title }).parse(req.body);
    guard(req, boardId, 'write');
    const list = store.createList(req.me, boardId, body.title);
    changed(req, boardId);
    return reply.code(201).send(list);
  });

  app.patch('/api/lists/:id', async (req) => {
    const { id: listId } = idParams.parse(req.params);
    const body = z.object({ title: title.optional(), archived: z.boolean().optional() }).parse(req.body);
    const boardId = guard(req, store.boardOfList(listId), 'write');
    store.updateList(req.me, listId, body);
    changed(req, boardId);
    return { ok: true };
  });

  app.post('/api/lists/:id/move', async (req) => {
    const { id: listId } = idParams.parse(req.params);
    const { index } = z.object({ index: z.number().int().min(0) }).parse(req.body);
    const boardId = guard(req, store.boardOfList(listId), 'write');
    store.moveList(listId, index);
    changed(req, boardId);
    return { ok: true };
  });

  app.delete('/api/lists/:id', async (req, reply) => {
    const { id: listId } = idParams.parse(req.params);
    const boardId = guard(req, store.boardOfList(listId), 'write');
    removeFiles(store.deleteList(listId));
    changed(req, boardId);
    return reply.code(204).send();
  });

  // --------------------------------------------------------------- Karten

  app.post('/api/lists/:id/cards', async (req, reply) => {
    const { id: listId } = idParams.parse(req.params);
    const body = z.object({ title, position: z.enum(['top', 'bottom']).optional() }).parse(req.body);
    const boardId = guard(req, store.boardOfList(listId), 'write');
    const card = store.createCard(req.me, listId, body);
    changed(req, boardId, card.id);
    return reply.code(201).send(card);
  });

  app.get('/api/cards/:id', async (req) => {
    const { id: cardId } = idParams.parse(req.params);
    guard(req, store.boardOfCard(cardId), 'read');
    return store.cardDetail(cardId);
  });

  app.patch('/api/cards/:id', async (req) => {
    const { id: cardId } = idParams.parse(req.params);
    const body = z
      .object({
        title: title.optional(),
        description: text.optional(),
        due: isoDate.nullable().optional(),
        dueDone: z.boolean().optional(),
        archived: z.boolean().optional(),
        coverAttachmentId: id.nullable().optional(),
      })
      .parse(req.body);
    const boardId = guard(req, store.boardOfCard(cardId), 'write');
    store.updateCard(req.me, cardId, body);
    changed(req, boardId, cardId);
    return store.cardSummary(cardId);
  });

  app.post('/api/cards/:id/move', async (req) => {
    const { id: cardId } = idParams.parse(req.params);
    const body = z.object({ listId: id, index: z.number().int().min(0) }).parse(req.body);
    // Schreibrecht auf Quelle und Ziel (Ziel ohne Leserecht → 404 „Board nicht gefunden“)
    guard(req, store.boardOfCard(cardId), 'write');
    guard(req, store.boardOfList(body.listId), 'write');
    const { fromBoard, toBoard } = store.moveCard(req.me, cardId, body.listId, body.index);
    changed(req, fromBoard, cardId);
    if (toBoard !== fromBoard) changed(req, toBoard, cardId);
    return { boardId: toBoard };
  });

  app.delete('/api/cards/:id', async (req, reply) => {
    const { id: cardId } = idParams.parse(req.params);
    const boardId = guard(req, store.boardOfCard(cardId), 'write');
    removeFiles(store.deleteCard(cardId));
    changed(req, boardId, cardId);
    return reply.code(204).send();
  });

  app.put('/api/cards/:id/labels/:labelId', async (req) => {
    const { id: cardId, labelId } = z.object({ id, labelId: id }).parse(req.params);
    const boardId = guard(req, store.boardOfCard(cardId), 'write');
    store.setCardLabel(cardId, labelId, true);
    changed(req, boardId, cardId);
    return { ok: true };
  });

  app.delete('/api/cards/:id/labels/:labelId', async (req, reply) => {
    const { id: cardId, labelId } = z.object({ id, labelId: id }).parse(req.params);
    const boardId = guard(req, store.boardOfCard(cardId), 'write');
    store.setCardLabel(cardId, labelId, false);
    changed(req, boardId, cardId);
    return reply.code(204).send();
  });

  app.put('/api/cards/:id/members/:userId', async (req) => {
    const { id: cardId, userId } = z.object({ id, userId: z.string().min(1) }).parse(req.params);
    const boardId = guard(req, store.boardOfCard(cardId), 'write');
    store.setCardMember(req.me, cardId, userId, true);
    changed(req, boardId, cardId);
    return { ok: true };
  });

  app.delete('/api/cards/:id/members/:userId', async (req, reply) => {
    const { id: cardId, userId } = z.object({ id, userId: z.string().min(1) }).parse(req.params);
    const boardId = guard(req, store.boardOfCard(cardId), 'write');
    store.setCardMember(req.me, cardId, userId, false);
    changed(req, boardId, cardId);
    return reply.code(204).send();
  });

  // ---------------------------------------------------------- Checklisten

  app.post('/api/cards/:id/checklists', async (req, reply) => {
    const { id: cardId } = idParams.parse(req.params);
    const body = z.object({ title: title.default('Checkliste') }).parse(req.body ?? {});
    const boardId = guard(req, store.boardOfCard(cardId), 'write');
    const checklistId = store.createChecklist(req.me, cardId, body.title);
    changed(req, boardId, cardId);
    return reply.code(201).send({ id: checklistId });
  });

  app.patch('/api/checklists/:id', async (req) => {
    const { id: checklistId } = idParams.parse(req.params);
    const body = z.object({ title }).parse(req.body);
    const boardId = guard(req, store.boardOfChecklist(checklistId), 'write');
    store.updateChecklist(checklistId, body.title);
    changed(req, boardId);
    return { ok: true };
  });

  app.delete('/api/checklists/:id', async (req, reply) => {
    const { id: checklistId } = idParams.parse(req.params);
    const boardId = guard(req, store.boardOfChecklist(checklistId), 'write');
    store.deleteChecklist(checklistId);
    changed(req, boardId);
    return reply.code(204).send();
  });

  app.post('/api/checklists/:id/items', async (req, reply) => {
    const { id: checklistId } = idParams.parse(req.params);
    const body = z.object({ text: title }).parse(req.body);
    const boardId = guard(req, store.boardOfChecklist(checklistId), 'write');
    const itemId = store.createCheckItem(checklistId, body.text);
    changed(req, boardId);
    return reply.code(201).send({ id: itemId });
  });

  app.patch('/api/checkitems/:id', async (req) => {
    const { id: itemId } = idParams.parse(req.params);
    const body = z.object({ text: title.optional(), done: z.boolean().optional() }).parse(req.body);
    const boardId = guard(req, store.boardOfCheckItem(itemId), 'write');
    store.updateCheckItem(req.me, itemId, body);
    changed(req, boardId);
    return { ok: true };
  });

  app.delete('/api/checkitems/:id', async (req, reply) => {
    const { id: itemId } = idParams.parse(req.params);
    const boardId = guard(req, store.boardOfCheckItem(itemId), 'write');
    store.deleteCheckItem(itemId);
    changed(req, boardId);
    return reply.code(204).send();
  });

  // ----------------------------------------------------------- Kommentare

  app.post('/api/cards/:id/comments', async (req, reply) => {
    const { id: cardId } = idParams.parse(req.params);
    const body = z.object({ text: z.string().trim().min(1, 'darf nicht leer sein').max(10_000) }).parse(req.body);
    const boardId = guard(req, store.boardOfCard(cardId), 'write');
    const commentId = store.createComment(req.me, cardId, body.text);
    changed(req, boardId, cardId);
    return reply.code(201).send({ id: commentId });
  });

  app.patch('/api/comments/:id', async (req) => {
    const { id: commentId } = idParams.parse(req.params);
    const body = z.object({ text: z.string().trim().min(1).max(10_000) }).parse(req.body);
    const boardId = guard(req, store.boardOfComment(commentId), 'write');
    if (store.commentAuthor(commentId) !== req.me.id) throw forbidden('Nur eigene Kommentare können bearbeitet werden');
    store.updateComment(commentId, body.text);
    changed(req, boardId);
    return { ok: true };
  });

  app.delete('/api/comments/:id', async (req, reply) => {
    const { id: commentId } = idParams.parse(req.params);
    const boardId = store.boardOfComment(commentId);
    const perm = store.require(req.me, boardId, 'write');
    if (store.commentAuthor(commentId) !== req.me.id && !perm.canManage) {
      throw forbidden('Nur eigene Kommentare können gelöscht werden');
    }
    store.deleteComment(commentId);
    changed(req, boardId);
    return reply.code(204).send();
  });

  // -------------------------------------------------------------- Anhänge

  app.post('/api/cards/:id/attachments', async (req, reply) => {
    const { id: cardId } = idParams.parse(req.params);
    const boardId = guard(req, store.boardOfCard(cardId), 'write');
    if (!req.isMultipart()) throw badRequest('Datei als multipart/form-data senden');
    const part = await req.file();
    if (!part) throw badRequest('Keine Datei');
    const saved = await files.save(part.file);
    if (part.file.truncated) {
      files.remove([saved.key]);
      throw new HttpError(413, `Datei zu groß (höchstens ${Math.round(ctx.maxAttachmentBytes / 1024 / 1024)} MB)`);
    }
    const filename = part.filename.replace(/[\\/\r\n"]/g, '_').slice(0, 255) || 'datei';
    const attachment = store.createAttachment(req.me, cardId, {
      filename,
      mime: (part.mimetype || 'application/octet-stream').toLowerCase(),
      size: saved.size,
      storageKey: saved.key,
    });
    changed(req, boardId, cardId);
    return reply.code(201).send(attachment);
  });

  app.get('/api/attachments/:id', async (req, reply) => {
    const { id: attachmentId } = idParams.parse(req.params);
    const { download } = z.object({ download: z.string().optional() }).parse(req.query);
    guard(req, store.boardOfAttachment(attachmentId), 'read');
    const { attachment, storageKey } = store.attachment(attachmentId);
    const inline = INLINE_IMAGE_TYPES.has(attachment.mime) && download === undefined;
    const encoded = encodeURIComponent(attachment.filename);
    const ascii = attachment.filename.replace(/[^\x20-\x7e]/g, '_');
    return reply
      .header('Content-Type', inline ? attachment.mime : 'application/octet-stream')
      .header('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encoded}`)
      .header('Content-Length', attachment.size)
      // Hochgeladene Inhalte nie als Seite ausführen
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .header('Cache-Control', 'private, max-age=86400')
      .send(files.open(storageKey));
  });

  app.delete('/api/attachments/:id', async (req, reply) => {
    const { id: attachmentId } = idParams.parse(req.params);
    const boardId = guard(req, store.boardOfAttachment(attachmentId), 'write');
    const { attachment } = store.attachment(attachmentId);
    removeFiles([store.deleteAttachment(req.me, attachmentId)]);
    changed(req, boardId, attachment.cardId);
    return reply.code(204).send();
  });
}
