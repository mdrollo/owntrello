import { useCallback, useEffect, useState } from 'react';
import { Archive, Eye, Star } from 'lucide-react';
import { BOARD_COLORS, type BoardSummary, type Me } from '@owntrello/shared';
import { api } from '../lib/api';
import { navigate } from '../lib/router';
import { ColorPicker, Popover, usePopover, useRun } from './ui';

export function BoardsPage({ me }: { me: Me }) {
  const [boards, setBoards] = useState<BoardSummary[] | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const run = useRun();
  const pop = usePopover<'create'>();

  const load = useCallback(() => run(async () => setBoards((await api.boards.list()).boards)), [run]);
  useEffect(() => {
    void load();
  }, [load]);

  const toggleStar = (b: BoardSummary) =>
    run(async () => {
      setBoards((all) => all?.map((x) => (x.id === b.id ? { ...x, starred: !b.starred } : x)) ?? null);
      await api.boards.star(b.id, !b.starred);
    });

  if (!boards) return <div className="page-message">Lädt …</div>;

  const active = boards.filter((b) => !b.archived);
  const starred = active.filter((b) => b.starred);
  const archived = boards.filter((b) => b.archived);

  const tile = (b: BoardSummary) => (
    <li key={b.id}>
      <a
        className="board-tile"
        href={`/b/${b.id}`}
        style={{ background: b.color }}
        onClick={(e) => {
          e.preventDefault();
          navigate(`/b/${b.id}`);
        }}
      >
        <span className="board-tile-title">{b.title}</span>
        {!b.permission.canWrite && (
          <span className="board-tile-readonly" title="Nur Lesezugriff">
            <Eye size={14} /> Nur lesen
          </span>
        )}
        <button
          type="button"
          className={`board-tile-star ${b.starred ? 'on' : ''}`}
          aria-label={b.starred ? 'Stern entfernen' : 'Mit Stern markieren'}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void toggleStar(b);
          }}
        >
          <Star size={16} fill={b.starred ? 'currentColor' : 'none'} />
        </button>
      </a>
    </li>
  );

  return (
    <main className="boards-page">
      {starred.length > 0 && (
        <section>
          <h2>
            <Star size={18} /> Mit Stern markiert
          </h2>
          <ul className="board-grid">{starred.map(tile)}</ul>
        </section>
      )}
      <section>
        <h2>Deine Boards</h2>
        <ul className="board-grid">
          {active.map(tile)}
          <li>
            <button type="button" className="board-tile board-tile-new" onClick={pop.toggle('create')}>
              Neues Board erstellen
            </button>
          </li>
        </ul>
        {active.length === 0 && (
          <p className="muted">
            Noch keine Boards. Lege eins an oder lass dich von jemandem zu einem Board einladen
            {me.email ? ` (${me.email})` : ''}.
          </p>
        )}
      </section>
      {archived.length > 0 && (
        <section>
          <button type="button" className="link-btn" onClick={() => setShowArchived((v) => !v)}>
            <Archive size={16} /> Archivierte Boards ({archived.length}) {showArchived ? 'ausblenden' : 'anzeigen'}
          </button>
          {showArchived && <ul className="board-grid archived">{archived.map(tile)}</ul>}
        </section>
      )}
      {pop.open && <CreateBoard anchor={pop.open.anchor} onClose={pop.close} />}
    </main>
  );
}

function CreateBoard({ anchor, onClose }: { anchor: HTMLElement; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [color, setColor] = useState<string>(BOARD_COLORS[0]);
  const [busy, setBusy] = useState(false);
  const run = useRun();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    const created = await run(() => api.boards.create({ title: title.trim(), color }));
    setBusy(false);
    if (created) navigate(`/b/${created.id}`);
  };

  return (
    <Popover anchor={anchor} title="Board erstellen" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="board-preview" style={{ background: color }}>
          <span />
          <span />
          <span />
        </div>
        <label className="field">
          <span>Hintergrund</span>
          <ColorPicker colors={BOARD_COLORS} value={color} onChange={setColor} size={28} />
        </label>
        <label className="field">
          <span>Board-Titel</span>
          <input autoFocus value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <button type="submit" className="btn primary" disabled={!title.trim() || busy}>
          Erstellen
        </button>
      </form>
    </Popover>
  );
}
