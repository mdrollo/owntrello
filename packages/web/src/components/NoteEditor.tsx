import { useLayoutEffect, useRef, useState } from 'react';
import { RichText } from '../lib/richText';

/**
 * Notizfeld mit kleiner Formatierungsleiste. Außerhalb der Bearbeitung wird die
 * Notiz formatiert angezeigt – Links sind dann anklickbar. Antippen (neben einem
 * Link) wechselt in die Bearbeitung.
 */

interface Props {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
  /** immer im Bearbeitungsmodus (Speichern/Abbrechen regelt der Aufrufer) */
  alwaysEdit?: boolean;
  autoFocus?: boolean;
}

export function NoteEditor({ value, onChange, rows = 3, maxLength = 4000, placeholder, alwaysEdit, autoFocus }: Props) {
  const [editingState, setEditing] = useState(!value.trim());
  const editing = alwaysEdit || editingState;
  const ref = useRef<HTMLTextAreaElement>(null);
  // Gewünschte Markierung nach einer Änderung über die Leiste; wird direkt nach dem
  // Aktualisieren des Felds gesetzt (sonst landet schnelles Weitertippen an falscher Stelle)
  const pendingSelection = useRef<[number, number] | null>(null);
  useLayoutEffect(() => {
    const ta = ref.current;
    const sel = pendingSelection.current;
    if (!ta || !sel) return;
    pendingSelection.current = null;
    ta.focus();
    ta.setSelectionRange(sel[0], sel[1]);
  }, [value]);

  /** Text an der Auswahl ersetzen und danach [from, to] (relativ zum Einfügebeginn) markieren */
  const replaceSelection = (make: (selected: string) => { text: string; select: [number, number] }) => {
    const ta = ref.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e } = ta;
    const { text, select } = make(value.slice(s, e));
    pendingSelection.current = [s + select[0], s + select[1]];
    onChange(value.slice(0, s) + text + value.slice(e));
  };

  /** Auswahl mit Markierung umschließen (ohne Auswahl Platzhalter einsetzen und markieren) */
  const wrap = (mark: string, placeholderText: string) =>
    replaceSelection((sel) => {
      const inner = sel || placeholderText;
      return { text: mark + inner + mark, select: [mark.length, mark.length + inner.length] };
    });

  const list = () => {
    const ta = ref.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e } = ta;
    const lineStart = value.lastIndexOf('\n', s - 1) + 1;
    const bulleted = value
      .slice(lineStart, e)
      .split('\n')
      .map((l) => (l.startsWith('- ') ? l : `- ${l}`))
      .join('\n');
    pendingSelection.current = [lineStart + bulleted.length, lineStart + bulleted.length];
    onChange(value.slice(0, lineStart) + bulleted + value.slice(e));
  };

  /** Link: markierte Adresse bekommt einen Text, markierter Text bekommt eine Adresse */
  const link = () =>
    replaceSelection((sel) => {
      if (/^(https?:\/\/|www\.)\S+$/.test(sel)) {
        return { text: `[Linktext](${sel})`, select: [1, 9] };
      }
      const label = sel || 'Linktext';
      const text = `[${label}](https://)`;
      // Cursor hinter „https://“, damit man direkt die Adresse tippt oder einfügt
      return { text, select: [text.length - 1, text.length - 1] };
    });

  if (!editing && value.trim()) {
    return (
      <div
        className="note-view"
        role="button"
        tabIndex={0}
        title="Zum Bearbeiten antippen"
        onClick={() => {
          setEditing(true);
          requestAnimationFrame(() => ref.current?.focus());
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            setEditing(true);
          }
        }}
      >
        <RichText text={value} />
      </div>
    );
  }

  return (
    <div className="note-editor">
      <div className="note-toolbar" role="toolbar" aria-label="Formatierung">
        <button type="button" title="Fett (**Text**)" onMouseDown={(e) => e.preventDefault()} onClick={() => wrap('**', 'fett')}>
          <b>B</b>
        </button>
        <button type="button" title="Kursiv (*Text*)" onMouseDown={(e) => e.preventDefault()} onClick={() => wrap('*', 'kursiv')}>
          <i>I</i>
        </button>
        <button type="button" title="Aufzählung (- Text)" onMouseDown={(e) => e.preventDefault()} onClick={list}>
          • Liste
        </button>
        <button type="button" title="Link ([Text](https://…)); Adressen werden auch so erkannt" onMouseDown={(e) => e.preventDefault()} onClick={link}>
          🔗 Link
        </button>
        <span className="note-hint">Links wie https://… werden automatisch klickbar</span>
      </div>
      <textarea
        ref={ref}
        value={value}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => !alwaysEdit && value.trim() && setEditing(false)}
      />
    </div>
  );
}
