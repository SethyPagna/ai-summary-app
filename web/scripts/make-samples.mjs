// Generates the bundled sample documents into public/samples/:
//   spacing-study.pdf  (2-page research-style PDF, via pdf-lib)
//   sprint-notes.docx  (meeting notes with headings, bullets and a table, via docx)
//   tonle-sap.md       (Markdown article)
// Run with: npm run samples
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import * as docx from 'docx';
import { study, notes, article } from './sample-content.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'public', 'samples');
mkdirSync(out, { recursive: true });

// ---------- PDF ----------
async function makePdf() {
  const pdf = await PDFDocument.create();
  pdf.setTitle(study.title);
  pdf.setAuthor('AI Summary demo');
  pdf.setCreationDate(new Date('2026-09-01T00:00:00Z'));
  pdf.setModificationDate(new Date('2026-09-01T00:00:00Z'));
  pdf.setProducer('AI Summary sample generator');
  pdf.setCreator('AI Summary sample generator');
  const serif = await pdf.embedFont(StandardFonts.TimesRoman);
  const serifBold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const serifItalic = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const sans = await pdf.embedFont(StandardFonts.Helvetica);

  const W = 595.28;
  const H = 841.89;
  const M = 62;
  const width = W - 2 * M;
  const pages = [];
  let page;
  let y;
  const newPage = () => {
    page = pdf.addPage([W, H]);
    pages.push(page);
    y = H - M - 8;
  };
  newPage();

  const wrap = (text, font, size, maxWidth) => {
    const words = text.split(/\s+/);
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
        lines.push(line);
        line = w;
      } else line = test;
    }
    if (line) lines.push(line);
    return lines;
  };
  const write = (text, { font = serif, size = 10.5, leading = 14, after = 7, color = rgb(0.1, 0.1, 0.1), indent = 0 } = {}) => {
    const lines = wrap(text, font, size, width - indent);
    for (const l of lines) {
      if (y < M + 24) newPage();
      page.drawText(l, { x: M + indent, y, size, font, color });
      y -= leading;
    }
    y -= after;
  };

  write(study.title, { font: serifBold, size: 17, leading: 21, after: 6 });
  write(study.authors, { font: serifItalic, size: 10.5, leading: 14, after: 3, color: rgb(0.3, 0.3, 0.3) });
  write(study.notice, { font: sans, size: 8.5, leading: 12, after: 12, color: rgb(0.6, 0.2, 0.15) });
  write('Abstract', { font: serifBold, size: 12, leading: 16, after: 3 });
  write(study.abstract, { font: serif, size: 10.5, leading: 14, after: 10 });
  for (const s of study.sections) {
    if (y < M + 90) newPage();
    y -= 4;
    write(s.heading, { font: serifBold, size: 12, leading: 16, after: 3 });
    for (const p of s.paragraphs) {
      const refs = s.heading === 'References';
      write(p, { font: serif, size: refs ? 9.5 : 10.5, leading: refs ? 12.5 : 14, after: refs ? 5 : 7 });
    }
  }
  // Running header and footer (the extractor should strip these).
  pages.forEach((p, i) => {
    p.drawText('AI Summary sample · Spacing Out (fictional study)', { x: M, y: H - 36, size: 8, font: sans, color: rgb(0.45, 0.45, 0.45) });
    p.drawText(`Page ${i + 1} of ${pages.length}`, { x: W - M - 60, y: 30, size: 8, font: sans, color: rgb(0.45, 0.45, 0.45) });
  });
  const bytes = await pdf.save({ useObjectStreams: true });
  writeFileSync(join(out, 'spacing-study.pdf'), bytes);
  console.log(`spacing-study.pdf: ${pages.length} pages, ${bytes.length} bytes`);
}

// ---------- DOCX ----------
async function makeDocx() {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } = docx;
  const children = [];
  children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(notes.title)] }));
  for (const [k, v] of notes.meta) children.push(new Paragraph({ children: [new TextRun({ text: `${k}: `, bold: true }), new TextRun(v)] }));
  for (const s of notes.sections) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(s.heading)] }));
    for (const p of s.paragraphs ?? []) children.push(new Paragraph({ children: [new TextRun(p)], spacing: { after: 120 } }));
    for (const b of s.bullets ?? []) children.push(new Paragraph({ children: [new TextRun(b)], bullet: { level: 0 } }));
    if (s.table) {
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: s.table.map(
            (row, ri) =>
              new TableRow({
                children: row.map((cell) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: cell, bold: ri === 0 })] })] })),
              }),
          ),
        }),
      );
    }
  }
  const doc = new Document({
    creator: 'AI Summary demo',
    title: notes.title,
    description: 'Sample meeting notes for the AI Summary demo (fictional team).',
    sections: [{ children }],
  });
  const buf = await Packer.toBuffer(doc);
  writeFileSync(join(out, 'sprint-notes.docx'), buf);
  console.log(`sprint-notes.docx: ${buf.length} bytes`);
}

function makeMarkdown() {
  writeFileSync(join(out, 'tonle-sap.md'), article);
  console.log(`tonle-sap.md: ${article.length} chars`);
}

await makePdf();
await makeDocx();
makeMarkdown();
