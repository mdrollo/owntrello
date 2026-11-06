/**
 * Gemeinsames Datenmodell von Server und Web-App.
 *
 * Zeitstempel sind ISO-Strings in UTC (`2026-11-04T20:15:00.000Z`),
 * Fälligkeiten ebenfalls (der Browser zeigt sie in Ortszeit an).
 */

export interface User {
  /** Entra-Objekt-ID (oid); lokal ohne Anmeldung „dev“ */
  id: string;
  name: string;
  email: string;
}

export interface Me extends User {
  /** Administratoren sehen und verwalten alle Boards */
  isAdmin: boolean;
}

/**
 * Rechte eines Benutzers an einem Board.
 * Schreiben schließt Lesen ein, Verwalten (Mitglieder und Rechte ändern,
 * Board archivieren/löschen) schließt beides ein.
 */
export interface Permission {
  canRead: boolean;
  canWrite: boolean;
  canManage: boolean;
}

export const NO_PERMISSION: Permission = { canRead: false, canWrite: false, canManage: false };

/** Rechte in sich stimmig machen (Verwalten ⇒ Schreiben ⇒ Lesen) */
export function normalizePermission(p: Partial<Permission>): Permission {
  const canManage = !!p.canManage;
  const canWrite = canManage || !!p.canWrite;
  const canRead = canWrite || !!p.canRead;
  return { canRead, canWrite, canManage };
}

export interface BoardSummary {
  id: number;
  title: string;
  color: string;
  archived: boolean;
  starred: boolean;
  permission: Permission;
}

export interface BoardMember extends Permission {
  user: User;
}

/** Freigabe für jemanden, der sich noch nie angemeldet hat (wird bei der ersten Anmeldung übernommen) */
export interface BoardInvite extends Permission {
  email: string;
}

export interface Label {
  id: number;
  boardId: number;
  name: string;
  color: string;
}

export interface List {
  id: number;
  boardId: number;
  title: string;
  pos: number;
  archived: boolean;
}

export interface CardBadges {
  comments: number;
  attachments: number;
  checkItems: number;
  checkItemsDone: number;
}

export interface CardSummary {
  id: number;
  boardId: number;
  listId: number;
  title: string;
  pos: number;
  archived: boolean;
  hasDescription: boolean;
  due: string | null;
  dueDone: boolean;
  labelIds: number[];
  memberIds: string[];
  /** Anhang (Bild), der oben auf der Karte angezeigt wird */
  coverAttachmentId: number | null;
  badges: CardBadges;
}

export interface Board {
  id: number;
  title: string;
  color: string;
  archived: boolean;
  createdAt: string;
}

export interface BoardDetail {
  board: Board;
  starred: boolean;
  permission: Permission;
  lists: List[];
  cards: CardSummary[];
  labels: Label[];
  members: BoardMember[];
  invites: BoardInvite[];
}

export interface ChecklistItem {
  id: number;
  checklistId: number;
  text: string;
  done: boolean;
  pos: number;
}

export interface Checklist {
  id: number;
  cardId: number;
  title: string;
  pos: number;
  items: ChecklistItem[];
}

export interface Comment {
  id: number;
  cardId: number;
  user: User;
  text: string;
  createdAt: string;
  editedAt: string | null;
}

export interface Attachment {
  id: number;
  cardId: number;
  user: User;
  filename: string;
  mime: string;
  size: number;
  createdAt: string;
  /** Bild, das der Browser direkt anzeigen darf */
  isImage: boolean;
}

export type ActivityType =
  | 'board.created'
  | 'board.renamed'
  | 'list.created'
  | 'list.renamed'
  | 'list.archived'
  | 'list.restored'
  | 'card.created'
  | 'card.renamed'
  | 'card.moved'
  /** auf ein anderes Board verschoben */
  | 'card.transferred'
  | 'card.archived'
  | 'card.restored'
  | 'card.due'
  | 'card.completed'
  | 'card.member.added'
  | 'card.member.removed'
  | 'comment.added'
  | 'attachment.added'
  | 'attachment.removed'
  | 'checklist.added'
  | 'checkitem.done'
  | 'member.changed'
  | 'member.removed';

export interface Activity {
  id: number;
  boardId: number;
  cardId: number | null;
  user: User;
  type: ActivityType;
  /** Namen zum Zeitpunkt der Aktion (Karten-/Listentitel usw.), damit der Verlauf lesbar bleibt */
  data: Record<string, string | number | boolean | null>;
  createdAt: string;
}

export interface CardDetail extends CardSummary {
  description: string;
  createdAt: string;
  checklists: Checklist[];
  comments: Comment[];
  attachments: Attachment[];
  activity: Activity[];
}

export interface ArchiveResponse {
  lists: List[];
  cards: (CardSummary & { listTitle: string })[];
}

/** Hintergrundfarben für Boards */
export const BOARD_COLORS = [
  '#0c66e4',
  '#1f845a',
  '#c25100',
  '#ae2e24',
  '#6e5dc6',
  '#a54800',
  '#206a83',
  '#5e4db2',
  '#626f86',
  '#943d73',
] as const;

/** Farben für Labels */
export const LABEL_COLORS = [
  '#4bce97',
  '#f5cd47',
  '#fea362',
  '#f87168',
  '#9f8fef',
  '#579dff',
  '#6cc3e0',
  '#94c748',
  '#e774bb',
  '#8590a2',
] as const;

/** Ereignis über den Live-Kanal eines Boards (/api/boards/:id/events) */
export interface BoardEvent {
  type: 'changed' | 'deleted';
  boardId: number;
  /** betroffene Karte, falls eine bestimmte */
  cardId?: number;
  /** wer die Änderung gemacht hat (eigene Änderungen kann der Client ignorieren) */
  by: string;
}
