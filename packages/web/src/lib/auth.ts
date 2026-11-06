/**
 * Anmeldung über die Azure-App-Service-Authentifizierung (Entra ID).
 *
 * Azure sitzt vor der App und kennt die Sitzung; die App fragt sie über
 * /.auth/me ab. Weil der Service Worker die App selbst aus dem Cache liefert
 * (z. B. direkt nach dem Abmelden), prüfen wir die Sitzung beim Start
 * ausdrücklich und schicken nicht angemeldete Besucher zur Microsoft-Anmeldung.
 *
 * Lokal gibt es /.auth nicht (der Server liefert dort index.html); dann läuft
 * die App als Entwicklungsbenutzer (DEV_USER_* im Server).
 */

export type SessionState = 'authenticated' | 'local';

const LOGIN_KEY = 'owntrello.loginAt';
/** Schutz vor einer Endlosschleife, falls die Anmeldung selbst scheitert */
const LOGIN_RETRY_MS = 30_000;

/** Zur Microsoft-Anmeldung, danach zurück zur aktuellen Seite. */
export function goToLogin(): never {
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(LOGIN_KEY) ?? 0);
    sessionStorage.setItem(LOGIN_KEY, String(Date.now()));
  } catch {
    // Speicher nicht verfügbar: trotzdem versuchen
  }
  if (Date.now() - last > LOGIN_RETRY_MS) {
    const back = window.location.pathname + window.location.search;
    window.location.replace(`/.auth/login/aad?post_login_redirect_uri=${encodeURIComponent(back)}`);
  }
  throw new Error('Nicht angemeldet – bitte Seite neu laden.');
}

const isJson = (res: Response) => (res.headers.get('content-type') ?? '').includes('json');

/**
 * Kennzeichnet Anfragen als Hintergrundanfragen. Ohne diesen Header beantwortet
 * Azure Anfragen mit abgelaufener Sitzung mit Status 200 und einer HTML-Seite
 * "Redirecting to login page…" – mit ihm eindeutig mit 401/403.
 */
export const AJAX_HEADERS = { 'X-Requested-With': 'XMLHttpRequest' } as const;

/** fetch für alles hinter der Azure-Anmeldung */
export function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    redirect: 'manual',
    credentials: 'same-origin',
    ...init,
    headers: { ...AJAX_HEADERS, ...(init.headers as Record<string, string> | undefined) },
  });
}

/** Antwort bedeutet: keine gültige Azure-Sitzung */
export function isLoggedOut(res: Response): boolean {
  return res.status === 401 || res.status === 403 || res.type === 'opaqueredirect';
}

/**
 * Prüft beim Start, ob eine Azure-Sitzung besteht. Ohne Sitzung wird zur
 * Anmeldung weitergeleitet (die Funktion kehrt dann nicht zurück).
 */
export async function checkSession(): Promise<SessionState> {
  const res = await authFetch('/.auth/me', { cache: 'no-store' });
  if (isLoggedOut(res)) goToLogin();
  if (!res.ok) return 'local';
  if (!isJson(res)) {
    // Lokal liefert der Server hier index.html; Azures Anmeldeseite sicherheitshalber erkennen
    if ((await res.text()).includes('redirectToLoginPage')) goToLogin();
    return 'local';
  }

  const sessions = (await res.json()) as unknown[];
  if (sessions.length === 0) goToLogin();
  try {
    sessionStorage.removeItem(LOGIN_KEY);
  } catch {
    // egal
  }
  return 'authenticated';
}
