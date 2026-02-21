/**
 * Lightweight Markdown → React renderer.
 * Handles: headings, bold, italic, inline code, code blocks,
 *          unordered lists, ordered lists, horizontal rules, paragraphs.
 * No external deps required.
 */

function parseInline(text) {
  // Split on bold, italic, inline-code tokens
  const parts = [];
  // Regex: **bold**, *italic*, `code`, ~~strike~~
  const re = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|~~(.+?)~~)/g;
  let last = 0;
  let match;

  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index));
    }
    if (match[2] !== undefined) {
      parts.push(<strong key={match.index}>{match[2]}</strong>);
    } else if (match[3] !== undefined) {
      parts.push(<em key={match.index}>{match[3]}</em>);
    } else if (match[4] !== undefined) {
      parts.push(
        <code
          key={match.index}
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            padding: '1px 5px',
            fontSize: '0.88em',
            fontFamily: 'monospace',
          }}
        >
          {match[4]}
        </code>
      );
    } else if (match[5] !== undefined) {
      parts.push(<s key={match.index}>{match[5]}</s>);
    }
    last = match.index + match[0].length;
  }

  if (last < text.length) {
    parts.push(text.slice(last));
  }

  return parts.length === 0 ? [text] : parts;
}

export function MarkdownRenderer({ content, style }) {
  if (!content) return null;

  const lines = content.split('\n');
  const elements = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      elements.push(
        <pre
          key={key++}
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '12px 16px',
            overflowX: 'auto',
            fontSize: '0.87em',
            fontFamily: 'monospace',
            margin: '10px 0',
            whiteSpace: 'pre',
          }}
        >
          <code>{codeLines.join('\n')}</code>
        </pre>
      );
      i++;
      continue;
    }

    // Headings
    const h3 = line.match(/^###\s+(.*)/);
    const h2 = line.match(/^##\s+(.*)/);
    const h1 = line.match(/^#\s+(.*)/);

    if (h1) {
      elements.push(
        <h2 key={key++} style={{ fontFamily: 'var(--font-display)', fontSize: '1.25em', fontWeight: 700, margin: '16px 0 8px', color: 'var(--text-primary)', borderBottom: '1px solid var(--border)', paddingBottom: 4 }}>
          {parseInline(h1[1])}
        </h2>
      );
      i++; continue;
    }
    if (h2) {
      elements.push(
        <h3 key={key++} style={{ fontFamily: 'var(--font-display)', fontSize: '1.1em', fontWeight: 700, margin: '14px 0 6px', color: 'var(--text-primary)' }}>
          {parseInline(h2[1])}
        </h3>
      );
      i++; continue;
    }
    if (h3) {
      elements.push(
        <h4 key={key++} style={{ fontSize: '1em', fontWeight: 600, margin: '12px 0 5px', color: 'var(--text-primary)' }}>
          {parseInline(h3[1])}
        </h4>
      );
      i++; continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      elements.push(
        <hr key={key++} style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '14px 0' }} />
      );
      i++; continue;
    }

    // Unordered list — collect consecutive list items
    if (/^[\*\-\+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^[\*\-\+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[\*\-\+]\s+/, ''));
        i++;
      }
      elements.push(
        <ul key={key++} style={{ paddingLeft: 20, margin: '8px 0', listStyleType: 'disc' }}>
          {items.map((item, idx) => (
            <li key={idx} style={{ margin: '3px 0' }}>{parseInline(item)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ''));
        i++;
      }
      elements.push(
        <ol key={key++} style={{ paddingLeft: 22, margin: '8px 0' }}>
          {items.map((item, idx) => (
            <li key={idx} style={{ margin: '3px 0' }}>{parseInline(item)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      const text = line.slice(2);
      elements.push(
        <blockquote
          key={key++}
          style={{
            borderLeft: '3px solid var(--accent)',
            paddingLeft: 14,
            margin: '8px 0',
            color: 'var(--text-secondary)',
            fontStyle: 'italic',
          }}
        >
          {parseInline(text)}
        </blockquote>
      );
      i++; continue;
    }

    // Empty line → spacer
    if (line.trim() === '') {
      // Only add spacer if previous element wasn't also empty
      if (elements.length > 0) {
        elements.push(<div key={key++} style={{ height: 6 }} />);
      }
      i++; continue;
    }

    // Regular paragraph line — merge consecutive non-empty lines
    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,3}|[\*\-\+]|\d+\.|>|```|---|___|\*\*\*)/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }

    if (paraLines.length > 0) {
      elements.push(
        <p key={key++} style={{ margin: '4px 0' }}>
          {parseInline(paraLines.join(' '))}
        </p>
      );
    } else {
      // fallback — shouldn't normally reach here
      i++;
    }
  }

  return (
    <div style={{ ...style }}>
      {elements}
    </div>
  );
}
