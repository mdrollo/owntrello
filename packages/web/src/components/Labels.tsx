import { useState } from 'react';
import { Check, Pencil } from 'lucide-react';
import { LABEL_COLORS, type Label } from '@owntrello/shared';
import { api } from '../lib/api';
import { useBoard } from './BoardPage';
import { ColorPicker, useRun } from './ui';

/**
 * Labels des Boards: ankreuzen (für eine Karte, wenn selected/onToggle gesetzt),
 * umbenennen, umfärben, löschen, neu anlegen.
 */
export function LabelManager({
  selected,
  onToggle,
}: {
  selected?: number[];
  onToggle?: (label: Label, on: boolean) => void;
}) {
  const { detail, canWrite, reload } = useBoard();
  const run = useRun();
  const [editing, setEditing] = useState<Label | 'new' | null>(null);
  const [search, setSearch] = useState('');

  if (editing) {
    return (
      <LabelForm
        label={editing === 'new' ? null : editing}
        onDone={() => setEditing(null)}
        onSave={async (input) => {
          if (editing === 'new') await run(() => api.boards.createLabel(detail.board.id, input));
          else await run(() => api.labels.update(editing.id, input));
          await reload();
          setEditing(null);
        }}
        onDelete={
          editing === 'new'
            ? undefined
            : async () => {
                if (!confirm('Label löschen? Es wird von allen Karten entfernt.')) return;
                await run(() => api.labels.remove(editing.id));
                await reload();
                setEditing(null);
              }
        }
      />
    );
  }

  const shown = detail.labels.filter((l) => !search || l.name.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="stack">
      {detail.labels.length > 6 && (
        <input value={search} placeholder="Labels durchsuchen …" onChange={(e) => setSearch(e.target.value)} />
      )}
      <ul className="label-list">
        {shown.map((l) => {
          const on = selected?.includes(l.id) ?? false;
          return (
            <li key={l.id}>
              {onToggle && (
                <input
                  type="checkbox"
                  checked={on}
                  disabled={!canWrite}
                  aria-label={`Label ${l.name || l.color}`}
                  onChange={() => onToggle(l, !on)}
                />
              )}
              <button
                type="button"
                className="label-pill wide"
                style={{ background: l.color }}
                disabled={!canWrite || !onToggle}
                onClick={() => onToggle?.(l, !on)}
              >
                {l.name}
                {on && <Check size={14} className="label-check" />}
              </button>
              {canWrite && (
                <button type="button" className="icon-btn" aria-label="Label bearbeiten" onClick={() => setEditing(l)}>
                  <Pencil size={14} />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {canWrite && (
        <button type="button" className="btn" onClick={() => setEditing('new')}>
          Neues Label erstellen
        </button>
      )}
    </div>
  );
}

function LabelForm({
  label,
  onSave,
  onDelete,
  onDone,
}: {
  label: Label | null;
  onSave: (input: { name: string; color: string }) => Promise<void>;
  onDelete?: () => Promise<void>;
  onDone: () => void;
}) {
  const [name, setName] = useState(label?.name ?? '');
  const [color, setColor] = useState(label?.color ?? LABEL_COLORS[0]);
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave({ name: name.trim(), color });
      }}
    >
      <div className="label-preview">
        <span className="label-pill wide" style={{ background: color }}>
          {name}
        </span>
      </div>
      <label className="field">
        <span>Titel</span>
        <input autoFocus value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="field">
        <span>Farbe</span>
        <ColorPicker colors={LABEL_COLORS} value={color} onChange={setColor} size={28} />
      </div>
      <div className="row">
        <button type="submit" className="btn primary">
          {label ? 'Speichern' : 'Erstellen'}
        </button>
        <button type="button" className="btn" onClick={onDone}>
          Zurück
        </button>
        {onDelete && (
          <button type="button" className="btn danger push-right" onClick={() => void onDelete()}>
            Löschen
          </button>
        )}
      </div>
    </form>
  );
}
