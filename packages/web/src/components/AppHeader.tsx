import { LayoutGrid, LogOut } from 'lucide-react';
import type { Me } from '@owntrello/shared';
import type { SessionState } from '../lib/auth';
import { navigate } from '../lib/router';
import { Avatar, Popover, usePopover } from './ui';

export function AppHeader({ me, session }: { me: Me | null; session: SessionState | null }) {
  const pop = usePopover<'user'>();
  return (
    <header className="app-header">
      <a
        className="brand"
        href="/"
        onClick={(e) => {
          e.preventDefault();
          navigate('/');
        }}
      >
        <span className="brand-mark" aria-hidden="true">
          <span />
          <span />
        </span>
        owntrello
      </a>
      <button type="button" className="header-btn" onClick={() => navigate('/')}>
        <LayoutGrid size={16} /> Boards
      </button>
      <div className="header-spacer" />
      {me && (
        <button type="button" className="avatar-btn" aria-label="Benutzermenü" onClick={pop.toggle('user')}>
          <Avatar user={me} size={30} />
        </button>
      )}
      {me && pop.open && (
        <Popover anchor={pop.open.anchor} title="Konto" onClose={pop.close} width={280}>
          <div className="account">
            <Avatar user={me} size={40} />
            <div>
              <div className="account-name">{me.name}</div>
              <div className="muted small">{me.email}</div>
              {me.isAdmin && <div className="badge-admin">Administrator</div>}
            </div>
          </div>
          {session === 'authenticated' ? (
            <a className="menu-item" href="/.auth/logout?post_logout_redirect_uri=/">
              <LogOut size={16} /> Abmelden
            </a>
          ) : (
            <p className="muted small">Lokaler Betrieb ohne Anmeldung (Entwicklungsbenutzer).</p>
          )}
        </Popover>
      )}
    </header>
  );
}
