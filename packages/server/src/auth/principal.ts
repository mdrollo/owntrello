import type { IncomingHttpHeaders } from 'node:http';

/**
 * Angemeldeter Benutzer aus den Headern der Azure-App-Service-Anmeldung.
 * Azure setzt diese Header selbst und entfernt sie aus eingehenden Anfragen,
 * man kann ihnen also trauen (solange die Anmeldung für den Pfad aktiv ist).
 */
export interface Principal {
  /** Entra-Objekt-ID (oid) – stabile Benutzer-ID */
  id: string;
  name: string;
  email: string;
}

export function principalFromHeaders(headers: IncomingHttpHeaders): Principal | null {
  const id = headers['x-ms-client-principal-id'];
  const principalName = headers['x-ms-client-principal-name'];
  if (typeof id !== 'string' || !id) return null;

  let name: string | undefined;
  let email: string | undefined;
  const principal = headers['x-ms-client-principal'];
  if (typeof principal === 'string') {
    try {
      const data = JSON.parse(Buffer.from(principal, 'base64').toString('utf8')) as {
        claims?: { typ: string; val: string }[];
      };
      const claim = (...types: string[]) => data.claims?.find((c) => types.includes(c.typ))?.val;
      name = claim('name');
      email = claim('preferred_username', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress', 'email');
    } catch {
      // Header nicht lesbar: nur den Anmeldenamen verwenden
    }
  }
  const fallback = typeof principalName === 'string' && principalName ? principalName : id;
  return { id, name: name ?? fallback, email: email ?? fallback };
}
