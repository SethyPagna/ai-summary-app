import { Fragment, type ReactNode } from 'react';
import type { CitationTarget } from '../ai/citations';
import { focusPassage } from '../store/app';

// ---------------------------------------------------------------- icons

const PATHS: Record<string, string> = {
  upload: 'M12 16V4m0 0-4 4m4-4 4 4M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3',
  paste: 'M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1Zm-3 2h2m8 0h2a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Zm3 6h6m-6 4h4',
  search: 'm20 20-4.2-4.2M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14.5 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-15v2m0 16v2M4.2 4.2l1.4 1.4m12.8 12.8 1.4 1.4M2 12h2m16 0h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z',
  keyboard: 'M3 7a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Zm4 3h.01M11 10h.01M15 10h.01M7 14h10',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Zm6 12 .8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8L18 15Z',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5Zm0 14a2 2 0 0 1 2-2h13',
  trash: 'M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3',
  download: 'M12 4v12m0 0-4-4m4 4 4-4M5 20h14',
  close: 'M6 6l12 12M18 6 6 18',
  menu: 'M4 7h16M4 12h16M4 17h16',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z',
  plus: 'M12 5v14M5 12h14',
  send: 'M5 12h14m0 0-6-6m6 6-6 6',
  stop: 'M7 7h10v10H7z',
  check: 'm5 12 5 5L20 7',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z',
  file: 'M7 3h7l5 5v13H7V3Zm7 0v5h5',
  arrow: 'M5 12h14m0 0-5-5m5 5-5 5',
  back: 'M19 12H5m0 0 5-5m-5 5 5 5',
  flip: 'M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  pin: 'M12 17v4M8 3h8l-1 6 3 3H6l3-3-1-6Z',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  compare: 'M8 4v16M16 4v16M4 8h4m8 0h4M4 16h4m8 0h4',
  highlight: 'M4 20h7M14.5 4.5l5 5L10 19H5v-5l9.5-9.5Z',
  retry: 'M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4',
  info: 'M12 8h.01M11 12h1v5h1M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
  minus: 'M5 12h14',
  map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 0v14m6-12v14',
  sidebar: 'M4 5h16v14H4zM15 5v14m-7-7h4m-2-2 2 2-2 2',
};

export function Icon({ name, size = 18, className }: { name: keyof typeof PATHS | string; size?: number; className?: string }) {
  const d = PATHS[name] ?? PATHS.info!;
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

// ---------------------------------------------------------------- citations

export function CiteChip({ target, index }: { target: CitationTarget | null; index?: number }) {
  if (!target) return null;
  return (
    <button
      type="button"
      className="cite"
      title={target.quote ? `“${target.quote.slice(0, 220)}${target.quote.length > 220 ? '…' : ''}”` : `Show ${target.label}`}
      aria-label={`Show source passage ${target.label}${target.quote ? `: ${target.quote.slice(0, 120)}` : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        focusPassage({ docId: target.docId, ranges: target.ranges, label: target.label, quote: target.quote });
      }}
    >
      {index !== undefined && <span className="cite-n">{index}</span>}
      {target.label}
    </button>
  );
}

// ---------------------------------------------------------------- markdown-lite

/** Placeholder marker for inline citation chips inside Markdown text. */
export const CITE_MARK = '⁣';
const CITE_RE = new RegExp(`${CITE_MARK}(\\d+)${CITE_MARK}`, 'g');

function renderInline(text: string, chips: (i: number) => ReactNode, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  // Tokenise: citation placeholders, **bold**, *italic*, `code`.
  const re = new RegExp(`${CITE_MARK}(\\d+)${CITE_MARK}|\\*\\*([^*]+)\\*\\*|(?<![\\w*])\\*([^*\\n]+)\\*(?![\\w*])|(?<![\\w_])_([^_\\n]+)_(?![\\w_])|\`([^\`]+)\``, 'g');
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyBase}-${k++}`;
    if (m[1] !== undefined) out.push(<Fragment key={key}>{chips(Number(m[1]))}</Fragment>);
    else if (m[2] !== undefined) out.push(<strong key={key}>{renderInline(m[2], chips, key)}</strong>);
    else if (m[3] !== undefined) out.push(<em key={key}>{m[3]}</em>);
    else if (m[4] !== undefined) out.push(<em key={key}>{m[4]}</em>);
    else if (m[5] !== undefined) out.push(<code key={key}>{m[5]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Safe Markdown subset (no HTML): headings, bullets, numbered lists, paragraphs. */
export function Markdown({ text, chips = () => null, className }: { text: string; chips?: (i: number) => ReactNode; className?: string }) {
  const lines = text.replace(/\r/g, '').split('\n');
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let n = 0;
  const flushPara = () => {
    if (para.length) {
      const key = `p${n++}`;
      blocks.push(<p key={key}>{renderInline(para.join(' '), chips, key)}</p>);
    }
    para = [];
  };
  const flushList = () => {
    if (list) {
      const key = `l${n++}`;
      const items = list.items.map((it, i) => <li key={i}>{renderInline(it, chips, `${key}-${i}`)}</li>);
      blocks.push(list.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>);
    }
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const num = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (!line.trim() || (line.trim() === CITE_MARK)) {
      flushPara();
      flushList();
      continue;
    }
    if (h) {
      flushPara();
      flushList();
      const key = `h${n++}`;
      const level = h[1]!.length;
      const content = renderInline(h[2]!, chips, key);
      blocks.push(level <= 2 ? <h3 key={key}>{content}</h3> : <h4 key={key}>{content}</h4>);
    } else if (bullet || num) {
      flushPara();
      const ordered = !!num && !bullet;
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((bullet ?? num)![1]!);
    } else if (list && /^\s{2,}\S/.test(raw)) {
      list.items[list.items.length - 1] += ' ' + line.trim();
    } else if (list && CITE_RE.test(line) && line.replace(CITE_RE, '').trim() === '') {
      // A citation marker that landed on its own line belongs to the last item.
      CITE_RE.lastIndex = 0;
      list.items[list.items.length - 1] += line.trim();
    } else {
      flushList();
      para.push(line.trim());
    }
    CITE_RE.lastIndex = 0;
  }
  flushPara();
  flushList();
  return <div className={className ?? 'md'}>{blocks}</div>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="spinner" role="status">
      <span className="spinner-dot" />
      {label && <span>{label}</span>}
    </span>
  );
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

export function kindLabel(kind: string): string {
  return { pdf: 'PDF', docx: 'DOCX', pptx: 'PPTX', txt: 'TXT', md: 'MD', html: 'HTML', paste: 'TEXT' }[kind] ?? kind.toUpperCase();
}

export function timeAgo(t: number): string {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} d ago`;
}
