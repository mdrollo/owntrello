import { useEffect, useState } from 'react';
import type { Me } from '@owntrello/shared';
import { api } from './lib/api';
import { checkSession, type SessionState } from './lib/auth';
import { useLocation } from './lib/router';
import { AppHeader } from './components/AppHeader';
import { BoardsPage } from './components/BoardsPage';
import { BoardPage } from './components/BoardPage';
import { ToastProvider } from './components/ui';

export function App() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { path } = useLocation();

  useEffect(() => {
    checkSession()
      .then(async (s) => {
        setSession(s);
        setMe(await api.me());
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const board = /^\/b\/(\d+)(?:\/c\/(\d+))?/.exec(path);
  const boardId = board ? Number(board[1]) : null;
  const cardId = board?.[2] ? Number(board[2]) : null;

  return (
    <ToastProvider>
      <div className={`app ${boardId ? 'on-board' : ''}`}>
        <AppHeader me={me} session={session} />
        {error ? (
          <div className="page-message">{error}</div>
        ) : !me ? (
          <div className="page-message">Lädt …</div>
        ) : boardId ? (
          <BoardPage key={boardId} boardId={boardId} cardId={cardId} me={me} />
        ) : (
          <BoardsPage me={me} />
        )}
      </div>
    </ToastProvider>
  );
}
