import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Block } from '../engine/types';
import { escapeRegExp } from '../engine/text';
import { app, getNotes, navigate, saveNotes, setKeyphrase, setReaderScale, setSourceHidden, toast, useApp, type LoadedDoc } from '../store/app';
import { uid, type Highlight } from '../store/db';
import { Icon, kindLabel } from './common';

interface Mark {
  start: number;
  end: number;
  cls: string;
}

function renderMarked(text: string, marks: Mark[]): ReactNode[] {
  if (!marks.length) return [text];
  const points = new Set<number>([0, text.length]);
  for (const m of marks) {
    points.add(Math.max(0, Math.min(text.length, m.start)));
    points.add(Math.max(0, Math.min(text.length, m.end)));
  }
  const sorted = [...points].sort((a, b) => a - b);
  const out: ReactNode[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;
    if (b <= a) continue;
    const cls = [...new Set(marks.filter((m) => m.start <= a && m.end >= b).map((m) => m.cls))];
    const piece = text.slice(a, b);
    out.push(cls.length ? <mark key={a} className={cls.join(' ')}>{piece}</mark> : piece);
  }
  return out;
}

function findAll(text: string, re: RegExp | null, cls: string): Mark[] {
  if (!re) return [];
  const out: Mark[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (!m[0]) {
      re.lastIndex++;
      continue;
    }
    out.push({ start: m.index, end: m.index + m[0].length, cls });
  }
  return out;
}

/** Char offset of a DOM point inside a block element (its textContent == block.text). */
function offsetIn(el: HTMLElement, node: Node, offset: number): number {
  const r = document.createRange();
  r.selectNodeContents(el);
  r.setEnd(node, offset);
  return r.toString().length;
}

interface SelectionInfo {
  blockId: string;
  start: number;
  end: number;
  text: string;
  x: number;
  y: number;
}

export function Reader({ doc, sheet }: { doc: LoadedDoc; sheet?: boolean }) {
  const { meta, blocks } = doc;
  const focus = useApp((s) => (s.focus?.docId === meta.id ? s.focus : null));
  const keyphrase = useApp((s) => s.keyphrase);
  const scale = useApp((s) => s.readerScale);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [find, setFind] = useState('');
  const [findIdx, setFindIdx] = useState(0);
  const [sel, setSel] = useState<SelectionInfo | null>(null);

  useEffect(() => {
    let alive = true;
    getNotes(meta.id).then((n) => alive && setHighlights(n.highlights));
    return () => {
      alive = false;
    };
  }, [meta.id]);

  const kpRe = useMemo(() => {
    if (!keyphrase) return null;
    const parts = keyphrase.split(/\s+/).map(escapeRegExp);
    return new RegExp(`\\b${parts.join('[\\s\\-]+')}\\w*`, 'gi');
  }, [keyphrase]);
  const findRe = useMemo(() => (find.trim().length >= 2 ? new RegExp(escapeRegExp(find.trim()), 'gi') : null), [find]);

  const findCount = useMemo(() => {
    if (!findRe) return 0;
    let n = 0;
    for (const b of blocks) n += findAll(b.text, findRe, 'find').length;
    return n;
  }, [blocks, findRe]);

  // Scroll to the focused passage (citation click).
  useLayoutEffect(() => {
    if (!focus || !focus.ranges.length) return;
    const container = scrollRef.current;
    const el = container?.querySelector<HTMLElement>(`[data-block="${focus.ranges[0]!.blockId}"]`);
    if (!container || !el) return;
    const mark = el.querySelector<HTMLElement>('mark.hl-cite') ?? el;
    const top = mark.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    container.scrollTo({ top: Math.max(0, top - container.clientHeight * 0.3), behavior: 'smooth' });
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }, [focus?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // First keyphrase occurrence.
  useEffect(() => {
    if (!keyphrase) return;
    const container = scrollRef.current;
    const first = container?.querySelector<HTMLElement>('mark.kp');
    if (container && first) {
      const top = first.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
      container.scrollTo({ top: Math.max(0, top - container.clientHeight * 0.3), behavior: 'smooth' });
    }
  }, [keyphrase]);

  const jumpFind = (dir: 1 | -1) => {
    const marks = scrollRef.current?.querySelectorAll<HTMLElement>('mark.find');
    if (!marks || !marks.length) return;
    const next = (findIdx + dir + marks.length) % marks.length;
    setFindIdx(next);
    marks.forEach((m, i) => m.classList.toggle('find-current', i === next));
    const container = scrollRef.current!;
    const top = marks[next]!.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    container.scrollTo({ top: Math.max(0, top - container.clientHeight * 0.3), behavior: 'smooth' });
  };

  const onSelect = () => {
    const s = window.getSelection();
    if (!s || s.isCollapsed || !s.rangeCount) return setSel(null);
    const range = s.getRangeAt(0);
    const startEl = (range.startContainer.nodeType === 1 ? (range.startContainer as Element) : range.startContainer.parentElement)?.closest<HTMLElement>('[data-block]');
    if (!startEl || !scrollRef.current?.contains(startEl) || startEl.dataset.kind === 'table') return setSel(null);
    const blockId = startEl.dataset.block!;
    const block = blocks.find((b) => b.id === blockId);
    if (!block) return setSel(null);
    const start = offsetIn(startEl, range.startContainer, range.startOffset);
    let end: number;
    if (startEl.contains(range.endContainer)) end = offsetIn(startEl, range.endContainer, range.endOffset);
    else end = block.text.length; // selection runs past this block: clip to it
    if (end - start < 3) return setSel(null);
    const rect = range.getBoundingClientRect();
    setSel({ blockId, start, end, text: block.text.slice(start, end), x: rect.left + rect.width / 2, y: rect.top });
  };

  const addHighlight = async () => {
    if (!sel) return;
    const notes = await getNotes(meta.id);
    const h: Highlight = { id: uid('h'), blockId: sel.blockId, start: sel.start, end: sel.end, text: sel.text, createdAt: Date.now() };
    notes.highlights = [...notes.highlights, h];
    await saveNotes(notes);
    setHighlights(notes.highlights);
    window.getSelection()?.removeAllRanges();
    setSel(null);
    app.set((s) => ({ dataVersion: s.dataVersion + 1 }));
    toast('Highlight saved to notes.', 'success');
  };

  const askAbout = (claude: boolean) => {
    if (!sel) return;
    const q = claude ? `Explain this passage in plain words: “${sel.text.trim()}”` : sel.text.trim();
    app.set({ pendingAsk: { text: q, mode: claude ? 'claude' : 'local', docId: meta.id, send: claude } });
    window.getSelection()?.removeAllRanges();
    setSel(null);
    navigate({ name: 'doc', docId: meta.id, tab: 'ask' });
    if (sheet) app.set({ readerOpen: false });
  };

  let lastPage: number | undefined;
  let lastSlide: number | undefined;

  const renderBlock = (b: Block): ReactNode => {
    const marks: Mark[] = [];
    if (focus) for (const r of focus.ranges) if (r.blockId === b.id) marks.push({ start: r.start, end: r.end, cls: 'hl-cite' });
    for (const h of highlights) if (h.blockId === b.id) marks.push({ start: h.start, end: h.end, cls: 'user' });
    marks.push(...findAll(b.text, kpRe, 'kp'), ...findAll(b.text, findRe, 'find'));
    const focused = !!focus?.ranges.some((r) => r.blockId === b.id);
    const common = { 'data-block': b.id, 'data-kind': b.kind, className: `rb rb-${b.kind}${focused ? ' is-focused' : ''}` };
    const content = renderMarked(b.text, marks);
    switch (b.kind) {
      case 'heading':
        return b.level === 1 ? <h2 {...common}>{content}</h2> : b.level === 2 ? <h3 {...common}>{content}</h3> : <h4 {...common}>{content}</h4>;
      case 'li':
        return (
          <p {...common} style={{ paddingLeft: `${1.3 + (b.level ?? 0) * 1.1}em`, ['--indent' as string]: `${(b.level ?? 0) * 1.1}em` }}>
            {content}
          </p>
        );
      case 'quote':
        return <blockquote {...common}>{content}</blockquote>;
      case 'code':
        return <pre {...common}>{b.text}</pre>;
      case 'note':
        return (
          <aside {...common} aria-label="Speaker notes">
            {content}
          </aside>
        );
      case 'table': {
        const rows = b.rows ?? b.text.split('\n').map((l) => l.split(' | '));
        const [head, ...body] = rows;
        return (
          <div {...common}>
            <div className="table-wrap">
              <table>
                {head && (
                  <thead>
                    <tr>
                      {head.map((c, i) => (
                        <th key={i}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                )}
                <tbody>
                  {body.map((r, ri) => (
                    <tr key={ri}>
                      {r.map((c, i) => (
                        <td key={i}>{c}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      }
      default:
        return <p {...common}>{content}</p>;
    }
  };

  return (
    <section className={`reader${sheet ? ' is-sheet' : ''}`} aria-label="Source document" style={{ ['--reader-scale' as string]: scale }}>
      <header className="reader-head">
        <div className="reader-title">
          <span className="kicker">Source · {kindLabel(meta.kind)}</span>
          <span className="reader-file" title={meta.fileName}>
            {meta.fileName}
          </span>
        </div>
        <div className="reader-tools">
          <label className="find">
            <span className="sr-only">Find in document</span>
            <Icon name="search" size={14} />
            <input
              type="search"
              placeholder="Find"
              value={find}
              onChange={(e) => {
                setFind(e.target.value);
                setFindIdx(-1);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  jumpFind(e.shiftKey ? -1 : 1);
                }
              }}
            />
            {findRe && <span className="find-count">{findCount}</span>}
          </label>
          <div className="seg seg-tight" role="group" aria-label="Text size">
            <button type="button" onClick={() => setReaderScale(scale - 0.05)} aria-label="Smaller text">
              A−
            </button>
            <button type="button" onClick={() => setReaderScale(scale + 0.05)} aria-label="Larger text">
              A+
            </button>
          </div>
          {sheet ? (
            <button type="button" className="icon-btn" onClick={() => app.set({ readerOpen: false })} aria-label="Close source">
              <Icon name="close" />
            </button>
          ) : (
            <button type="button" className="icon-btn" onClick={() => setSourceHidden(true)} aria-label="Hide source (focus mode)" title="Hide source">
              <Icon name="sidebar" />
            </button>
          )}
        </div>
      </header>
      {(keyphrase || focus) && (
        <div className="reader-banner">
          {keyphrase ? (
            <>
              <span>
                Highlighting <strong>“{keyphrase}”</strong>
              </span>
              <button type="button" className="link" onClick={() => setKeyphrase(null)}>
                Clear
              </button>
            </>
          ) : (
            <>
              <span>
                Showing cited passage · <strong>{focus!.label}</strong>
              </span>
              <button type="button" className="link" onClick={() => app.set({ focus: null })}>
                Clear
              </button>
            </>
          )}
        </div>
      )}
      <div className="reader-scroll" ref={scrollRef} tabIndex={0} role="region" aria-label={`Text of ${meta.title}`} onMouseUp={onSelect} onKeyUp={onSelect} onScroll={() => sel && setSel(null)}>
        <article className="page">
          <h1 className="page-title">{meta.title}</h1>
          {blocks.map((b, i) => {
            const nodes: ReactNode[] = [];
            if (b.anchor.page && b.anchor.page !== lastPage) {
              if (lastPage !== undefined) nodes.push(<div key={`pg${i}`} className="page-marker" aria-hidden="true"><span>p. {b.anchor.page}</span></div>);
              lastPage = b.anchor.page;
            }
            if (b.anchor.slide && b.anchor.slide !== lastSlide) {
              nodes.push(<div key={`sl${i}`} className="page-marker" aria-hidden="true"><span>Slide {b.anchor.slide}</span></div>);
              lastSlide = b.anchor.slide;
            }
            // The title block duplicates the page title.
            if (i === 0 && b.kind === 'heading' && b.text === meta.title) return nodes.length ? nodes : null;
            nodes.push(<Fragment key={b.id}>{renderBlock(b)}</Fragment>);
            return nodes;
          })}
        </article>
      </div>
      {sel && (
        <div className="sel-bar" style={{ left: Math.max(90, Math.min(window.innerWidth - 90, sel.x)), top: Math.max(60, sel.y - 48) }} role="toolbar" aria-label="Selection actions">
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={addHighlight}>
            <Icon name="highlight" size={14} /> Highlight
          </button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => askAbout(false)}>
            <Icon name="search" size={14} /> Ask
          </button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => askAbout(true)}>
            <Icon name="sparkle" size={14} /> Explain
          </button>
        </div>
      )}
    </section>
  );
}
