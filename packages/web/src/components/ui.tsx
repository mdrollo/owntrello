import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { User } from '@owntrello/shared';

// ------------------------------------------------------------------ Avatar

const AVATAR_COLORS = ['#0c66e4', '#1f845a', '#c25100', '#ae2e24', '#6e5dc6', '#206a83', '#943d73', '#5e4db2'];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function Avatar({ user, size = 28, title }: { user: User; size?: number; title?: string }) {
  return (
    <span
      className="avatar"
      title={title ?? `${user.name} (${user.email})`}
      style={{ width: size, height: size, fontSize: size * 0.42, background: AVATAR_COLORS[hash(user.id) % AVATAR_COLORS.length] }}
    >
      {initials(user.name)}
    </span>
  );
}

// ----------------------------------------------------------------- Popover

interface PopoverProps {
  anchor: HTMLElement;
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}

/** Kleines Fenster unter einem Knopf (Labels wählen, Datum setzen …) */
export function Popover({ anchor, title, onClose, children, width = 304 }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const w = Math.min(width, window.innerWidth - 16);
      const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
      const h = ref.current?.offsetHeight ?? 0;
      let top = r.bottom + 6;
      if (top + h > window.innerHeight - 8) top = Math.max(8, window.innerHeight - h - 8);
      setPos({ top, left });
    };
    place();
    const ro = new ResizeObserver(place);
    if (ref.current) ro.observe(ref.current);
    window.addEventListener('resize', place);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [anchor, width]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor.contains(t)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={ref}
      className="popover"
      role="dialog"
      aria-label={title}
      style={{ width: Math.min(width, window.innerWidth - 16), top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
    >
      <header className="popover-header">
        <span>{title}</span>
        <button type="button" className="icon-btn" aria-label="Schließen" onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      <div className="popover-body">{children}</div>
    </div>,
    document.body,
  );
}

/** Zustand für „ein Popover offen, an diesem Knopf“ */
export function usePopover<K extends string>() {
  const [open, setOpen] = useState<{ kind: K; anchor: HTMLElement } | null>(null);
  const toggle = useCallback(
    (kind: K) => (e: React.MouseEvent<HTMLElement>) => {
      const anchor = e.currentTarget;
      setOpen((cur) => (cur?.kind === kind ? null : { kind, anchor }));
    },
    [],
  );
  const close = useCallback(() => setOpen(null), []);
  return { open, toggle, close };
}

// ------------------------------------------------------------------- Modal

export function Modal({
  onClose,
  children,
  className,
  label,
}: {
  onClose: () => void;
  children: ReactNode;
  className?: string;
  label: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Offenes Popover schließt zuerst (fängt Escape selbst ab)
      if (e.key === 'Escape' && !document.querySelector('.popover')) onClose();
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  return createPortal(
    <div
      className="modal-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`modal ${className ?? ''}`} role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

// -------------------------------------------------------- Meldungen (Toast)

type Notify = (message: string) => void;
const ToastContext = createContext<Notify>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<{ id: number; text: string }[]>([]);
  const notify = useCallback<Notify>((text) => {
    const id = Date.now() + Math.random();
    setMessages((m) => [...m, { id, text }]);
    setTimeout(() => setMessages((m) => m.filter((x) => x.id !== id)), 6000);
  }, []);
  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {messages.map((m) => (
          <div key={m.id} className="toast">
            {m.text}
            <button
              type="button"
              className="icon-btn"
              aria-label="Schließen"
              onClick={() => setMessages((all) => all.filter((x) => x.id !== m.id))}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useNotify = () => useContext(ToastContext);

/** Fehler einer Aktion als Meldung anzeigen statt still zu scheitern */
export function useRun() {
  const notify = useNotify();
  return useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
      try {
        return await fn();
      } catch (err) {
        notify(err instanceof Error ? err.message : String(err));
        return undefined;
      }
    },
    [notify],
  );
}

// ------------------------------------------------- Inline-Bearbeitung (Titel)

/**
 * Text, der beim Antippen zum Eingabefeld wird (Board-, Listen-, Kartentitel).
 * Enter speichert, Escape bricht ab, Verlassen speichert.
 */
export function InlineEdit({
  value,
  onSave,
  className,
  disabled,
  multiline,
  ariaLabel,
}: {
  value: string;
  onSave: (value: string) => void;
  className?: string;
  disabled?: boolean;
  multiline?: boolean;
  ariaLabel: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useLayoutEffect(() => {
    if (editing) {
      ref.current?.focus();
      ref.current?.select();
    }
  }, [editing]);

  const autosize = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };
  useLayoutEffect(() => {
    if (editing && multiline) autosize(ref.current);
  }, [editing, multiline, draft]);

  const commit = () => {
    setEditing(false);
    const v = draft.trim();
    if (v && v !== value) onSave(v);
    else setDraft(value);
  };

  if (!editing) {
    return (
      <span
        className={`inline-edit ${className ?? ''} ${disabled ? '' : 'editable'}`}
        role={disabled ? undefined : 'button'}
        tabIndex={disabled ? undefined : 0}
        aria-label={disabled ? undefined : `${ariaLabel} bearbeiten`}
        onClick={() => !disabled && setEditing(true)}
        onKeyDown={(e) => {
          if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            setEditing(true);
          }
        }}
      >
        {value}
      </span>
    );
  }

  const props = {
    ref,
    className: `inline-edit-input ${className ?? ''}`,
    value: draft,
    'aria-label': ariaLabel,
    maxLength: 500,
    onChange: (e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        setDraft(value);
        setEditing(false);
      }
    },
    // Ziehen (dnd-kit) nicht aus dem Eingabefeld heraus starten
    onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
    onTouchStart: (e: React.TouchEvent) => e.stopPropagation(),
  };
  return multiline ? <textarea rows={1} {...props} /> : <input {...props} />;
}

/** Farbauswahl als Kacheln */
export function ColorPicker({
  colors,
  value,
  onChange,
  size = 32,
}: {
  colors: readonly string[];
  value: string;
  onChange: (c: string) => void;
  size?: number;
}) {
  return (
    <div className="color-picker" role="radiogroup">
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={c === value}
          aria-label={`Farbe ${c}`}
          className={c === value ? 'selected' : ''}
          style={{ background: c, height: size }}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  );
}
