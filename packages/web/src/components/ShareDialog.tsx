import { useEffect, useState } from 'react';
import { Mail, Trash2, X } from 'lucide-react';
import { normalizePermission, type Permission, type User } from '@owntrello/shared';
import { api } from '../lib/api';
import { useBoard } from './BoardPage';
import { Avatar, Modal, useNotify, useRun } from './ui';

/**
 * Mitglieder und Rechte eines Boards. Pro Person: Lesen, Schreiben (schließt
 * Lesen ein) und Verwalten (Rechte vergeben, archivieren, löschen).
 */
export function ShareDialog({ onClose }: { onClose: () => void }) {
  const { detail, me, reload } = useBoard();
  const run = useRun();
  const notify = useNotify();
  const canManage = detail.permission.canManage;
  const [users, setUsers] = useState<User[]>([]);
  const [email, setEmail] = useState('');
  const [write, setWrite] = useState(true);
  const [manage, setManage] = useState(false);

  useEffect(() => {
    if (canManage) void run(async () => setUsers((await api.users()).users));
  }, [canManage, run]);

  const memberIds = new Set(detail.members.map((m) => m.user.id));
  const suggestions = users.filter((u) => !memberIds.has(u.id));

  const change = async (userId: string, current: Permission, key: keyof Permission, value: boolean) => {
    if (key === 'canRead' && !value) {
      const name = detail.members.find((m) => m.user.id === userId)?.user.name ?? 'diese Person';
      if (!confirm(`${userId === me.id ? 'Dich selbst' : name} vom Board entfernen?`)) return;
      await run(() => api.boards.removeMember(detail.board.id, userId));
    } else {
      const next = { ...current, [key]: value };
      // Schreiben/Verwalten abwählen nimmt die höheren Rechte mit
      if (key === 'canWrite' && !value) next.canManage = false;
      await run(() => api.boards.setMember(detail.board.id, userId, normalizePermission(next)));
    }
    await reload();
  };

  const changeInvite = async (inviteEmail: string, current: Permission, key: keyof Permission, value: boolean) => {
    if (key === 'canRead' && !value) {
      await run(() => api.boards.removeInvite(detail.board.id, inviteEmail));
    } else {
      const next = { ...current, [key]: value };
      if (key === 'canWrite' && !value) next.canManage = false;
      await run(() => api.boards.addMember(detail.board.id, inviteEmail, normalizePermission(next)));
    }
    await reload();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const address = email.trim();
    if (!address) return;
    const res = await run(() =>
      api.boards.addMember(detail.board.id, address, normalizePermission({ canRead: true, canWrite: write, canManage: manage })),
    );
    if (res) {
      notify(
        res.result === 'invite'
          ? `${address} hat sich noch nie angemeldet – die Freigabe gilt ab der ersten Anmeldung.`
          : `${address} hat jetzt Zugriff.`,
      );
      setEmail('');
      await reload();
    }
  };

  const checkbox = (checked: boolean, onChange: (v: boolean) => void, label: string, disabled = !canManage) => (
    <input type="checkbox" checked={checked} disabled={disabled} aria-label={label} onChange={(e) => void onChange(e.target.checked)} />
  );

  return (
    <Modal onClose={onClose} label="Board teilen" className="share-modal">
      <header className="modal-header">
        <h2>{canManage ? 'Board teilen' : 'Mitglieder'}</h2>
        <button type="button" className="icon-btn" aria-label="Schließen" onClick={onClose}>
          <X size={20} />
        </button>
      </header>

      {canManage && (
        <form className="share-form" onSubmit={submit}>
          <input
            type="email"
            list="known-users"
            value={email}
            placeholder="E-Mail-Adresse (Entra-ID-Konto)"
            autoFocus
            required
            onChange={(e) => setEmail(e.target.value)}
          />
          <datalist id="known-users">
            {suggestions.map((u) => (
              <option key={u.id} value={u.email}>
                {u.name}
              </option>
            ))}
          </datalist>
          <label className="check-row">
            <input type="checkbox" checked disabled /> Lesen
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={write}
              onChange={(e) => {
                setWrite(e.target.checked);
                if (!e.target.checked) setManage(false);
              }}
            />{' '}
            Schreiben
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={manage}
              onChange={(e) => {
                setManage(e.target.checked);
                if (e.target.checked) setWrite(true);
              }}
            />{' '}
            Verwalten
          </label>
          <button type="submit" className="btn primary">
            Freigeben
          </button>
        </form>
      )}

      <table className="perm-table">
        <thead>
          <tr>
            <th>Person</th>
            <th>Lesen</th>
            <th>Schreiben</th>
            <th>Verwalten</th>
          </tr>
        </thead>
        <tbody>
          {detail.members.map((m) => (
            <tr key={m.user.id}>
              <td>
                <div className="person">
                  <Avatar user={m.user} size={32} />
                  <div>
                    <div>
                      {m.user.name}
                      {m.user.id === me.id && <span className="muted"> (du)</span>}
                    </div>
                    <div className="muted small">{m.user.email}</div>
                  </div>
                </div>
              </td>
              <td>{checkbox(m.canRead, (v) => change(m.user.id, m, 'canRead', v), `${m.user.name} darf lesen`)}</td>
              <td>{checkbox(m.canWrite, (v) => change(m.user.id, m, 'canWrite', v), `${m.user.name} darf schreiben`)}</td>
              <td>{checkbox(m.canManage, (v) => change(m.user.id, m, 'canManage', v), `${m.user.name} darf verwalten`)}</td>
            </tr>
          ))}
          {detail.invites.map((inv) => (
            <tr key={inv.email} className="invite-row">
              <td>
                <div className="person">
                  <span className="avatar invite" aria-hidden="true">
                    <Mail size={16} />
                  </span>
                  <div>
                    <div>{inv.email}</div>
                    <div className="muted small">Eingeladen – noch nie angemeldet</div>
                  </div>
                </div>
              </td>
              <td>
                {canManage ? (
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Einladung für ${inv.email} entfernen`}
                    onClick={() => void changeInvite(inv.email, inv, 'canRead', false)}
                  >
                    <Trash2 size={16} />
                  </button>
                ) : (
                  checkbox(true, () => undefined, 'Lesen', true)
                )}
              </td>
              <td>{checkbox(inv.canWrite, (v) => changeInvite(inv.email, inv, 'canWrite', v), `${inv.email} darf schreiben`)}</td>
              <td>{checkbox(inv.canManage, (v) => changeInvite(inv.email, inv, 'canManage', v), `${inv.email} darf verwalten`)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small share-hint">
        <strong>Lesen:</strong> Board, Karten, Kommentare und Anhänge ansehen. <strong>Schreiben:</strong> Listen und Karten
        anlegen, ändern, verschieben, kommentieren. <strong>Verwalten:</strong> zusätzlich Personen freigeben, Rechte ändern,
        Board archivieren oder löschen. Administratoren sehen alle Boards.
      </p>
    </Modal>
  );
}
