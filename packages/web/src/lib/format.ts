import type { Activity } from '@owntrello/shared';

const dayFmt = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' });
const dayYearFmt = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });

/** „4. Nov.“ (im laufenden Jahr) bzw. „4. Nov. 2027“ */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  return (d.getFullYear() === new Date().getFullYear() ? dayFmt : dayYearFmt).format(d);
}

/** „4. Nov., 14:30“ */
export function dateTime(iso: string): string {
  return `${shortDate(iso)}, ${timeFmt.format(new Date(iso))}`;
}

/** „vor 5 Minuten“, „gestern“ … für Kommentare und Verlauf */
export function relativeTime(iso: string): string {
  const diff = (Date.now() - Date.parse(iso)) / 1000;
  if (diff < 60) return 'gerade eben';
  if (diff < 3600) return `vor ${Math.floor(diff / 60)} Min.`;
  if (diff < 86400) return `vor ${Math.floor(diff / 3600)} Std.`;
  if (diff < 2 * 86400) return `gestern, ${timeFmt.format(new Date(iso))}`;
  return dateTime(iso);
}

export type DueState = 'done' | 'overdue' | 'soon' | 'later';

export function dueState(due: string, done: boolean): DueState {
  if (done) return 'done';
  const ms = Date.parse(due) - Date.now();
  if (ms < 0) return 'overdue';
  if (ms < 24 * 3600 * 1000) return 'soon';
  return 'later';
}

/** ISO (UTC) → Wert für <input type="datetime-local"> in Ortszeit */
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

const q = (v: unknown) => `„${String(v ?? '')}“`;

/** Verlaufseintrag als Satz (ohne den Namen davor) */
export function describeActivity(a: Activity, withCard = true): string {
  const d = a.data;
  const card = withCard && d.title ? ` bei ${q(d.title)}` : '';
  switch (a.type) {
    case 'board.created':
      return `hat das Board ${q(d.title)} erstellt`;
    case 'board.renamed':
      return `hat das Board in ${q(d.title)} umbenannt`;
    case 'list.created':
      return `hat die Liste ${q(d.title)} hinzugefügt`;
    case 'list.renamed':
      return `hat die Liste ${q(d.from)} in ${q(d.title)} umbenannt`;
    case 'list.archived':
      return `hat die Liste ${q(d.title)} archiviert`;
    case 'list.restored':
      return `hat die Liste ${q(d.title)} wiederhergestellt`;
    case 'card.created':
      return withCard ? `hat ${q(d.title)} zu ${q(d.list)} hinzugefügt` : `hat diese Karte zu ${q(d.list)} hinzugefügt`;
    case 'card.renamed':
      return withCard ? `hat ${q(d.from)} in ${q(d.title)} umbenannt` : `hat die Karte von ${q(d.from)} umbenannt`;
    case 'card.moved':
      return withCard
        ? `hat ${q(d.title)} von ${q(d.from)} nach ${q(d.to)} verschoben`
        : `hat diese Karte von ${q(d.from)} nach ${q(d.to)} verschoben`;
    case 'card.archived':
      return withCard ? `hat ${q(d.title)} archiviert` : 'hat diese Karte archiviert';
    case 'card.restored':
      return withCard ? `hat ${q(d.title)} wiederhergestellt` : 'hat diese Karte wiederhergestellt';
    case 'card.due':
      return d.due ? `hat das Fälligkeitsdatum${card} auf ${dateTime(String(d.due))} gesetzt` : `hat das Fälligkeitsdatum${card} entfernt`;
    case 'card.completed': {
      const what = withCard && d.title ? q(d.title) : 'diese Karte';
      return `hat ${what} als ${d.done ? 'erledigt' : 'nicht erledigt'} markiert`;
    }
    case 'card.member.added':
      return `hat ${d.name}${card || ' zu dieser Karte'} hinzugefügt`;
    case 'card.member.removed':
      return `hat ${d.name}${card ? ` von ${q(d.title)}` : ' von dieser Karte'} entfernt`;
    case 'comment.added':
      return `hat${card} kommentiert`;
    case 'attachment.added':
      return `hat ${q(d.filename)}${card ? ` an ${q(d.title)}` : ''} angehängt`;
    case 'attachment.removed':
      return `hat den Anhang ${q(d.filename)}${card ? ` von ${q(d.title)}` : ''} entfernt`;
    case 'checklist.added':
      return `hat die Checkliste ${q(d.checklist)}${card ? ` zu ${q(d.title)}` : ''} hinzugefügt`;
    case 'checkitem.done':
      return `hat ${q(d.item)}${card ? ` bei ${q(d.title)}` : ''} abgehakt`;
    case 'member.changed': {
      const role = d.canManage ? 'Verwalten' : d.canWrite ? 'Lesen und Schreiben' : 'Lesen';
      return `hat ${d.name} das Recht „${role}“ gegeben`;
    }
    case 'member.removed':
      return `hat ${d.name} vom Board entfernt`;
    default:
      return 'hat etwas geändert';
  }
}
