import type { ReactNode } from 'react';

/**
 * Kleine Textformatierung für Notizen (Markdown-ähnlich, bewusst wenig):
 *   **fett**, *kursiv* bzw. _kursiv_, `Code`, [Text](https://…), nackte Links
 *   (https://…, www.…, Mail-Adressen), Aufzählungen mit „- “ oder „* “ am Zeilenanfang.
 *
 * Gerendert wird direkt zu React-Elementen – kein HTML aus dem Text, also keine
 * Skript-Einschleusung. Links nur mit http, https oder mailto.
 */

const INLINE =
  /\*\*([^*\n]+)\*\*|\*([^*\s][^*\n]*?)\*|(?<![\w])_([^_\s][^_\n]*?)_(?![\w])|`([^`\n]+)`|\[([^\]\n]+)\]\(([^)\s]+)\)|((?:https?:\/\/|www\.)[^\s<>()]+[^\s<>().,;:!?'"])|([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g;

function safeHref(raw: string): string | null {
  const url = raw.startsWith('www.') ? `https://${raw}` : raw;
  if (/^mailto:/i.test(url)) return url;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

function link(href: string, label: ReactNode, key: number): ReactNode {
  return (
    <a key={key} href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
      {label}
    </a>
  );
}

/** Eine Zeile mit Inline-Formatierung */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const [whole, bold, it1, it2, code, label, url, bare, mail] = m;
    if (bold) out.push(<strong key={key++}>{inline(bold)}</strong>);
    else if (it1 || it2) out.push(<em key={key++}>{inline((it1 ?? it2)!)}</em>);
    else if (code) out.push(<code key={key++}>{code}</code>);
    else if (label && url) {
      const href = safeHref(url);
      out.push(href ? link(href, inline(label), key++) : whole);
    } else if (bare) {
      const href = safeHref(bare);
      out.push(href ? link(href, bare, key++) : bare);
    } else if (mail) out.push(link(`mailto:${mail}`, mail, key++));
    else out.push(whole);
    last = m.index! + whole.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const BULLET = /^\s*[-*•]\s+/;

/** Notiz formatiert anzeigen */
export function RichText({ text, className }: { text: string; className?: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    if (BULLET.test(lines[i]!)) {
      const items: ReactNode[] = [];
      while (i < lines.length && BULLET.test(lines[i]!)) {
        items.push(<li key={i}>{inline(lines[i]!.replace(BULLET, ''))}</li>);
        i++;
      }
      blocks.push(<ul key={key++}>{items}</ul>);
      continue;
    }
    // Absatz: aufeinanderfolgende Zeilen bis zur Leerzeile oder Aufzählung
    const para: ReactNode[] = [];
    while (i < lines.length && lines[i]!.trim() !== '' && !BULLET.test(lines[i]!)) {
      if (para.length) para.push(<br key={`br${i}`} />);
      para.push(...inline(lines[i]!));
      i++;
    }
    if (para.length) blocks.push(<p key={key++}>{para}</p>);
    while (i < lines.length && lines[i]!.trim() === '') i++;
  }
  return <div className={`rich-text${className ? ` ${className}` : ''}`}>{blocks}</div>;
}

/** Formatierung entfernen, z. B. für Tooltips: [Text](url) → „Text (url)“ */
export function plainText(text: string): string {
  return text
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, '$1 ($2)')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*\s][^*\n]*?)\*/g, '$1$2')
    .replace(/(?<![\w])_([^_\s][^_\n]*?)_(?![\w])/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .trim();
}
