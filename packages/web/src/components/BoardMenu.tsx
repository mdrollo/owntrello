import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Activity as ActivityIcon, Archive, ChevronLeft, LogOut, Palette, RotateCcw, Tag, Trash2, UserPlus, X } from 'lucide-react';
import { BOARD_COLORS, type Activity, type ArchiveResponse } from '@owntrello/shared';
import { api } from '../lib/api';
import { describeActivity, relativeTime } from '../lib/format';
import { navigate } from '../lib/router';
import { useBoard } from './BoardPage';
import { LabelManager } from './Labels';
import { Avatar, ColorPicker, useRun } from './ui';

type View = 'main' | 'background' | 'labels' | 'archive' | 'activity';

/** Seitenleiste rechts mit allem rund ums Board */
export function BoardMenu({ onClose, onShare }: { onClose: () => void; onShare: () => void }) {
  const { detail, canWrite, me, reload } = useBoard();
  const run = useRun();
  const [view, setView] = useState<View>('main');
  const perm = detail.permission;
  const isMember = detail.members.some((m) => m.user.id === me.id);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.popover, .modal')) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const titles: Record<View, string> = {
    main: 'Menü',
    background: 'Hintergrund ändern',
    labels: 'Labels',
    archive: 'Archivierte Elemente',
    activity: 'Aktivität',
  };

  return createPortal(
    <>
      <div className="drawer-backdrop" onPointerDown={onClose} />
      <aside className="drawer" aria-label="Board-Menü">
        <header className="drawer-header">
          {view !== 'main' && (
            <button type="button" className="icon-btn" aria-label="Zurück" onClick={() => setView('main')}>
              <ChevronLeft size={18} />
            </button>
          )}
          <h2>{titles[view]}</h2>
          <button type="button" className="icon-btn" aria-label="Schließen" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="drawer-body">
          {view === 'main' && (
            <>
              <div className="menu">
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    onClose();
                    onShare();
                  }}
                >
                  <UserPlus size={16} /> {perm.canManage ? 'Teilen und Rechte' : 'Mitglieder'}
                </button>
                {canWrite && (
                  <button type="button" className="menu-item" onClick={() => setView('background')}>
                    <span className="swatch" style={{ background: detail.board.color }} /> Hintergrund ändern
                  </button>
                )}
                <button type="button" className="menu-item" onClick={() => setView('labels')}>
                  <Tag size={16} /> Labels
                </button>
                <button type="button" className="menu-item" onClick={() => setView('archive')}>
                  <Archive size={16} /> Archivierte Elemente
                </button>
                <button type="button" className="menu-item" onClick={() => setView('activity')}>
                  <ActivityIcon size={16} /> Aktivität
                </button>
              </div>
              <hr />
              <div className="menu">
                {perm.canManage &&
                  (detail.board.archived ? (
                    <button
                      type="button"
                      className="menu-item"
                      onClick={() => void run(() => api.boards.update(detail.board.id, { archived: false })).then(reload)}
                    >
                      <RotateCcw size={16} /> Board wiederherstellen
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="menu-item"
                      onClick={() => {
                        if (confirm('Board archivieren? Es wird schreibgeschützt und in der Übersicht unter „Archiviert“ geführt.')) {
                          void run(() => api.boards.update(detail.board.id, { archived: true })).then(reload);
                        }
                      }}
                    >
                      <Archive size={16} /> Board archivieren
                    </button>
                  ))}
                {perm.canManage && (
                  <button
                    type="button"
                    className="menu-item danger"
                    onClick={async () => {
                      const answer = prompt(
                        `Board endgültig löschen – mit allen Listen, Karten und Anhängen?\nZum Bestätigen den Board-Titel eingeben:`,
                      );
                      if (answer === null) return;
                      if (answer.trim() !== detail.board.title) {
                        alert('Titel stimmt nicht überein – nichts gelöscht.');
                        return;
                      }
                      try {
                        await api.boards.remove(detail.board.id);
                        navigate('/');
                      } catch (err) {
                        alert(err instanceof Error ? err.message : String(err));
                      }
                    }}
                  >
                    <Trash2 size={16} /> Board löschen …
                  </button>
                )}
                {isMember && (
                  <button
                    type="button"
                    className="menu-item"
                    onClick={async () => {
                      if (!confirm('Board verlassen? Du verlierst den Zugriff, bis dich jemand wieder einlädt.')) return;
                      try {
                        await api.boards.removeMember(detail.board.id, me.id);
                        navigate('/');
                      } catch (err) {
                        alert(err instanceof Error ? err.message : String(err));
                      }
                    }}
                  >
                    <LogOut size={16} /> Board verlassen
                  </button>
                )}
              </div>
              <hr />
              <h3 className="drawer-subtitle">
                <ActivityIcon size={16} /> Letzte Aktivität
              </h3>
              <ActivityFeed limit={8} onMore={() => setView('activity')} />
            </>
          )}
          {view === 'background' && (
            <div className="stack">
              <ColorPicker
                colors={BOARD_COLORS}
                value={detail.board.color}
                size={56}
                onChange={(color) => void run(() => api.boards.update(detail.board.id, { color })).then(reload)}
              />
              <p className="muted small">
                <Palette size={13} /> Die Farbe gilt für alle, die das Board sehen.
              </p>
            </div>
          )}
          {view === 'labels' && <LabelManager />}
          {view === 'archive' && <ArchiveView />}
          {view === 'activity' && <ActivityFeed />}
        </div>
      </aside>
    </>,
    document.body,
  );
}

function ActivityFeed({ limit, onMore }: { limit?: number; onMore?: () => void }) {
  const { detail, version } = useBoard();
  const [items, setItems] = useState<Activity[] | null>(null);
  const [done, setDone] = useState(false);
  const run = useRun();

  useEffect(() => {
    void run(async () => {
      const { activity } = await api.boards.activity(detail.board.id);
      setItems(activity);
      setDone(activity.length < 50);
    });
  }, [detail.board.id, version, run]);

  const more = async () => {
    const last = items?.[items.length - 1];
    if (!last) return;
    await run(async () => {
      const { activity } = await api.boards.activity(detail.board.id, last.id);
      setItems((cur) => [...(cur ?? []), ...activity]);
      setDone(activity.length < 50);
    });
  };

  if (!items) return <p className="muted">Lädt …</p>;
  const shown = limit ? items.slice(0, limit) : items;
  return (
    <>
      <ul className="activity-list">
        {shown.map((a) => (
          <li key={a.id} className="activity-item">
            <Avatar user={a.user} size={28} />
            <div>
              <strong>{a.user.name}</strong>{' '}
              {a.cardId ? (
                <a
                  href={`/b/${detail.board.id}/c/${a.cardId}`}
                  onClick={(e) => {
                    e.preventDefault();
                    navigate(`/b/${detail.board.id}/c/${a.cardId}`);
                  }}
                >
                  {describeActivity(a)}
                </a>
              ) : (
                describeActivity(a)
              )}
              <div className="muted small">{relativeTime(a.createdAt)}</div>
            </div>
          </li>
        ))}
      </ul>
      {items.length === 0 && <p className="muted">Noch keine Aktivität.</p>}
      {limit && items.length > limit && onMore && (
        <button type="button" className="btn" onClick={onMore}>
          Alle Aktivitäten anzeigen
        </button>
      )}
      {!limit && !done && (
        <button type="button" className="btn" onClick={() => void more()}>
          Mehr laden
        </button>
      )}
    </>
  );
}

function ArchiveView() {
  const { detail, canWrite, version, reload } = useBoard();
  const [data, setData] = useState<ArchiveResponse | null>(null);
  const [tab, setTab] = useState<'cards' | 'lists'>('cards');
  const run = useRun();

  const load = useCallback(() => run(async () => setData(await api.boards.archive(detail.board.id))), [detail.board.id, run]);
  useEffect(() => {
    void load();
  }, [load, version]);

  if (!data) return <p className="muted">Lädt …</p>;
  return (
    <div className="stack">
      <div className="seg">
        <button type="button" className={tab === 'cards' ? 'on' : ''} onClick={() => setTab('cards')}>
          Karten ({data.cards.length})
        </button>
        <button type="button" className={tab === 'lists' ? 'on' : ''} onClick={() => setTab('lists')}>
          Listen ({data.lists.length})
        </button>
      </div>
      {tab === 'cards' && (
        <ul className="archive-list">
          {data.cards.length === 0 && <li className="muted">Keine archivierten Karten.</li>}
          {data.cards.map((c) => (
            <li key={c.id}>
              <a
                href={`/b/${detail.board.id}/c/${c.id}`}
                className="archive-card"
                onClick={(e) => {
                  e.preventDefault();
                  navigate(`/b/${detail.board.id}/c/${c.id}`);
                }}
              >
                {c.title}
                <span className="muted small">in {c.listTitle}</span>
              </a>
              {canWrite && (
                <div className="row">
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => void run(() => api.cards.update(c.id, { archived: false })).then(reload)}
                  >
                    Wiederherstellen
                  </button>
                  <button
                    type="button"
                    className="link-btn danger"
                    onClick={() => {
                      if (confirm(`Karte „${c.title}“ endgültig löschen?`)) void run(() => api.cards.remove(c.id)).then(reload);
                    }}
                  >
                    Löschen
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {tab === 'lists' && (
        <ul className="archive-list">
          {data.lists.length === 0 && <li className="muted">Keine archivierten Listen.</li>}
          {data.lists.map((l) => (
            <li key={l.id}>
              <span className="archive-card">{l.title}</span>
              {canWrite && (
                <div className="row">
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => void run(() => api.lists.update(l.id, { archived: false })).then(reload)}
                  >
                    Wiederherstellen
                  </button>
                  <button
                    type="button"
                    className="link-btn danger"
                    onClick={() => {
                      if (confirm(`Liste „${l.title}“ mit allen Karten endgültig löschen?`)) {
                        void run(() => api.lists.remove(l.id)).then(reload);
                      }
                    }}
                  >
                    Löschen
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
