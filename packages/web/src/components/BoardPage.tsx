import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  closestCenter,
  DndContext,
  DragOverlay,
  getFirstCollision,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  pointerWithin,
  rectIntersection,
  TouchSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  AlignLeft,
  CheckSquare,
  Clock,
  Eye,
  Filter,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Plus,
  Star,
  UserPlus,
  X,
} from 'lucide-react';
import type { BoardDetail, BoardMember, CardSummary, Label, List, Me } from '@owntrello/shared';
import { api, ApiError } from '../lib/api';
import { dueState, shortDate } from '../lib/format';
import { navigate } from '../lib/router';
import { useBoardEvents } from '../lib/useBoardEvents';
import { BoardMenu } from './BoardMenu';
import { CardDialog } from './CardDialog';
import { ShareDialog } from './ShareDialog';
import { Avatar, InlineEdit, Popover, usePopover, useNotify, useRun } from './ui';

// ------------------------------------------------------------------ Kontext

export interface BoardCtx {
  detail: BoardDetail;
  me: Me;
  canWrite: boolean;
  /** Board neu laden (nach eigenen Änderungen; fremde kommen über den Live-Kanal) */
  reload: () => Promise<void>;
  /** Zähler, der bei jeder Änderung am Board steigt (Kartendialog lädt dann neu) */
  version: number;
  labelsById: Map<number, Label>;
  membersById: Map<string, BoardMember>;
  listsById: Map<number, List>;
}

const BoardContext = createContext<BoardCtx | null>(null);

export function useBoard(): BoardCtx {
  const ctx = useContext(BoardContext);
  if (!ctx) throw new Error('useBoard außerhalb von BoardPage');
  return ctx;
}

// ----------------------------------------------------------- Drag & Drop-IDs

const listKey = (id: number) => `list-${id}`;
const cardKey = (id: number) => `card-${id}`;
const isListKey = (k: UniqueIdentifier) => String(k).startsWith('list-');
const idOf = (k: UniqueIdentifier) => Number(String(k).split('-')[1]);

type Columns = Record<string, string[]>;

function columnsFrom(detail: BoardDetail): Columns {
  const cols: Columns = {};
  for (const l of detail.lists) cols[listKey(l.id)] = [];
  const cards = [...detail.cards].sort((a, b) => a.pos - b.pos || a.id - b.id);
  for (const c of cards) cols[listKey(c.listId)]?.push(cardKey(c.id));
  return cols;
}

// ------------------------------------------------------------------- Filter

interface CardFilter {
  text: string;
  labelIds: number[];
  memberIds: string[];
  due: 'all' | 'overdue' | 'soon' | 'none' | 'done';
}

const EMPTY_FILTER: CardFilter = { text: '', labelIds: [], memberIds: [], due: 'all' };
const filterActive = (f: CardFilter) => f.text.trim() !== '' || f.labelIds.length > 0 || f.memberIds.length > 0 || f.due !== 'all';

function matches(card: CardSummary, f: CardFilter): boolean {
  if (f.text.trim() && !card.title.toLowerCase().includes(f.text.trim().toLowerCase())) return false;
  if (f.labelIds.length && !f.labelIds.some((id) => card.labelIds.includes(id))) return false;
  if (f.memberIds.length && !f.memberIds.some((id) => card.memberIds.includes(id))) return false;
  if (f.due !== 'all') {
    if (f.due === 'none') return !card.due;
    if (!card.due) return false;
    const s = dueState(card.due, card.dueDone);
    if (f.due === 'overdue' && s !== 'overdue') return false;
    if (f.due === 'soon' && s !== 'soon') return false;
    if (f.due === 'done' && s !== 'done') return false;
  }
  return true;
}

// ------------------------------------------------------------------ Seite

export function BoardPage({ boardId, cardId, me }: { boardId: number; cardId: number | null; me: Me }) {
  const [detail, setDetail] = useState<BoardDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const notify = useNotify();
  const dragging = useRef(false);
  const pendingReload = useRef(false);
  const reloadTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const reload = useCallback(async () => {
    if (dragging.current) {
      pendingReload.current = true;
      return;
    }
    try {
      const d = await api.boards.get(boardId);
      setDetail(d);
      setVersion((v) => v + 1);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setError('Board nicht gefunden – oder du hast keinen Zugriff.');
      else setError(err instanceof Error ? err.message : String(err));
    }
  }, [boardId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useBoardEvents(boardId, (event) => {
    if (event.type === 'deleted') {
      notify('Das Board wurde gelöscht oder dein Zugriff entzogen.');
      navigate('/');
      return;
    }
    clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => void reload(), 200);
  });

  const ctx = useMemo<BoardCtx | null>(
    () =>
      detail && {
        detail,
        me,
        canWrite: detail.permission.canWrite && !detail.board.archived,
        reload,
        version,
        labelsById: new Map(detail.labels.map((l) => [l.id, l])),
        membersById: new Map(detail.members.map((m) => [m.user.id, m])),
        listsById: new Map(detail.lists.map((l) => [l.id, l])),
      },
    [detail, me, reload, version],
  );

  useEffect(() => {
    if (detail) document.title = `${detail.board.title} · owntrello`;
    return () => {
      document.title = 'owntrello';
    };
  }, [detail]);

  if (error) {
    return (
      <div className="page-message">
        <p>{error}</p>
        <button type="button" className="btn" onClick={() => navigate('/')}>
          Zur Übersicht
        </button>
      </div>
    );
  }
  if (!ctx) return <div className="page-message">Lädt …</div>;

  return (
    <BoardContext.Provider value={ctx}>
      <BoardView
        onDragging={(d) => {
          dragging.current = d;
          if (!d && pendingReload.current) {
            pendingReload.current = false;
            void reload();
          }
        }}
      />
      {cardId && <CardDialog key={cardId} cardId={cardId} onClose={() => navigate(`/b/${boardId}`)} />}
    </BoardContext.Provider>
  );
}

function BoardView({ onDragging }: { onDragging: (dragging: boolean) => void }) {
  const { detail, canWrite, reload } = useBoard();
  const run = useRun();
  const [filter, setFilter] = useState<CardFilter>(EMPTY_FILTER);
  const filtering = filterActive(filter);

  // Reihenfolge während des Ziehens lokal halten, sonst aus den Daten
  const [columns, setColumns] = useState<Columns>(() => columnsFrom(detail));
  const [listOrder, setListOrder] = useState<string[]>(() => detail.lists.map((l) => listKey(l.id)));
  const [active, setActive] = useState<UniqueIdentifier | null>(null);
  const origin = useRef<{ list: string; index: number } | null>(null);
  const lastOver = useRef<UniqueIdentifier | null>(null);

  useEffect(() => {
    if (active) return;
    setColumns(columnsFrom(detail));
    setListOrder(detail.lists.map((l) => listKey(l.id)));
  }, [detail, active]);

  const cardsById = useMemo(() => new Map(detail.cards.map((c) => [c.id, c])), [detail.cards]);
  const listsById = useMemo(() => new Map(detail.lists.map((l) => [l.id, l])), [detail.lists]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    // Auf Touch-Geräten erst nach kurzem Halten ziehen, damit Wischen weiter scrollt
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const containerOf = (key: UniqueIdentifier): string | undefined => {
    if (isListKey(key)) return String(key);
    return Object.keys(columns).find((l) => columns[l]!.includes(String(key)));
  };

  /** Karten: erst Zeiger, dann Überschneidung; über einer Liste die nächste Karte darin */
  const collision: CollisionDetection = useCallback(
    (args) => {
      if (active && isListKey(active)) {
        return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => isListKey(c.id)) });
      }
      const pointer = pointerWithin(args);
      const hits = pointer.length > 0 ? pointer : rectIntersection(args);
      let overId = getFirstCollision(hits, 'id');
      if (overId != null) {
        if (isListKey(overId)) {
          const items = columns[String(overId)] ?? [];
          if (items.length > 0) {
            overId =
              closestCenter({
                ...args,
                droppableContainers: args.droppableContainers.filter((c) => items.includes(String(c.id))),
              })[0]?.id ?? overId;
          }
        }
        lastOver.current = overId;
        return [{ id: overId }];
      }
      return lastOver.current ? [{ id: lastOver.current }] : [];
    },
    [active, columns],
  );

  const onDragStart = ({ active: a }: DragStartEvent) => {
    setActive(a.id);
    onDragging(true);
    const list = containerOf(a.id);
    origin.current = list ? { list, index: columns[list]!.indexOf(String(a.id)) } : null;
  };

  const onDragOver = ({ active: a, over }: DragOverEvent) => {
    if (!over || isListKey(a.id)) return;
    const from = containerOf(a.id);
    const to = containerOf(over.id);
    if (!from || !to || from === to) return;
    setColumns((cols) => {
      const fromItems = cols[from]!;
      const toItems = cols[to]!;
      const overIndex = toItems.indexOf(String(over.id));
      let index: number;
      if (isListKey(over.id)) index = toItems.length;
      else {
        const below =
          a.rect.current.translated && a.rect.current.translated.top > over.rect.top + over.rect.height / 2;
        index = overIndex >= 0 ? overIndex + (below ? 1 : 0) : toItems.length;
      }
      return {
        ...cols,
        [from]: fromItems.filter((k) => k !== String(a.id)),
        [to]: [...toItems.slice(0, index), String(a.id), ...toItems.slice(index)],
      };
    });
  };

  const finish = () => {
    setActive(null);
    lastOver.current = null;
    onDragging(false);
  };

  const onDragEnd = ({ active: a, over }: DragEndEvent) => {
    const start = origin.current;
    origin.current = null;

    if (isListKey(a.id)) {
      if (over && a.id !== over.id) {
        const oldIndex = listOrder.indexOf(String(a.id));
        const newIndex = listOrder.indexOf(String(over.id));
        if (newIndex >= 0) {
          setListOrder(arrayMove(listOrder, oldIndex, newIndex));
          finish();
          void run(() => api.lists.move(idOf(a.id), newIndex)).then(reload);
          return;
        }
      }
      finish();
      return;
    }

    const list = containerOf(a.id);
    if (!list || !over) {
      finish();
      return;
    }
    let items = columns[list]!;
    const overIndex = items.indexOf(String(over.id));
    const activeIndex = items.indexOf(String(a.id));
    if (overIndex >= 0 && overIndex !== activeIndex) {
      items = arrayMove(items, activeIndex, overIndex);
      setColumns((cols) => ({ ...cols, [list]: items }));
    }
    const index = items.indexOf(String(a.id));
    finish();
    if (start && start.list === list && start.index === index) return;
    void run(() => api.cards.move(idOf(a.id), idOf(list), index)).then(reload);
  };

  const onDragCancel = () => {
    origin.current = null;
    setColumns(columnsFrom(detail));
    setListOrder(detail.lists.map((l) => listKey(l.id)));
    finish();
  };

  // Board-Farbe auch hinter der App-Kopfzeile
  useEffect(() => {
    document.documentElement.style.setProperty('--board-color', detail.board.color);
    return () => {
      document.documentElement.style.removeProperty('--board-color');
    };
  }, [detail.board.color]);

  const activeCard = active && !isListKey(active) ? cardsById.get(idOf(active)) : undefined;
  const activeList = active && isListKey(active) ? listsById.get(idOf(active)) : undefined;
  const dragDisabled = !canWrite || filtering;

  return (
    <main className="board">
      <BoardHeader filter={filter} setFilter={setFilter} />
      {detail.board.archived && (
        <div className="board-banner">
          Dieses Board ist archiviert und schreibgeschützt. Verwalter können es im Board-Menü wiederherstellen.
        </div>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <div className="board-canvas">
          <SortableContext items={listOrder} strategy={horizontalListSortingStrategy}>
            {listOrder.map((key) => {
              const list = listsById.get(idOf(key));
              if (!list) return null;
              const cards = (columns[key] ?? [])
                .map((k) => cardsById.get(idOf(k)))
                .filter((c): c is CardSummary => !!c);
              return (
                <ListColumn
                  key={key}
                  list={list}
                  cards={filtering ? cards.filter((c) => matches(c, filter)) : cards}
                  cardKeys={columns[key] ?? []}
                  dragDisabled={dragDisabled}
                />
              );
            })}
          </SortableContext>
          {canWrite && <AddList />}
        </div>
        <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
          {activeCard ? (
            <div className="card-tile dragging">
              <CardContent card={activeCard} />
            </div>
          ) : activeList ? (
            <div className="list dragging">
              <div className="list-header">
                <span className="list-title">{activeList.title}</span>
              </div>
              <div className="list-cards">
                {(columns[listKey(activeList.id)] ?? []).map((k) => {
                  const c = cardsById.get(idOf(k));
                  return c ? (
                    <div key={k} className="card-tile">
                      <CardContent card={c} />
                    </div>
                  ) : null;
                })}
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </main>
  );
}

// ------------------------------------------------------------- Kopfzeile

function BoardHeader({ filter, setFilter }: { filter: CardFilter; setFilter: (f: CardFilter) => void }) {
  const { detail, canWrite, reload } = useBoard();
  const run = useRun();
  const pop = usePopover<'filter'>();
  const [menu, setMenu] = useState(false);
  const [share, setShare] = useState(false);
  const [starred, setStarred] = useState(detail.starred);
  useEffect(() => setStarred(detail.starred), [detail.starred]);
  const active = filterActive(filter);
  const shown = detail.members.slice(0, 5);

  return (
    <div className="board-header">
      <InlineEdit
        className="board-title"
        value={detail.board.title}
        disabled={!canWrite}
        ariaLabel="Board-Titel"
        onSave={(title) => void run(() => api.boards.update(detail.board.id, { title })).then(reload)}
      />
      <button
        type="button"
        className={`board-btn icon ${starred ? 'starred' : ''}`}
        aria-label={starred ? 'Stern entfernen' : 'Mit Stern markieren'}
        onClick={() => {
          setStarred(!starred);
          void run(() => api.boards.star(detail.board.id, !starred));
        }}
      >
        <Star size={16} fill={starred ? 'currentColor' : 'none'} />
      </button>
      {!detail.permission.canWrite && (
        <span className="board-chip" title="Du kannst dieses Board nur ansehen">
          <Eye size={14} /> Nur lesen
        </span>
      )}
      <div className="header-spacer" />
      <button type="button" className={`board-btn ${active ? 'active' : ''}`} onClick={pop.toggle('filter')}>
        <Filter size={16} /> Filter
        {active && (
          <span
            role="button"
            tabIndex={0}
            className="filter-clear"
            aria-label="Filter zurücksetzen"
            onClick={(e) => {
              e.stopPropagation();
              setFilter(EMPTY_FILTER);
            }}
          >
            <X size={14} />
          </span>
        )}
      </button>
      <div className="member-stack" aria-label="Mitglieder">
        {shown.map((m) => (
          <Avatar key={m.user.id} user={m.user} size={28} />
        ))}
        {detail.members.length > shown.length && (
          <span className="avatar more">+{detail.members.length - shown.length}</span>
        )}
      </div>
      <button type="button" className="board-btn share" onClick={() => setShare(true)}>
        <UserPlus size={16} /> {detail.permission.canManage ? 'Teilen' : 'Mitglieder'}
      </button>
      <button type="button" className="board-btn icon" aria-label="Board-Menü" onClick={() => setMenu(true)}>
        <MoreHorizontal size={18} />
      </button>
      {pop.open && (
        <Popover anchor={pop.open.anchor} title="Karten filtern" onClose={pop.close}>
          <FilterForm filter={filter} setFilter={setFilter} />
        </Popover>
      )}
      {menu && <BoardMenu onClose={() => setMenu(false)} onShare={() => setShare(true)} />}
      {share && <ShareDialog onClose={() => setShare(false)} />}
    </div>
  );
}

function FilterForm({ filter, setFilter }: { filter: CardFilter; setFilter: (f: CardFilter) => void }) {
  const { detail } = useBoard();
  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  return (
    <div className="stack">
      <label className="field">
        <span>Stichwort</span>
        <input
          autoFocus
          value={filter.text}
          placeholder="Kartentitel enthält …"
          onChange={(e) => setFilter({ ...filter, text: e.target.value })}
        />
      </label>
      <fieldset className="field">
        <legend>Mitglieder</legend>
        {detail.members.map((m) => (
          <label key={m.user.id} className="check-row">
            <input
              type="checkbox"
              checked={filter.memberIds.includes(m.user.id)}
              onChange={() => setFilter({ ...filter, memberIds: toggle(filter.memberIds, m.user.id) })}
            />
            <Avatar user={m.user} size={22} /> {m.user.name}
          </label>
        ))}
      </fieldset>
      <fieldset className="field">
        <legend>Fälligkeit</legend>
        <select value={filter.due} onChange={(e) => setFilter({ ...filter, due: e.target.value as CardFilter['due'] })}>
          <option value="all">Alle Karten</option>
          <option value="overdue">Überfällig</option>
          <option value="soon">Fällig in den nächsten 24 Stunden</option>
          <option value="done">Erledigt</option>
          <option value="none">Ohne Fälligkeitsdatum</option>
        </select>
      </fieldset>
      <fieldset className="field">
        <legend>Labels</legend>
        {detail.labels.map((l) => (
          <label key={l.id} className="check-row">
            <input
              type="checkbox"
              checked={filter.labelIds.includes(l.id)}
              onChange={() => setFilter({ ...filter, labelIds: toggle(filter.labelIds, l.id) })}
            />
            <span className="label-pill wide" style={{ background: l.color }}>
              {l.name}
            </span>
          </label>
        ))}
      </fieldset>
      {filterActive(filter) && <p className="muted small">Während ein Filter aktiv ist, lassen sich Karten nicht verschieben.</p>}
      <button type="button" className="btn" onClick={() => setFilter(EMPTY_FILTER)}>
        Filter zurücksetzen
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ Liste

function ListColumn({
  list,
  cards,
  cardKeys,
  dragDisabled,
}: {
  list: List;
  cards: CardSummary[];
  cardKeys: string[];
  dragDisabled: boolean;
}) {
  const { canWrite, reload } = useBoard();
  const run = useRun();
  const pop = usePopover<'menu'>();
  const [composer, setComposer] = useState(false);
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: listKey(list.id),
    data: { type: 'list' },
    disabled: dragDisabled,
  });

  return (
    <section
      ref={setNodeRef}
      className={`list ${isDragging ? 'placeholder' : ''}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      aria-label={`Liste ${list.title}`}
    >
      <div className="list-header" {...attributes} {...listeners}>
        <InlineEdit
          className="list-title"
          value={list.title}
          disabled={!canWrite}
          ariaLabel="Listentitel"
          onSave={(title) => void run(() => api.lists.update(list.id, { title })).then(reload)}
        />
        {canWrite && (
          <button
            type="button"
            className="icon-btn list-menu-btn"
            aria-label="Listenmenü"
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onClick={pop.toggle('menu')}
          >
            <MoreHorizontal size={16} />
          </button>
        )}
      </div>
      <SortableContext items={cardKeys} strategy={verticalListSortingStrategy}>
        <div className="list-cards">
          {cards.map((card) => (
            <SortableCard key={card.id} card={card} disabled={dragDisabled} />
          ))}
        </div>
      </SortableContext>
      {canWrite &&
        (composer ? (
          <CardComposer listId={list.id} onClose={() => setComposer(false)} />
        ) : (
          <button type="button" className="add-card-btn" onClick={() => setComposer(true)}>
            <Plus size={16} /> Karte hinzufügen
          </button>
        ))}
      {pop.open && (
        <Popover anchor={pop.open.anchor} title="Liste" onClose={pop.close} width={260}>
          <div className="menu">
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                pop.close();
                setComposer(true);
              }}
            >
              Karte hinzufügen
            </button>
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                pop.close();
                void run(() => api.lists.update(list.id, { archived: true })).then(reload);
              }}
            >
              Liste archivieren
            </button>
            <button
              type="button"
              className="menu-item danger"
              onClick={() => {
                pop.close();
                if (confirm(`Liste „${list.title}“ mit allen Karten endgültig löschen?`)) {
                  void run(() => api.lists.remove(list.id)).then(reload);
                }
              }}
            >
              Liste löschen …
            </button>
          </div>
        </Popover>
      )}
    </section>
  );
}

function CardComposer({ listId, onClose }: { listId: number; onClose: () => void }) {
  const { reload } = useBoard();
  const run = useRun();
  const [title, setTitle] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.scrollIntoView({ block: 'nearest' });
  }, []);

  const submit = async () => {
    const t = title.trim();
    if (!t) return;
    setTitle('');
    await run(() => api.lists.createCard(listId, t));
    await reload();
    ref.current?.scrollIntoView({ block: 'nearest' });
  };

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <textarea
        ref={ref}
        className="card-tile composer-input"
        value={title}
        placeholder="Titel eingeben oder Link einfügen …"
        maxLength={500}
        rows={2}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void submit();
          } else if (e.key === 'Escape') onClose();
        }}
        onBlur={(e) => {
          // Klick auf „Karte hinzufügen“ nicht als Verlassen werten
          if (!e.currentTarget.form?.contains(e.relatedTarget as Node) && !title.trim()) onClose();
        }}
      />
      <div className="composer-actions">
        <button type="submit" className="btn primary">
          Karte hinzufügen
        </button>
        <button type="button" className="icon-btn" aria-label="Abbrechen" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
    </form>
  );
}

function AddList() {
  const { detail, reload } = useBoard();
  const run = useRun();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');

  if (!open) {
    return (
      <button type="button" className="add-list-btn" onClick={() => setOpen(true)}>
        <Plus size={16} /> {detail.lists.length ? 'Weitere Liste hinzufügen' : 'Liste hinzufügen'}
      </button>
    );
  }
  return (
    <form
      className="list add-list-form"
      onSubmit={(e) => {
        e.preventDefault();
        const t = title.trim();
        if (!t) return;
        setTitle('');
        void run(() => api.boards.createList(detail.board.id, t)).then(reload);
      }}
    >
      <input
        autoFocus
        value={title}
        placeholder="Listentitel eingeben …"
        maxLength={500}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
      />
      <div className="composer-actions">
        <button type="submit" className="btn primary">
          Liste hinzufügen
        </button>
        <button type="button" className="icon-btn" aria-label="Abbrechen" onClick={() => setOpen(false)}>
          <X size={18} />
        </button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ Karte

const SortableCard = memo(function SortableCard({ card, disabled }: { card: CardSummary; disabled: boolean }) {
  const { detail } = useBoard();
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: cardKey(card.id),
    data: { type: 'card' },
    disabled,
  });
  const open = () => navigate(`/b/${detail.board.id}/c/${card.id}`);
  return (
    <div
      ref={setNodeRef}
      className={`card-tile ${isDragging ? 'placeholder' : ''}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      // Ohne Schreibrecht ist nur das Ziehen gesperrt – öffnen geht weiterhin
      aria-disabled={undefined}
      role="button"
      aria-roledescription="Karte"
      aria-label={card.title}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter') open();
        else listeners?.onKeyDown?.(e);
      }}
    >
      <CardContent card={card} />
    </div>
  );
});

export function CardContent({ card }: { card: CardSummary }) {
  const { labelsById, membersById } = useBoard();
  const labels = card.labelIds.map((id) => labelsById.get(id)).filter((l): l is Label => !!l);
  const members = card.memberIds.map((id) => membersById.get(id)?.user).filter((u) => !!u);
  const b = card.badges;
  const due = card.due ? dueState(card.due, card.dueDone) : null;

  return (
    <>
      {card.coverAttachmentId && (
        <img className="card-cover" src={api.attachments.url(card.coverAttachmentId)} alt="" loading="lazy" draggable={false} />
      )}
      <div className="card-body">
        {labels.length > 0 && (
          <div className="card-labels">
            {labels.map((l) => (
              <span key={l.id} className={`label-pill ${l.name ? '' : 'bare'}`} style={{ background: l.color }} title={l.name}>
                {l.name}
              </span>
            ))}
          </div>
        )}
        <div className="card-title">{card.title}</div>
        {(due || card.hasDescription || b.comments || b.attachments || b.checkItems || members.length > 0) && (
          <div className="card-footer">
            <div className="badges">
              {due && card.due && (
                <span className={`badge due-${due}`} title="Fälligkeit">
                  <Clock size={13} /> {shortDate(card.due)}
                </span>
              )}
              {card.hasDescription && (
                <span className="badge" title="Diese Karte hat eine Beschreibung">
                  <AlignLeft size={13} />
                </span>
              )}
              {b.comments > 0 && (
                <span className="badge" title="Kommentare">
                  <MessageSquare size={13} /> {b.comments}
                </span>
              )}
              {b.attachments > 0 && (
                <span className="badge" title="Anhänge">
                  <Paperclip size={13} /> {b.attachments}
                </span>
              )}
              {b.checkItems > 0 && (
                <span className={`badge ${b.checkItemsDone === b.checkItems ? 'complete' : ''}`} title="Checklisten">
                  <CheckSquare size={13} /> {b.checkItemsDone}/{b.checkItems}
                </span>
              )}
            </div>
            {members.length > 0 && (
              <div className="card-members">
                {members.map((u) => (
                  <Avatar key={u!.id} user={u!} size={24} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
