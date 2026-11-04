import {
  BOARD_COLORS,
  LABEL_COLORS,
  NO_PERMISSION,
  normalizePermission,
  type Activity,
  type ActivityType,
  type ArchiveResponse,
  type Attachment,
  type Board,
  type BoardDetail,
  type BoardInvite,
  type BoardMember,
  type BoardSummary,
  type CardDetail,
  type CardSummary,
  type Checklist,
  type ChecklistItem,
  type Comment,
  type Label,
  type List,
  type Me,
  type Permission,
  type User,
} from '@owntrello/shared';
import { tx, type Db } from './db/index.js';
import { badRequest, forbidden, HttpError, notFound } from './errors.js';
import type { Principal } from './auth/principal.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

const now = () => new Date().toISOString();
const bool = (v: unknown) => v === 1 || v === true;

/** Bilder, die der Browser direkt anzeigen darf (kein SVG – das kann Skripte enthalten) */
export const INLINE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);

export type Access = 'read' | 'write' | 'manage';

const DEFAULT_LISTS = ['Zu erledigen', 'In Arbeit', 'Erledigt'];

function toUser(row: Row, prefix = ''): User {
  return {
    id: row[`${prefix}id`] ?? row[`${prefix}user_id`],
    name: row[`${prefix}name`] ?? 'Unbekannt',
    email: row[`${prefix}email`] ?? '',
  };
}

function toPermission(row: Row | undefined): Permission {
  if (!row) return NO_PERMISSION;
  return normalizePermission({
    canRead: bool(row.can_read),
    canWrite: bool(row.can_write),
    canManage: bool(row.can_manage),
  });
}

const toBoard = (r: Row): Board => ({
  id: r.id,
  title: r.title,
  color: r.color,
  archived: bool(r.archived),
  createdAt: r.created_at,
});

const toList = (r: Row): List => ({
  id: r.id,
  boardId: r.board_id,
  title: r.title,
  pos: r.pos,
  archived: bool(r.archived),
});

const toLabel = (r: Row): Label => ({ id: r.id, boardId: r.board_id, name: r.name, color: r.color });

const CARD_SELECT = `
  SELECT c.*,
    (SELECT count(*) FROM comments WHERE card_id = c.id) AS n_comments,
    (SELECT count(*) FROM attachments WHERE card_id = c.id) AS n_attachments,
    (SELECT count(*) FROM checklist_items i JOIN checklists l ON l.id = i.checklist_id WHERE l.card_id = c.id) AS n_items,
    (SELECT count(*) FROM checklist_items i JOIN checklists l ON l.id = i.checklist_id WHERE l.card_id = c.id AND i.done = 1) AS n_done
  FROM cards c`;

/**
 * Datenzugriff und Geschäftsregeln. Rechte prüfen die Routen über
 * `require(me, boardId, access)`; die Methoden hier gehen davon aus, dass das
 * schon geschehen ist, prüfen aber Zusammenhänge (z. B. Label gehört zum Board).
 */
export class Store {
  /** Letzte Aktualisierung von last_seen pro Benutzer (nur alle 5 Minuten schreiben) */
  private seen = new Map<string, number>();

  constructor(
    readonly db: Db,
    private readonly adminUsers: string[] = [],
  ) {}

  // ---------------------------------------------------------------- Benutzer

  /** Angemeldeten Benutzer anlegen bzw. aktualisieren; offene Einladungen übernehmen */
  touchUser(p: Principal): Me {
    const existing = this.db.prepare('SELECT * FROM users WHERE id = ?').get(p.id) as Row | undefined;
    const configured = this.adminUsers.includes(p.id.toLowerCase()) || this.adminUsers.includes(p.email.toLowerCase());
    const last = this.seen.get(p.id) ?? 0;
    if (
      existing &&
      existing.name === p.name &&
      existing.email === p.email &&
      (this.adminUsers.length === 0 || bool(existing.is_admin) === configured) &&
      Date.now() - last < 5 * 60_000
    ) {
      return { id: p.id, name: p.name, email: p.email, isAdmin: bool(existing.is_admin) };
    }

    return tx(this.db, () => {
      let isAdmin: boolean;
      if (this.adminUsers.length > 0) isAdmin = configured;
      else if (existing) isAdmin = bool(existing.is_admin);
      else isAdmin = (this.db.prepare('SELECT count(*) AS n FROM users').get() as Row).n === 0;

      const ts = now();
      if (existing) {
        this.db
          .prepare('UPDATE users SET name = ?, email = ?, is_admin = ?, last_seen = ? WHERE id = ?')
          .run(p.name, p.email, isAdmin ? 1 : 0, ts, p.id);
      } else {
        this.db
          .prepare('INSERT INTO users (id, name, email, is_admin, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?)')
          .run(p.id, p.name, p.email, isAdmin ? 1 : 0, ts, ts);
      }
      this.acceptInvites(p.id, p.email);
      this.seen.set(p.id, Date.now());
      return { id: p.id, name: p.name, email: p.email, isAdmin };
    });
  }

  private acceptInvites(userId: string, email: string): void {
    const invites = this.db
      .prepare('SELECT * FROM board_invites WHERE lower(email) = lower(?)')
      .all(email) as Row[];
    for (const inv of invites) {
      const current = this.memberRow(inv.board_id, userId);
      const merged = normalizePermission({
        canRead: bool(inv.can_read) || bool(current?.can_read),
        canWrite: bool(inv.can_write) || bool(current?.can_write),
        canManage: bool(inv.can_manage) || bool(current?.can_manage),
      });
      this.writeMember(inv.board_id, userId, merged);
      this.db.prepare('DELETE FROM board_invites WHERE board_id = ? AND email = ?').run(inv.board_id, inv.email);
    }
  }

  listUsers(): User[] {
    return (this.db.prepare('SELECT id, name, email FROM users ORDER BY name COLLATE NOCASE').all() as Row[]).map(
      (r) => toUser(r),
    );
  }

  // ------------------------------------------------------------------ Rechte

  private memberRow(boardId: number, userId: string): Row | undefined {
    return this.db
      .prepare('SELECT * FROM board_members WHERE board_id = ? AND user_id = ?')
      .get(boardId, userId) as Row | undefined;
  }

  permission(me: Me, boardId: number): Permission {
    if (me.isAdmin) return { canRead: true, canWrite: true, canManage: true };
    return toPermission(this.memberRow(boardId, me.id));
  }

  /** Board muss existieren und der Benutzer das Recht haben – sonst 404 bzw. 403 */
  require(me: Me, boardId: number, access: Access): Permission {
    const board = this.db.prepare('SELECT archived FROM boards WHERE id = ?').get(boardId) as Row | undefined;
    if (!board) throw notFound('Board nicht gefunden');
    const perm = this.permission(me, boardId);
    // Ohne Leserecht nicht verraten, dass es das Board gibt
    if (!perm.canRead) throw notFound('Board nicht gefunden');
    if (access === 'write' && !perm.canWrite) throw forbidden('Nur Lesezugriff auf dieses Board');
    if (access === 'manage' && !perm.canManage) throw forbidden('Nur Verwalter dürfen das');
    // Archivierte Boards sind schreibgeschützt (außer zum Wiederherstellen über manage)
    if (access === 'write' && bool(board.archived)) throw forbidden('Board ist archiviert');
    return perm;
  }

  // ----------------------------------------- Zuordnung Objekt → Board (für Rechte)

  private boardOf(sql: string, id: number | string, what: string): number {
    const row = this.db.prepare(sql).get(id) as Row | undefined;
    if (!row) throw notFound(`${what} nicht gefunden`);
    return row.board_id as number;
  }

  boardOfList = (id: number) => this.boardOf('SELECT board_id FROM lists WHERE id = ?', id, 'Liste');
  boardOfCard = (id: number) => this.boardOf('SELECT board_id FROM cards WHERE id = ?', id, 'Karte');
  boardOfLabel = (id: number) => this.boardOf('SELECT board_id FROM labels WHERE id = ?', id, 'Label');
  boardOfChecklist = (id: number) =>
    this.boardOf(
      'SELECT c.board_id FROM checklists l JOIN cards c ON c.id = l.card_id WHERE l.id = ?',
      id,
      'Checkliste',
    );
  boardOfCheckItem = (id: number) =>
    this.boardOf(
      `SELECT c.board_id FROM checklist_items i JOIN checklists l ON l.id = i.checklist_id
       JOIN cards c ON c.id = l.card_id WHERE i.id = ?`,
      id,
      'Eintrag',
    );
  boardOfComment = (id: number) =>
    this.boardOf('SELECT c.board_id FROM comments m JOIN cards c ON c.id = m.card_id WHERE m.id = ?', id, 'Kommentar');
  boardOfAttachment = (id: number) =>
    this.boardOf('SELECT c.board_id FROM attachments a JOIN cards c ON c.id = a.card_id WHERE a.id = ?', id, 'Anhang');

  // ------------------------------------------------------------------ Verlauf

  log(
    me: User,
    boardId: number,
    type: ActivityType,
    data: Activity['data'] = {},
    cardId: number | null = null,
  ): void {
    this.db
      .prepare('INSERT INTO activity (board_id, card_id, user_id, type, data, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(boardId, cardId, me.id, type, JSON.stringify(data), now());
  }

  private toActivity = (r: Row): Activity => ({
    id: r.id,
    boardId: r.board_id,
    cardId: r.card_id,
    user: { id: r.user_id, name: r.u_name ?? 'Unbekannt', email: r.u_email ?? '' },
    type: r.type,
    data: JSON.parse(r.data),
    createdAt: r.created_at,
  });

  boardActivity(boardId: number, before?: number, limit = 50): Activity[] {
    const rows = this.db
      .prepare(
        `SELECT a.*, u.name AS u_name, u.email AS u_email FROM activity a LEFT JOIN users u ON u.id = a.user_id
         WHERE a.board_id = ? AND a.id < ? ORDER BY a.id DESC LIMIT ?`,
      )
      .all(boardId, before ?? Number.MAX_SAFE_INTEGER, Math.min(limit, 200)) as Row[];
    return rows.map(this.toActivity);
  }

  // ------------------------------------------------------------------- Boards

  listBoards(me: Me): BoardSummary[] {
    const rows = (
      me.isAdmin
        ? this.db
            .prepare(
              `SELECT b.*, 1 AS can_read, 1 AS can_write, 1 AS can_manage,
                 EXISTS (SELECT 1 FROM board_stars s WHERE s.board_id = b.id AND s.user_id = ?) AS starred
               FROM boards b ORDER BY b.title COLLATE NOCASE`,
            )
            .all(me.id)
        : this.db
            .prepare(
              `SELECT b.*, m.can_read, m.can_write, m.can_manage,
                 EXISTS (SELECT 1 FROM board_stars s WHERE s.board_id = b.id AND s.user_id = ?) AS starred
               FROM boards b JOIN board_members m ON m.board_id = b.id AND m.user_id = ?
               WHERE m.can_read = 1 OR m.can_write = 1 OR m.can_manage = 1
               ORDER BY b.title COLLATE NOCASE`,
            )
            .all(me.id, me.id)
    ) as Row[];
    return rows.map((r) => ({ ...toBoard(r), starred: bool(r.starred), permission: toPermission(r) }));
  }

  createBoard(me: Me, input: { title: string; color?: string; withDefaultLists?: boolean }): number {
    return tx(this.db, () => {
      const color = input.color ?? BOARD_COLORS[0];
      const { lastInsertRowid } = this.db
        .prepare('INSERT INTO boards (title, color, created_by, created_at) VALUES (?, ?, ?, ?)')
        .run(input.title, color, me.id, now());
      const boardId = Number(lastInsertRowid);
      this.writeMember(boardId, me.id, { canRead: true, canWrite: true, canManage: true });
      for (const c of LABEL_COLORS.slice(0, 6)) {
        this.db.prepare('INSERT INTO labels (board_id, name, color) VALUES (?, ?, ?)').run(boardId, '', c);
      }
      if (input.withDefaultLists !== false) {
        DEFAULT_LISTS.forEach((title, i) =>
          this.db.prepare('INSERT INTO lists (board_id, title, pos) VALUES (?, ?, ?)').run(boardId, title, i),
        );
      }
      this.log(me, boardId, 'board.created', { title: input.title });
      return boardId;
    });
  }

  boardDetail(me: Me, boardId: number): BoardDetail {
    const board = this.db.prepare('SELECT * FROM boards WHERE id = ?').get(boardId) as Row | undefined;
    if (!board) throw notFound('Board nicht gefunden');
    const lists = (
      this.db.prepare('SELECT * FROM lists WHERE board_id = ? AND archived = 0 ORDER BY pos, id').all(boardId) as Row[]
    ).map(toList);
    const cards = this.cardSummaries(
      `${CARD_SELECT} JOIN lists l ON l.id = c.list_id
       WHERE c.board_id = ? AND c.archived = 0 AND l.archived = 0 ORDER BY c.pos, c.id`,
      boardId,
    );
    const starred = !!this.db
      .prepare('SELECT 1 FROM board_stars WHERE user_id = ? AND board_id = ?')
      .get(me.id, boardId);
    return {
      board: toBoard(board),
      starred,
      permission: this.permission(me, boardId),
      lists,
      cards,
      labels: this.labels(boardId),
      members: this.members(boardId),
      invites: this.invites(boardId),
    };
  }

  updateBoard(me: Me, boardId: number, patch: { title?: string; color?: string; archived?: boolean }): void {
    const old = this.db.prepare('SELECT * FROM boards WHERE id = ?').get(boardId) as Row;
    tx(this.db, () => {
      if (patch.title !== undefined && patch.title !== old.title) {
        this.db.prepare('UPDATE boards SET title = ? WHERE id = ?').run(patch.title, boardId);
        this.log(me, boardId, 'board.renamed', { from: old.title, title: patch.title });
      }
      if (patch.color !== undefined) this.db.prepare('UPDATE boards SET color = ? WHERE id = ?').run(patch.color, boardId);
      if (patch.archived !== undefined)
        this.db.prepare('UPDATE boards SET archived = ? WHERE id = ?').run(patch.archived ? 1 : 0, boardId);
    });
  }

  /** Board löschen; liefert die Speicherschlüssel der Anhänge, die entfernt werden müssen */
  deleteBoard(boardId: number): string[] {
    return tx(this.db, () => {
      const keys = (
        this.db
          .prepare('SELECT a.storage_key FROM attachments a JOIN cards c ON c.id = a.card_id WHERE c.board_id = ?')
          .all(boardId) as Row[]
      ).map((r) => r.storage_key as string);
      this.db.prepare('DELETE FROM boards WHERE id = ?').run(boardId);
      return keys;
    });
  }

  setStar(me: Me, boardId: number, starred: boolean): void {
    if (starred) this.db.prepare('INSERT OR IGNORE INTO board_stars (user_id, board_id) VALUES (?, ?)').run(me.id, boardId);
    else this.db.prepare('DELETE FROM board_stars WHERE user_id = ? AND board_id = ?').run(me.id, boardId);
  }

  // --------------------------------------------------------- Mitglieder/Rechte

  members(boardId: number): BoardMember[] {
    const rows = this.db
      .prepare(
        `SELECT m.*, u.name, u.email FROM board_members m JOIN users u ON u.id = m.user_id
         WHERE m.board_id = ? ORDER BY u.name COLLATE NOCASE`,
      )
      .all(boardId) as Row[];
    return rows.map((r) => ({ user: toUser(r), ...toPermission(r) }));
  }

  invites(boardId: number): BoardInvite[] {
    const rows = this.db
      .prepare('SELECT * FROM board_invites WHERE board_id = ? ORDER BY email')
      .all(boardId) as Row[];
    return rows.map((r) => ({ email: r.email, ...toPermission(r) }));
  }

  private writeMember(boardId: number, userId: string, p: Permission): void {
    this.db
      .prepare(
        `INSERT INTO board_members (board_id, user_id, can_read, can_write, can_manage) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (board_id, user_id) DO UPDATE SET
           can_read = excluded.can_read, can_write = excluded.can_write, can_manage = excluded.can_manage`,
      )
      .run(boardId, userId, p.canRead ? 1 : 0, p.canWrite ? 1 : 0, p.canManage ? 1 : 0);
  }

  /**
   * Rechte eines Benutzers setzen. Ohne Leserecht wird er entfernt (auch von
   * seinen Karten). Der letzte Verwalter eines Boards kann nicht herabgestuft werden.
   */
  setMember(me: Me, boardId: number, userId: string, input: Partial<Permission>): void {
    const perm = normalizePermission(input);
    const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as Row | undefined;
    if (!user) throw notFound('Benutzer nicht gefunden');
    tx(this.db, () => {
      const current = toPermission(this.memberRow(boardId, userId));
      if (current.canManage && !perm.canManage) {
        const managers = (
          this.db
            .prepare('SELECT count(*) AS n FROM board_members WHERE board_id = ? AND can_manage = 1')
            .get(boardId) as Row
        ).n as number;
        if (managers <= 1) throw new HttpError(409, 'Ein Board braucht mindestens einen Verwalter');
      }
      if (!perm.canRead) {
        this.db.prepare('DELETE FROM board_members WHERE board_id = ? AND user_id = ?').run(boardId, userId);
        this.db
          .prepare('DELETE FROM card_members WHERE user_id = ? AND card_id IN (SELECT id FROM cards WHERE board_id = ?)')
          .run(userId, boardId);
        this.db.prepare('DELETE FROM board_stars WHERE user_id = ? AND board_id = ?').run(userId, boardId);
        if (current.canRead) this.log(me, boardId, 'member.removed', { name: user.name });
        return;
      }
      this.writeMember(boardId, userId, perm);
      this.log(me, boardId, 'member.changed', {
        name: user.name,
        canRead: perm.canRead,
        canWrite: perm.canWrite,
        canManage: perm.canManage,
      });
    });
  }

  /** Freigabe per E-Mail: bekannter Benutzer → Mitglied, sonst Einladung bis zur ersten Anmeldung */
  addMemberByEmail(me: Me, boardId: number, email: string, input: Partial<Permission>): 'member' | 'invite' {
    const perm = normalizePermission({ canRead: true, ...input });
    const user = this.db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(email) as Row | undefined;
    if (user) {
      this.setMember(me, boardId, user.id, perm);
      return 'member';
    }
    this.db
      .prepare(
        `INSERT INTO board_invites (board_id, email, can_read, can_write, can_manage) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (board_id, email) DO UPDATE SET
           can_read = excluded.can_read, can_write = excluded.can_write, can_manage = excluded.can_manage`,
      )
      .run(boardId, email.toLowerCase(), 1, perm.canWrite ? 1 : 0, perm.canManage ? 1 : 0);
    return 'invite';
  }

  removeInvite(boardId: number, email: string): void {
    this.db.prepare('DELETE FROM board_invites WHERE board_id = ? AND lower(email) = lower(?)').run(boardId, email);
  }

  // ------------------------------------------------------------------- Labels

  labels(boardId: number): Label[] {
    return (this.db.prepare('SELECT * FROM labels WHERE board_id = ? ORDER BY id').all(boardId) as Row[]).map(toLabel);
  }

  createLabel(boardId: number, input: { name: string; color: string }): Label {
    const { lastInsertRowid } = this.db
      .prepare('INSERT INTO labels (board_id, name, color) VALUES (?, ?, ?)')
      .run(boardId, input.name, input.color);
    return toLabel(this.db.prepare('SELECT * FROM labels WHERE id = ?').get(lastInsertRowid) as Row);
  }

  updateLabel(id: number, patch: { name?: string; color?: string }): Label {
    if (patch.name !== undefined) this.db.prepare('UPDATE labels SET name = ? WHERE id = ?').run(patch.name, id);
    if (patch.color !== undefined) this.db.prepare('UPDATE labels SET color = ? WHERE id = ?').run(patch.color, id);
    return toLabel(this.db.prepare('SELECT * FROM labels WHERE id = ?').get(id) as Row);
  }

  deleteLabel(id: number): void {
    this.db.prepare('DELETE FROM labels WHERE id = ?').run(id);
  }

  // ------------------------------------------------------------------- Listen

  createList(me: Me, boardId: number, title: string): List {
    return tx(this.db, () => {
      const { n } = this.db.prepare('SELECT coalesce(max(pos), -1) + 1 AS n FROM lists WHERE board_id = ?').get(boardId) as Row;
      const { lastInsertRowid } = this.db
        .prepare('INSERT INTO lists (board_id, title, pos) VALUES (?, ?, ?)')
        .run(boardId, title, n);
      this.log(me, boardId, 'list.created', { title });
      return toList(this.db.prepare('SELECT * FROM lists WHERE id = ?').get(lastInsertRowid) as Row);
    });
  }

  updateList(me: Me, id: number, patch: { title?: string; archived?: boolean }): void {
    const old = this.db.prepare('SELECT * FROM lists WHERE id = ?').get(id) as Row;
    tx(this.db, () => {
      if (patch.title !== undefined && patch.title !== old.title) {
        this.db.prepare('UPDATE lists SET title = ? WHERE id = ?').run(patch.title, id);
        this.log(me, old.board_id, 'list.renamed', { from: old.title, title: patch.title });
      }
      if (patch.archived !== undefined && patch.archived !== bool(old.archived)) {
        if (patch.archived) {
          this.db.prepare('UPDATE lists SET archived = 1 WHERE id = ?').run(id);
        } else {
          // Wiederhergestellt ans Ende
          const { n } = this.db
            .prepare('SELECT coalesce(max(pos), -1) + 1 AS n FROM lists WHERE board_id = ?')
            .get(old.board_id) as Row;
          this.db.prepare('UPDATE lists SET archived = 0, pos = ? WHERE id = ?').run(n, id);
        }
        this.log(me, old.board_id, patch.archived ? 'list.archived' : 'list.restored', {
          title: patch.title ?? old.title,
        });
      }
    });
  }

  /** Neue Reihenfolge: ids ohne movingId, an index eingefügt, pos = 0..n-1 */
  private reorder(table: 'lists' | 'cards', parentCol: 'board_id' | 'list_id', parentId: number, movingId: number, index: number) {
    const ids = (
      this.db
        .prepare(`SELECT id FROM ${table} WHERE ${parentCol} = ? AND archived = 0 AND id != ? ORDER BY pos, id`)
        .all(parentId, movingId) as Row[]
    ).map((r) => r.id as number);
    const at = Math.max(0, Math.min(index, ids.length));
    ids.splice(at, 0, movingId);
    const update = this.db.prepare(`UPDATE ${table} SET pos = ? WHERE id = ?`);
    ids.forEach((id, i) => update.run(i, id));
  }

  moveList(id: number, index: number): void {
    const list = this.db.prepare('SELECT * FROM lists WHERE id = ?').get(id) as Row;
    if (bool(list.archived)) throw badRequest('Archivierte Listen können nicht verschoben werden');
    tx(this.db, () => this.reorder('lists', 'board_id', list.board_id, id, index));
  }

  deleteList(id: number): string[] {
    return tx(this.db, () => {
      const keys = (
        this.db
          .prepare('SELECT a.storage_key FROM attachments a JOIN cards c ON c.id = a.card_id WHERE c.list_id = ?')
          .all(id) as Row[]
      ).map((r) => r.storage_key as string);
      this.db.prepare('DELETE FROM lists WHERE id = ?').run(id);
      return keys;
    });
  }

  // ------------------------------------------------------------------- Karten

  private cardSummaries(sql: string, ...params: (number | string)[]): CardSummary[] {
    const rows = this.db.prepare(sql).all(...params) as Row[];
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id as number);
    const placeholders = ids.map(() => '?').join(',');
    const labels = new Map<number, number[]>();
    for (const r of this.db
      .prepare(
        `SELECT cl.card_id, cl.label_id FROM card_labels cl JOIN labels l ON l.id = cl.label_id
         WHERE cl.card_id IN (${placeholders}) ORDER BY l.id`,
      )
      .all(...ids) as Row[]) {
      labels.set(r.card_id, [...(labels.get(r.card_id) ?? []), r.label_id]);
    }
    const members = new Map<number, string[]>();
    for (const r of this.db
      .prepare(`SELECT card_id, user_id FROM card_members WHERE card_id IN (${placeholders})`)
      .all(...ids) as Row[]) {
      members.set(r.card_id, [...(members.get(r.card_id) ?? []), r.user_id]);
    }
    return rows.map((r) => ({
      id: r.id,
      boardId: r.board_id,
      listId: r.list_id,
      title: r.title,
      pos: r.pos,
      archived: bool(r.archived),
      hasDescription: r.description.trim() !== '',
      due: r.due,
      dueDone: bool(r.due_done),
      labelIds: labels.get(r.id) ?? [],
      memberIds: members.get(r.id) ?? [],
      coverAttachmentId: r.cover_attachment_id,
      badges: {
        comments: r.n_comments,
        attachments: r.n_attachments,
        checkItems: r.n_items,
        checkItemsDone: r.n_done,
      },
    }));
  }

  cardSummary(id: number): CardSummary {
    const [card] = this.cardSummaries(`${CARD_SELECT} WHERE c.id = ?`, id);
    if (!card) throw notFound('Karte nicht gefunden');
    return card;
  }

  createCard(me: Me, listId: number, input: { title: string; position?: 'top' | 'bottom' }): CardSummary {
    const list = this.db.prepare('SELECT * FROM lists WHERE id = ?').get(listId) as Row;
    return tx(this.db, () => {
      const ts = now();
      const { lastInsertRowid } = this.db
        .prepare(
          `INSERT INTO cards (board_id, list_id, title, pos, created_by, created_at, updated_at)
           VALUES (?, ?, ?, (SELECT coalesce(max(pos), -1) + 1 FROM cards WHERE list_id = ?), ?, ?, ?)`,
        )
        .run(list.board_id, listId, input.title, listId, me.id, ts, ts);
      const id = Number(lastInsertRowid);
      if (input.position === 'top') this.reorder('cards', 'list_id', listId, id, 0);
      this.log(me, list.board_id, 'card.created', { title: input.title, list: list.title }, id);
      return this.cardSummary(id);
    });
  }

  cardDetail(id: number): CardDetail {
    const row = this.db.prepare('SELECT description, created_at FROM cards WHERE id = ?').get(id) as Row | undefined;
    if (!row) throw notFound('Karte nicht gefunden');
    const summary = this.cardSummary(id);

    const checklists = (
      this.db.prepare('SELECT * FROM checklists WHERE card_id = ? ORDER BY pos, id').all(id) as Row[]
    ).map(
      (l): Checklist => ({
        id: l.id,
        cardId: l.card_id,
        title: l.title,
        pos: l.pos,
        items: (
          this.db.prepare('SELECT * FROM checklist_items WHERE checklist_id = ? ORDER BY pos, id').all(l.id) as Row[]
        ).map(
          (i): ChecklistItem => ({ id: i.id, checklistId: i.checklist_id, text: i.text, done: bool(i.done), pos: i.pos }),
        ),
      }),
    );

    const comments = (
      this.db
        .prepare(
          `SELECT m.*, u.name, u.email FROM comments m LEFT JOIN users u ON u.id = m.user_id
           WHERE m.card_id = ? ORDER BY m.id DESC`,
        )
        .all(id) as Row[]
    ).map(
      (r): Comment => ({
        id: r.id,
        cardId: r.card_id,
        user: { id: r.user_id, name: r.name ?? 'Unbekannt', email: r.email ?? '' },
        text: r.text,
        createdAt: r.created_at,
        editedAt: r.edited_at,
      }),
    );

    const attachments = (
      this.db
        .prepare(
          `SELECT a.*, u.name, u.email FROM attachments a LEFT JOIN users u ON u.id = a.user_id
           WHERE a.card_id = ? ORDER BY a.id DESC`,
        )
        .all(id) as Row[]
    ).map(this.toAttachment);

    const activity = (
      this.db
        .prepare(
          `SELECT a.*, u.name AS u_name, u.email AS u_email FROM activity a LEFT JOIN users u ON u.id = a.user_id
           WHERE a.card_id = ? AND a.type != 'comment.added' ORDER BY a.id DESC LIMIT 100`,
        )
        .all(id) as Row[]
    ).map(this.toActivity);

    return {
      ...summary,
      description: row.description,
      createdAt: row.created_at,
      checklists,
      comments,
      attachments,
      activity,
    };
  }

  updateCard(
    me: Me,
    id: number,
    patch: {
      title?: string;
      description?: string;
      due?: string | null;
      dueDone?: boolean;
      archived?: boolean;
      coverAttachmentId?: number | null;
    },
  ): void {
    const old = this.db.prepare('SELECT * FROM cards WHERE id = ?').get(id) as Row;
    const b = old.board_id as number;
    tx(this.db, () => {
      const set = (col: string, value: unknown) =>
        this.db.prepare(`UPDATE cards SET ${col} = ?, updated_at = ? WHERE id = ?`).run(value as never, now(), id);
      const title = patch.title ?? old.title;

      if (patch.title !== undefined && patch.title !== old.title) {
        set('title', patch.title);
        this.log(me, b, 'card.renamed', { from: old.title, title }, id);
      }
      if (patch.description !== undefined) set('description', patch.description);
      if (patch.due !== undefined && patch.due !== old.due) {
        set('due', patch.due);
        if (patch.due === null) set('due_done', 0);
        this.log(me, b, 'card.due', { title, due: patch.due }, id);
      }
      if (patch.dueDone !== undefined && patch.dueDone !== bool(old.due_done)) {
        set('due_done', patch.dueDone ? 1 : 0);
        this.log(me, b, 'card.completed', { title, done: patch.dueDone }, id);
      }
      if (patch.coverAttachmentId !== undefined) {
        if (patch.coverAttachmentId !== null) {
          const att = this.db
            .prepare('SELECT mime FROM attachments WHERE id = ? AND card_id = ?')
            .get(patch.coverAttachmentId, id) as Row | undefined;
          if (!att || !INLINE_IMAGE_TYPES.has(att.mime)) throw badRequest('Titelbild muss ein Bild dieser Karte sein');
        }
        set('cover_attachment_id', patch.coverAttachmentId);
      }
      if (patch.archived !== undefined && patch.archived !== bool(old.archived)) {
        if (patch.archived) set('archived', 1);
        else {
          const { n } = this.db
            .prepare('SELECT coalesce(max(pos), -1) + 1 AS n FROM cards WHERE list_id = ?')
            .get(old.list_id) as Row;
          this.db.prepare('UPDATE cards SET archived = 0, pos = ?, updated_at = ? WHERE id = ?').run(n, now(), id);
        }
        this.log(me, b, patch.archived ? 'card.archived' : 'card.restored', { title }, id);
      }
    });
  }

  /** Karte in eine Liste (desselben Boards) an Position index verschieben */
  moveCard(me: Me, id: number, listId: number, index: number): void {
    const card = this.db.prepare('SELECT * FROM cards WHERE id = ?').get(id) as Row;
    const target = this.db.prepare('SELECT * FROM lists WHERE id = ?').get(listId) as Row | undefined;
    if (!target || target.board_id !== card.board_id) throw badRequest('Zielliste gehört nicht zu diesem Board');
    if (bool(target.archived)) throw badRequest('Zielliste ist archiviert');
    tx(this.db, () => {
      if (card.list_id !== listId) {
        const from = this.db.prepare('SELECT title FROM lists WHERE id = ?').get(card.list_id) as Row;
        this.db.prepare('UPDATE cards SET list_id = ?, updated_at = ? WHERE id = ?').run(listId, now(), id);
        this.reorder('cards', 'list_id', card.list_id, -1, Number.MAX_SAFE_INTEGER);
        this.log(me, card.board_id, 'card.moved', { title: card.title, from: from.title, to: target.title }, id);
      }
      this.reorder('cards', 'list_id', listId, id, index);
    });
  }

  deleteCard(id: number): string[] {
    return tx(this.db, () => {
      const keys = (this.db.prepare('SELECT storage_key FROM attachments WHERE card_id = ?').all(id) as Row[]).map(
        (r) => r.storage_key as string,
      );
      this.db.prepare('DELETE FROM cards WHERE id = ?').run(id);
      return keys;
    });
  }

  setCardLabel(cardId: number, labelId: number, on: boolean): void {
    const card = this.db.prepare('SELECT board_id FROM cards WHERE id = ?').get(cardId) as Row;
    if (this.boardOfLabel(labelId) !== card.board_id) throw badRequest('Label gehört nicht zu diesem Board');
    if (on) this.db.prepare('INSERT OR IGNORE INTO card_labels (card_id, label_id) VALUES (?, ?)').run(cardId, labelId);
    else this.db.prepare('DELETE FROM card_labels WHERE card_id = ? AND label_id = ?').run(cardId, labelId);
  }

  setCardMember(me: Me, cardId: number, userId: string, on: boolean): void {
    const card = this.db.prepare('SELECT board_id, title FROM cards WHERE id = ?').get(cardId) as Row;
    const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as Row | undefined;
    if (!user) throw notFound('Benutzer nicht gefunden');
    if (on) {
      const target: Me = { ...toUser(user), isAdmin: bool(user.is_admin) };
      if (!this.permission(target, card.board_id).canRead) throw badRequest('Benutzer hat keinen Zugriff auf das Board');
      const { changes } = this.db
        .prepare('INSERT OR IGNORE INTO card_members (card_id, user_id) VALUES (?, ?)')
        .run(cardId, userId);
      if (changes) this.log(me, card.board_id, 'card.member.added', { title: card.title, name: user.name }, cardId);
    } else {
      const { changes } = this.db
        .prepare('DELETE FROM card_members WHERE card_id = ? AND user_id = ?')
        .run(cardId, userId);
      if (changes) this.log(me, card.board_id, 'card.member.removed', { title: card.title, name: user.name }, cardId);
    }
  }

  archive(boardId: number): ArchiveResponse {
    const lists = (
      this.db.prepare('SELECT * FROM lists WHERE board_id = ? AND archived = 1 ORDER BY title').all(boardId) as Row[]
    ).map(toList);
    const cards = this.cardSummaries(
      `${CARD_SELECT} WHERE c.board_id = ? AND c.archived = 1 ORDER BY c.updated_at DESC`,
      boardId,
    );
    const titles = new Map(
      (this.db.prepare('SELECT id, title FROM lists WHERE board_id = ?').all(boardId) as Row[]).map((r) => [r.id, r.title]),
    );
    return { lists, cards: cards.map((c) => ({ ...c, listTitle: titles.get(c.listId) ?? '' })) };
  }

  // -------------------------------------------------------------- Checklisten

  private cardTitle(cardId: number): { title: string; board_id: number } {
    return this.db.prepare('SELECT title, board_id FROM cards WHERE id = ?').get(cardId) as { title: string; board_id: number };
  }

  createChecklist(me: Me, cardId: number, title: string): number {
    return tx(this.db, () => {
      const { lastInsertRowid } = this.db
        .prepare(
          'INSERT INTO checklists (card_id, title, pos) VALUES (?, ?, (SELECT coalesce(max(pos), -1) + 1 FROM checklists WHERE card_id = ?))',
        )
        .run(cardId, title, cardId);
      const card = this.cardTitle(cardId);
      this.log(me, card.board_id, 'checklist.added', { title: card.title, checklist: title }, cardId);
      return Number(lastInsertRowid);
    });
  }

  updateChecklist(id: number, title: string): void {
    this.db.prepare('UPDATE checklists SET title = ? WHERE id = ?').run(title, id);
  }

  deleteChecklist(id: number): void {
    this.db.prepare('DELETE FROM checklists WHERE id = ?').run(id);
  }

  createCheckItem(checklistId: number, text: string): number {
    const { lastInsertRowid } = this.db
      .prepare(
        `INSERT INTO checklist_items (checklist_id, text, pos)
         VALUES (?, ?, (SELECT coalesce(max(pos), -1) + 1 FROM checklist_items WHERE checklist_id = ?))`,
      )
      .run(checklistId, text, checklistId);
    return Number(lastInsertRowid);
  }

  updateCheckItem(me: Me, id: number, patch: { text?: string; done?: boolean }): void {
    const item = this.db
      .prepare(
        `SELECT i.*, l.card_id FROM checklist_items i JOIN checklists l ON l.id = i.checklist_id WHERE i.id = ?`,
      )
      .get(id) as Row;
    tx(this.db, () => {
      if (patch.text !== undefined) this.db.prepare('UPDATE checklist_items SET text = ? WHERE id = ?').run(patch.text, id);
      if (patch.done !== undefined && patch.done !== bool(item.done)) {
        this.db.prepare('UPDATE checklist_items SET done = ? WHERE id = ?').run(patch.done ? 1 : 0, id);
        if (patch.done) {
          const card = this.cardTitle(item.card_id);
          this.log(me, card.board_id, 'checkitem.done', { title: card.title, item: patch.text ?? item.text }, item.card_id);
        }
      }
    });
  }

  deleteCheckItem(id: number): void {
    this.db.prepare('DELETE FROM checklist_items WHERE id = ?').run(id);
  }

  // -------------------------------------------------------------- Kommentare

  createComment(me: Me, cardId: number, text: string): number {
    return tx(this.db, () => {
      const { lastInsertRowid } = this.db
        .prepare('INSERT INTO comments (card_id, user_id, text, created_at) VALUES (?, ?, ?, ?)')
        .run(cardId, me.id, text, now());
      const card = this.cardTitle(cardId);
      this.log(me, card.board_id, 'comment.added', { title: card.title, text: text.slice(0, 200) }, cardId);
      return Number(lastInsertRowid);
    });
  }

  commentAuthor(id: number): string {
    return (this.db.prepare('SELECT user_id FROM comments WHERE id = ?').get(id) as Row).user_id;
  }

  updateComment(id: number, text: string): void {
    this.db.prepare('UPDATE comments SET text = ?, edited_at = ? WHERE id = ?').run(text, now(), id);
  }

  deleteComment(id: number): void {
    this.db.prepare('DELETE FROM comments WHERE id = ?').run(id);
  }

  // ----------------------------------------------------------------- Anhänge

  private toAttachment = (r: Row): Attachment => ({
    id: r.id,
    cardId: r.card_id,
    user: { id: r.user_id, name: r.name ?? 'Unbekannt', email: r.email ?? '' },
    filename: r.filename,
    mime: r.mime,
    size: r.size,
    createdAt: r.created_at,
    isImage: INLINE_IMAGE_TYPES.has(r.mime),
  });

  createAttachment(
    me: Me,
    cardId: number,
    file: { filename: string; mime: string; size: number; storageKey: string },
  ): Attachment {
    return tx(this.db, () => {
      const { lastInsertRowid } = this.db
        .prepare(
          `INSERT INTO attachments (card_id, user_id, filename, mime, size, storage_key, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(cardId, me.id, file.filename, file.mime, file.size, file.storageKey, now());
      const id = Number(lastInsertRowid);
      // Erstes Bild wird automatisch Titelbild
      if (INLINE_IMAGE_TYPES.has(file.mime)) {
        this.db.prepare('UPDATE cards SET cover_attachment_id = ? WHERE id = ? AND cover_attachment_id IS NULL').run(id, cardId);
      }
      const card = this.cardTitle(cardId);
      this.log(me, card.board_id, 'attachment.added', { title: card.title, filename: file.filename }, cardId);
      return this.attachment(id).attachment;
    });
  }

  attachment(id: number): { attachment: Attachment; storageKey: string } {
    const r = this.db
      .prepare('SELECT a.*, u.name, u.email FROM attachments a LEFT JOIN users u ON u.id = a.user_id WHERE a.id = ?')
      .get(id) as Row | undefined;
    if (!r) throw notFound('Anhang nicht gefunden');
    return { attachment: this.toAttachment(r), storageKey: r.storage_key };
  }

  deleteAttachment(me: Me, id: number): string {
    return tx(this.db, () => {
      const { attachment, storageKey } = this.attachment(id);
      this.db.prepare('UPDATE cards SET cover_attachment_id = NULL WHERE cover_attachment_id = ?').run(id);
      this.db.prepare('DELETE FROM attachments WHERE id = ?').run(id);
      const card = this.cardTitle(attachment.cardId);
      this.log(me, card.board_id, 'attachment.removed', { title: card.title, filename: attachment.filename }, attachment.cardId);
      return storageKey;
    });
  }
}
