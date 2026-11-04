import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity as ActivityIcon,
  AlignLeft,
  Archive,
  ArrowRight,
  CheckSquare,
  Clock,
  CreditCard,
  Download,
  Image as ImageIcon,
  Paperclip,
  Plus,
  RotateCcw,
  Tag,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import type { Activity, Attachment, BoardDetail, BoardSummary, CardDetail, Checklist, Comment } from '@owntrello/shared';
import { api, ApiError } from '../lib/api';
import { dateTime, describeActivity, dueState, fileSize, fromLocalInput, relativeTime, toLocalInput } from '../lib/format';
import { RichText } from '../lib/richText';
import { navigate } from '../lib/router';
import { useBoard } from './BoardPage';
import { LabelManager } from './Labels';
import { NoteEditor } from './NoteEditor';
import { Avatar, InlineEdit, Modal, Popover, usePopover, useNotify, useRun } from './ui';

type PopKind = 'members' | 'labels' | 'checklist' | 'due' | 'attach' | 'move';

export function CardDialog({ cardId, onClose }: { cardId: number; onClose: () => void }) {
  const { version, reload, canWrite, listsById, detail: board } = useBoard();
  const [card, setCard] = useState<CardDetail | null>(null);
  const notify = useNotify();
  const run = useRun();
  const pop = usePopover<PopKind>();
  const [dropping, setDropping] = useState(false);

  const load = useCallback(async () => {
    try {
      const c = await api.cards.get(cardId);
      if (c.boardId !== board.board.id) {
        // Inzwischen auf ein anderes Board verschoben (von hier oder von jemand anderem)
        navigate(`/b/${c.boardId}/c/${c.id}`);
        return;
      }
      setCard(c);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        notify('Die Karte gibt es nicht mehr.');
        onClose();
      } else notify(err instanceof Error ? err.message : String(err));
    }
  }, [cardId, notify, onClose, board.board.id]);

  // Bei jeder Änderung am Board (eigene oder fremde) neu laden
  useEffect(() => {
    void load();
  }, [load, version]);

  /** Aktion ausführen, danach Board (und damit die Karte) neu laden */
  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      await run(fn);
      await reload();
    },
    [run, reload],
  );

  const upload = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) await act(() => api.cards.upload(cardId, file));
  };

  if (!card) {
    return (
      <Modal onClose={onClose} label="Karte" className="card-modal">
        <div className="page-message">Lädt …</div>
      </Modal>
    );
  }

  const list = listsById.get(card.listId);
  const members = card.memberIds.map((id) => board.members.find((m) => m.user.id === id)?.user).filter((u) => !!u);
  const labels = card.labelIds.map((id) => board.labels.find((l) => l.id === id)).filter((l) => !!l);
  const due = card.due ? dueState(card.due, card.dueDone) : null;

  return (
    <Modal onClose={onClose} label={`Karte ${card.title}`} className="card-modal">
      <div
        className={`card-dialog ${dropping ? 'dropping' : ''}`}
        onDragOver={(e) => {
          if (canWrite && e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            setDropping(true);
          }
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDropping(false);
        }}
        onDrop={(e) => {
          if (!canWrite) return;
          e.preventDefault();
          setDropping(false);
          void upload(e.dataTransfer.files);
        }}
      >
        <button type="button" className="icon-btn dialog-close" aria-label="Schließen" onClick={onClose}>
          <X size={20} />
        </button>
        {card.coverAttachmentId && (
          <div className="dialog-cover">
            <img src={api.attachments.url(card.coverAttachmentId)} alt="" />
          </div>
        )}
        {card.archived && (
          <div className="archived-banner">
            <Archive size={16} /> Diese Karte ist archiviert.
          </div>
        )}

        <header className="dialog-header">
          <CreditCard size={20} className="section-icon" />
          <div>
            <InlineEdit
              className="dialog-title"
              value={card.title}
              disabled={!canWrite}
              multiline
              ariaLabel="Kartentitel"
              onSave={(title) => void act(() => api.cards.update(card.id, { title }))}
            />
            <div className="muted small">
              in Liste <strong>{list?.title ?? '?'}</strong>
            </div>
          </div>
        </header>

        <div className="dialog-grid">
          <div className="dialog-main">
            <div className="chips">
              {members.length > 0 && (
                <div className="chip-group">
                  <h4>Mitglieder</h4>
                  <div className="row">
                    {members.map((u) => (
                      <Avatar key={u!.id} user={u!} size={32} />
                    ))}
                    {canWrite && (
                      <button type="button" className="round-btn" aria-label="Mitglieder" onClick={pop.toggle('members')}>
                        <Plus size={16} />
                      </button>
                    )}
                  </div>
                </div>
              )}
              {labels.length > 0 && (
                <div className="chip-group">
                  <h4>Labels</h4>
                  <div className="row wrap">
                    {labels.map((l) => (
                      <span key={l!.id} className="label-pill big" style={{ background: l!.color }}>
                        {l!.name}
                      </span>
                    ))}
                    {canWrite && (
                      <button type="button" className="round-btn" aria-label="Labels" onClick={pop.toggle('labels')}>
                        <Plus size={16} />
                      </button>
                    )}
                  </div>
                </div>
              )}
              {card.due && (
                <div className="chip-group">
                  <h4>Fällig</h4>
                  <div className="row">
                    <input
                      type="checkbox"
                      checked={card.dueDone}
                      disabled={!canWrite}
                      aria-label="Erledigt"
                      onChange={(e) => void act(() => api.cards.update(card.id, { dueDone: e.target.checked }))}
                    />
                    <button type="button" className="due-chip" disabled={!canWrite} onClick={pop.toggle('due')}>
                      {dateTime(card.due)}
                      {due === 'done' && <span className="due-tag done">Erledigt</span>}
                      {due === 'overdue' && <span className="due-tag overdue">Überfällig</span>}
                      {due === 'soon' && <span className="due-tag soon">Bald fällig</span>}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <Description card={card} onSave={(description) => act(() => api.cards.update(card.id, { description }))} />

            {card.attachments.length > 0 && (
              <Attachments
                card={card}
                onAdd={pop.toggle('attach')}
                act={act}
              />
            )}

            {card.checklists.map((cl) => (
              <ChecklistView key={cl.id} checklist={cl} act={act} />
            ))}

            <ActivitySection card={card} act={act} />
          </div>

          {canWrite && (
            <aside className="dialog-side">
              <h4>Zur Karte hinzufügen</h4>
              <button type="button" className="side-btn" onClick={pop.toggle('members')}>
                <Users size={16} /> Mitglieder
              </button>
              <button type="button" className="side-btn" onClick={pop.toggle('labels')}>
                <Tag size={16} /> Labels
              </button>
              <button type="button" className="side-btn" onClick={pop.toggle('checklist')}>
                <CheckSquare size={16} /> Checkliste
              </button>
              <button type="button" className="side-btn" onClick={pop.toggle('due')}>
                <Clock size={16} /> Fälligkeit
              </button>
              <button type="button" className="side-btn" onClick={pop.toggle('attach')}>
                <Paperclip size={16} /> Anhang
              </button>
              <h4>Aktionen</h4>
              <button type="button" className="side-btn" onClick={pop.toggle('move')}>
                <ArrowRight size={16} /> Verschieben
              </button>
              {card.archived ? (
                <>
                  <button
                    type="button"
                    className="side-btn"
                    onClick={() => void act(() => api.cards.update(card.id, { archived: false }))}
                  >
                    <RotateCcw size={16} /> Wiederherstellen
                  </button>
                  <button
                    type="button"
                    className="side-btn danger"
                    onClick={async () => {
                      if (!confirm('Karte endgültig löschen? Das lässt sich nicht rückgängig machen.')) return;
                      await run(() => api.cards.remove(card.id));
                      onClose();
                      await reload();
                    }}
                  >
                    <Trash2 size={16} /> Löschen
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="side-btn"
                  onClick={() => void act(() => api.cards.update(card.id, { archived: true }))}
                >
                  <Archive size={16} /> Archivieren
                </button>
              )}
            </aside>
          )}
        </div>

        {pop.open && (
          <CardPopover kind={pop.open.kind} anchor={pop.open.anchor} card={card} onClose={pop.close} act={act} upload={upload} />
        )}
      </div>
    </Modal>
  );
}

// --------------------------------------------------------------- Popover

function CardPopover({
  kind,
  anchor,
  card,
  onClose,
  act,
  upload,
}: {
  kind: PopKind;
  anchor: HTMLElement;
  card: CardDetail;
  onClose: () => void;
  act: (fn: () => Promise<unknown>) => Promise<void>;
  upload: (files: FileList) => Promise<void>;
}) {
  const { detail } = useBoard();
  const titles: Record<PopKind, string> = {
    members: 'Mitglieder',
    labels: 'Labels',
    checklist: 'Checkliste hinzufügen',
    due: 'Fälligkeit',
    attach: 'Anhang hinzufügen',
    move: 'Karte verschieben',
  };

  let body: React.ReactNode = null;
  if (kind === 'members') {
    body = (
      <ul className="pick-list">
        {detail.members.map((m) => {
          const on = card.memberIds.includes(m.user.id);
          return (
            <li key={m.user.id}>
              <button type="button" className="pick-item" onClick={() => void act(() => api.cards.setMember(card.id, m.user.id, !on))}>
                <Avatar user={m.user} size={28} />
                <span>{m.user.name}</span>
                {on && <CheckSquare size={16} className="push-right" />}
              </button>
            </li>
          );
        })}
      </ul>
    );
  } else if (kind === 'labels') {
    body = (
      <LabelManager
        selected={card.labelIds}
        onToggle={(label, on) => void act(() => api.cards.setLabel(card.id, label.id, on))}
      />
    );
  } else if (kind === 'checklist') {
    body = (
      <TitleForm
        initial="Checkliste"
        label="Titel"
        submit="Hinzufügen"
        onSubmit={async (title) => {
          await act(() => api.cards.addChecklist(card.id, title));
          onClose();
        }}
      />
    );
  } else if (kind === 'due') {
    body = <DueForm card={card} act={act} onClose={onClose} />;
  } else if (kind === 'attach') {
    body = (
      <div className="stack">
        <label className="btn primary file-btn">
          Datei vom Computer wählen
          <input
            type="file"
            multiple
            onChange={(e) => {
              if (e.target.files?.length) {
                void upload(e.target.files);
                onClose();
              }
            }}
          />
        </label>
        <p className="muted small">Tipp: Dateien lassen sich auch direkt auf die Karte ziehen.</p>
      </div>
    );
  } else if (kind === 'move') {
    body = <MoveForm card={card} act={act} onClose={onClose} />;
  }

  return (
    <Popover anchor={anchor} title={titles[kind]} onClose={onClose}>
      {body}
    </Popover>
  );
}

function TitleForm({
  initial,
  label,
  submit,
  onSubmit,
}: {
  initial: string;
  label: string;
  submit: string;
  onSubmit: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initial);
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) void onSubmit(value.trim());
      }}
    >
      <label className="field">
        <span>{label}</span>
        <input autoFocus value={value} maxLength={500} onFocus={(e) => e.target.select()} onChange={(e) => setValue(e.target.value)} />
      </label>
      <button type="submit" className="btn primary">
        {submit}
      </button>
    </form>
  );
}

function DueForm({ card, act, onClose }: { card: CardDetail; act: (fn: () => Promise<unknown>) => Promise<void>; onClose: () => void }) {
  const initial = card.due ?? (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(12, 0, 0, 0);
    return d.toISOString();
  })();
  const [value, setValue] = useState(toLocalInput(initial));
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        await act(() => api.cards.update(card.id, { due: fromLocalInput(value) }));
        onClose();
      }}
    >
      <label className="field">
        <span>Fälligkeitsdatum</span>
        <input type="datetime-local" autoFocus value={value} onChange={(e) => setValue(e.target.value)} required />
      </label>
      <button type="submit" className="btn primary">
        Speichern
      </button>
      {card.due && (
        <button
          type="button"
          className="btn"
          onClick={async () => {
            await act(() => api.cards.update(card.id, { due: null }));
            onClose();
          }}
        >
          Entfernen
        </button>
      )}
    </form>
  );
}

function MoveForm({ card, act, onClose }: { card: CardDetail; act: (fn: () => Promise<unknown>) => Promise<void>; onClose: () => void }) {
  const { detail, reload } = useBoard();
  const run = useRun();
  const notify = useNotify();
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [boardId, setBoardId] = useState(detail.board.id);
  // Ziel-Board: das aktuelle aus dem Kontext, andere werden nachgeladen
  const [target, setTarget] = useState<BoardDetail>(detail);
  const [listId, setListId] = useState(card.listId);

  useEffect(() => {
    void run(async () => {
      const all = (await api.boards.list()).boards;
      setBoards(all.filter((b) => b.permission.canWrite && !b.archived));
    });
  }, [run]);

  useEffect(() => {
    if (boardId === detail.board.id) {
      setTarget(detail);
      return;
    }
    let cancelled = false;
    void run(async () => {
      const d = await api.boards.get(boardId);
      if (!cancelled) setTarget(d);
    });
    return () => {
      cancelled = true;
    };
  }, [boardId, detail, run]);

  // Beim Board-Wechsel erste Liste vorwählen
  useEffect(() => {
    if (!target.lists.some((l) => l.id === listId)) setListId(target.lists[0]?.id ?? 0);
  }, [target, listId]);

  const count = target.cards.filter((c) => c.listId === listId && c.id !== card.id).length;
  const current = target.cards
    .filter((c) => c.listId === card.listId)
    .sort((a, b) => a.pos - b.pos)
    .findIndex((c) => c.id === card.id);
  const defaultIndex = listId === card.listId && current >= 0 ? current : count;
  const [index, setIndex] = useState(defaultIndex);
  useEffect(() => setIndex(defaultIndex), [defaultIndex]);

  const otherBoard = target.board.id !== detail.board.id;
  const ready = target.board.id === boardId && target.lists.some((l) => l.id === listId);

  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ready) return;
        if (!otherBoard) {
          await act(() => api.cards.move(card.id, listId, index));
          onClose();
          return;
        }
        const res = await run(() => api.cards.move(card.id, listId, index));
        if (!res) return;
        onClose();
        notify(`Karte nach „${target.board.title}“ verschoben.`);
        await reload();
        navigate(`/b/${res.boardId}/c/${card.id}`);
      }}
    >
      <label className="field">
        <span>Board</span>
        <select value={boardId} onChange={(e) => setBoardId(Number(e.target.value))}>
          {(boards.length ? boards : [{ id: detail.board.id, title: detail.board.title }]).map((b) => (
            <option key={b.id} value={b.id}>
              {b.title}
              {b.id === detail.board.id ? ' (aktuell)' : ''}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Liste</span>
        <select value={listId} onChange={(e) => setListId(Number(e.target.value))} disabled={!target.lists.length}>
          {target.lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.title}
              {l.id === card.listId ? ' (aktuell)' : ''}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Position</span>
        <select value={index} onChange={(e) => setIndex(Number(e.target.value))}>
          {Array.from({ length: count + 1 }, (_, i) => (
            <option key={i} value={i}>
              {i + 1}
            </option>
          ))}
        </select>
      </label>
      {otherBoard && (
        <p className="muted small">
          Labels werden übernommen (fehlende im Ziel-Board angelegt). Mitglieder ohne Zugriff auf das Ziel-Board werden von
          der Karte entfernt. Kommentare, Anhänge und Checklisten wandern mit.
        </p>
      )}
      {otherBoard && !target.lists.length && <p className="muted small">Das Ziel-Board hat noch keine Liste.</p>}
      <button type="submit" className="btn primary" disabled={card.archived || !ready}>
        Verschieben
      </button>
    </form>
  );
}

// ----------------------------------------------------------- Beschreibung

function Description({ card, onSave }: { card: CardDetail; onSave: (description: string) => Promise<void> }) {
  const { canWrite } = useBoard();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(card.description);
  useEffect(() => {
    if (!editing) setDraft(card.description);
  }, [card.description, editing]);

  return (
    <section className="dialog-section">
      <h3>
        <AlignLeft size={20} className="section-icon" /> Beschreibung
        {canWrite && !editing && card.description && (
          <button type="button" className="btn small push-right" onClick={() => setEditing(true)}>
            Bearbeiten
          </button>
        )}
      </h3>
      {editing ? (
        <div className="stack indent">
          <NoteEditor value={draft} onChange={setDraft} rows={6} maxLength={20000} alwaysEdit autoFocus />
          <div className="row">
            <button
              type="button"
              className="btn primary"
              onClick={async () => {
                await onSave(draft);
                setEditing(false);
              }}
            >
              Speichern
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setDraft(card.description);
                setEditing(false);
              }}
            >
              Abbrechen
            </button>
          </div>
        </div>
      ) : card.description ? (
        <div className="indent">
          <RichText text={card.description} />
        </div>
      ) : canWrite ? (
        <button type="button" className="placeholder-box indent" onClick={() => setEditing(true)}>
          Ausführlichere Beschreibung hinzufügen …
        </button>
      ) : (
        <p className="muted indent">Keine Beschreibung.</p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- Anhänge

function Attachments({
  card,
  onAdd,
  act,
}: {
  card: CardDetail;
  onAdd: (e: React.MouseEvent<HTMLElement>) => void;
  act: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const { canWrite } = useBoard();
  return (
    <section className="dialog-section">
      <h3>
        <Paperclip size={20} className="section-icon" /> Anhänge
        {canWrite && (
          <button type="button" className="btn small push-right" onClick={onAdd}>
            Hinzufügen
          </button>
        )}
      </h3>
      <ul className="attachments indent">
        {card.attachments.map((a) => (
          <AttachmentRow key={a.id} a={a} isCover={card.coverAttachmentId === a.id} cardId={card.id} act={act} />
        ))}
      </ul>
    </section>
  );
}

function AttachmentRow({
  a,
  isCover,
  cardId,
  act,
}: {
  a: Attachment;
  isCover: boolean;
  cardId: number;
  act: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const { canWrite } = useBoard();
  const ext = a.filename.includes('.') ? a.filename.split('.').pop()!.slice(0, 4).toUpperCase() : 'DATEI';
  return (
    <li className="attachment">
      <a className="attachment-thumb" href={api.attachments.url(a.id, !a.isImage)} target="_blank" rel="noopener noreferrer">
        {a.isImage ? <img src={api.attachments.url(a.id)} alt="" loading="lazy" /> : <span>{ext}</span>}
      </a>
      <div className="attachment-info">
        <a className="attachment-name" href={api.attachments.url(a.id, !a.isImage)} target="_blank" rel="noopener noreferrer">
          {a.filename}
        </a>
        <div className="muted small">
          {relativeTime(a.createdAt)} · {fileSize(a.size)} · {a.user.name}
        </div>
        <div className="attachment-actions">
          <a href={api.attachments.url(a.id, true)} download={a.filename}>
            <Download size={13} /> Herunterladen
          </a>
          {canWrite && a.isImage && (
            <button
              type="button"
              className="link-btn"
              onClick={() => void act(() => api.cards.update(cardId, { coverAttachmentId: isCover ? null : a.id }))}
            >
              <ImageIcon size={13} /> {isCover ? 'Titelbild entfernen' : 'Als Titelbild'}
            </button>
          )}
          {canWrite && (
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                if (confirm(`Anhang „${a.filename}“ löschen?`)) void act(() => api.attachments.remove(a.id));
              }}
            >
              <Trash2 size={13} /> Löschen
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

// ------------------------------------------------------------- Checklisten

function ChecklistView({ checklist, act }: { checklist: Checklist; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  const { canWrite } = useBoard();
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const [hideDone, setHideDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const done = checklist.items.filter((i) => i.done).length;
  const total = checklist.items.length;
  const percent = total ? Math.round((done / total) * 100) : 0;
  const items = hideDone ? checklist.items.filter((i) => !i.done) : checklist.items;

  return (
    <section className="dialog-section">
      <h3>
        <CheckSquare size={20} className="section-icon" />
        <InlineEdit
          value={checklist.title}
          disabled={!canWrite}
          ariaLabel="Checklistentitel"
          onSave={(title) => void act(() => api.checklists.rename(checklist.id, title))}
        />
        <span className="push-right row">
          {done > 0 && (
            <button type="button" className="btn small" onClick={() => setHideDone((v) => !v)}>
              {hideDone ? `Erledigte anzeigen (${done})` : 'Erledigte ausblenden'}
            </button>
          )}
          {canWrite && (
            <button
              type="button"
              className="btn small"
              onClick={() => {
                if (confirm(`Checkliste „${checklist.title}“ löschen?`)) void act(() => api.checklists.remove(checklist.id));
              }}
            >
              Löschen
            </button>
          )}
        </span>
      </h3>
      <div className="progress">
        <span className="progress-label">{percent} %</span>
        <div className="progress-bar">
          <div className={percent === 100 ? 'complete' : ''} style={{ width: `${percent}%` }} />
        </div>
      </div>
      <ul className="check-items">
        {items.map((item) => (
          <li key={item.id} className={item.done ? 'done' : ''}>
            <input
              type="checkbox"
              checked={item.done}
              disabled={!canWrite}
              aria-label={item.text}
              onChange={(e) => void act(() => api.checkItems.update(item.id, { done: e.target.checked }))}
            />
            <InlineEdit
              className="check-text"
              value={item.text}
              disabled={!canWrite}
              multiline
              ariaLabel="Eintrag"
              onSave={(t) => void act(() => api.checkItems.update(item.id, { text: t }))}
            />
            {canWrite && (
              <button
                type="button"
                className="icon-btn check-delete"
                aria-label="Eintrag löschen"
                onClick={() => void act(() => api.checkItems.remove(item.id))}
              >
                <Trash2 size={14} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {canWrite &&
        (adding ? (
          <form
            className="stack indent"
            onSubmit={async (e) => {
              e.preventDefault();
              const t = text.trim();
              if (!t) return;
              setText('');
              await act(() => api.checklists.addItem(checklist.id, t));
              inputRef.current?.focus();
            }}
          >
            <input
              ref={inputRef}
              autoFocus
              value={text}
              placeholder="Eintrag hinzufügen"
              maxLength={500}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setAdding(false))}
            />
            <div className="row">
              <button type="submit" className="btn primary">
                Hinzufügen
              </button>
              <button type="button" className="btn" onClick={() => setAdding(false)}>
                Abbrechen
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className="btn small indent" onClick={() => setAdding(true)}>
            Eintrag hinzufügen
          </button>
        ))}
    </section>
  );
}

// ------------------------------------------------- Kommentare und Verlauf

function ActivitySection({ card, act }: { card: CardDetail; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  const { me, canWrite } = useBoard();
  const [showDetails, setShowDetails] = useState(true);
  const [draft, setDraft] = useState('');
  const [composing, setComposing] = useState(false);

  type Entry = { kind: 'comment'; at: string; comment: Comment } | { kind: 'activity'; at: string; activity: Activity };
  const entries: Entry[] = [
    ...card.comments.map((c): Entry => ({ kind: 'comment', at: c.createdAt, comment: c })),
    ...(showDetails ? card.activity.map((a): Entry => ({ kind: 'activity', at: a.createdAt, activity: a })) : []),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <section className="dialog-section">
      <h3>
        <ActivityIcon size={20} className="section-icon" /> Aktivität
        <button type="button" className="btn small push-right" onClick={() => setShowDetails((v) => !v)}>
          {showDetails ? 'Details ausblenden' : 'Details anzeigen'}
        </button>
      </h3>
      {canWrite && (
        <div className="comment-row">
          <Avatar user={me} size={32} />
          {composing ? (
            <div className="stack grow">
              <NoteEditor value={draft} onChange={setDraft} rows={3} maxLength={10000} alwaysEdit autoFocus placeholder="Kommentar schreiben …" />
              <div className="row">
                <button
                  type="button"
                  className="btn primary"
                  disabled={!draft.trim()}
                  onClick={async () => {
                    await act(() => api.cards.addComment(card.id, draft.trim()));
                    setDraft('');
                    setComposing(false);
                  }}
                >
                  Speichern
                </button>
                <button type="button" className="btn" onClick={() => setComposing(false)}>
                  Abbrechen
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="placeholder-box grow" onClick={() => setComposing(true)}>
              {draft || 'Kommentar schreiben …'}
            </button>
          )}
        </div>
      )}
      <ul className="activity-list">
        {entries.map((e) =>
          e.kind === 'comment' ? (
            <CommentItem key={`c${e.comment.id}`} comment={e.comment} act={act} />
          ) : (
            <li key={`a${e.activity.id}`} className="activity-item">
              <Avatar user={e.activity.user} size={32} />
              <div>
                <strong>{e.activity.user.name}</strong> {describeActivity(e.activity, false)}
                <div className="muted small">{relativeTime(e.activity.createdAt)}</div>
              </div>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}

function CommentItem({ comment, act }: { comment: Comment; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  const { me, canWrite, detail } = useBoard();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.text);
  const own = comment.user.id === me.id;
  const canDelete = canWrite && (own || detail.permission.canManage);

  return (
    <li className="activity-item">
      <Avatar user={comment.user} size={32} />
      <div className="grow">
        <div>
          <strong>{comment.user.name}</strong>{' '}
          <span className="muted small">
            {relativeTime(comment.createdAt)}
            {comment.editedAt && ' (bearbeitet)'}
          </span>
        </div>
        {editing ? (
          <div className="stack">
            <NoteEditor value={draft} onChange={setDraft} rows={3} maxLength={10000} alwaysEdit autoFocus />
            <div className="row">
              <button
                type="button"
                className="btn primary"
                disabled={!draft.trim()}
                onClick={async () => {
                  await act(() => api.comments.update(comment.id, draft.trim()));
                  setEditing(false);
                }}
              >
                Speichern
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setDraft(comment.text);
                  setEditing(false);
                }}
              >
                Abbrechen
              </button>
            </div>
          </div>
        ) : (
          <div className="comment-bubble">
            <RichText text={comment.text} />
          </div>
        )}
        {!editing && (own || canDelete) && canWrite && (
          <div className="comment-actions">
            {own && (
              <button type="button" className="link-btn" onClick={() => setEditing(true)}>
                Bearbeiten
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  if (confirm('Kommentar löschen?')) void act(() => api.comments.remove(comment.id));
                }}
              >
                Löschen
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
