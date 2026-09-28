# AI Summary v2

**Private document intelligence that runs in your browser.** Drop in a PDF, Word file, slide deck, Markdown or plain text and get a brief you can check: summaries, key phrases, cited answers, flashcards, a quiz, a mind map and document comparison — each line linked to the exact passage it came from.

No account, no server, no API key needed. An optional **Claude mode** (bring your own Anthropic key) adds abstractive summaries, chat with citations, “explain like I’m new” and study guides.

The app lives in [`web/`](web/). Version 1 (February 2026: React + Supabase + OpenRouter) is kept unchanged in [`app/`](app/) for history.

---

## What it does

| | |
|---|---|
| **Ingest** | PDF (pdf.js, worker bundled locally), DOCX (mammoth), PPTX (JSZip + slide XML, incl. speaker notes and tables), TXT, Markdown, HTML and pasted text. Drag-and-drop several files with per-file progress. Parsing runs off the main thread (pdf.js worker + an engine Web Worker). Every block keeps its **page / slide / section anchor**. |
| **Read** | A clean reader view with page and slide markers, find-in-document, adjustable text size, and highlightable passages (select text → highlight, ask, or explain). Citations scroll to and mark the exact passage. |
| **Summarise** | Extractive TL;DR, short and detailed summaries (biased TextRank + MMR), plus per-section summaries from detected headings. |
| **Understand** | Key phrases (RAKE/YAKE-style scoring, re-weighted by TF-IDF across your library), names/dates/money/percentages/links, and readability (words, reading time, Flesch ease, grade level). |
| **Ask** | Q&A over one document, a project, or the whole library: BM25 retrieval with synonym, typo and pseudo-relevance expansion; answers are the best supporting sentences with clickable citations, a confidence meter and a short answer for “when / how many” questions. When nothing relevant exists it says so. |
| **Study** | Cloze flashcards with Leitner-box spaced review, a scored multiple-choice quiz (distractors are other key phrases or nearby numbers), key terms with their defining sentences, and a mind map built from headings and key phrases. |
| **Compare** | Vocabulary similarity, shared vs. unique key phrases, and the most similar passage pairs between two documents. |
| **Organise** | Projects, library-wide search (`/` or `Ctrl K`), notes and highlights per document, Markdown export of summary + notes + Q&A, and a “delete everything” button. |

Try it with the three bundled samples: a two-page research-style PDF (fictional data, labelled as such), sprint-planning meeting notes (DOCX) and a feature article about Cambodia’s Tonlé Sap (Markdown).

## Privacy model

- Files are parsed **in your browser**. Documents, analyses, chats, notes and study progress are stored in **IndexedDB on this device only**. If the browser blocks storage (private mode, sandboxed iframe) the app keeps working in memory and says so.
- Nothing is uploaded anywhere unless you turn on Claude mode.
- **Claude mode** sends requests directly from your browser to `api.anthropic.com` using the official TypeScript SDK (`dangerouslyAllowBrowser`, because the key is your own). The key lives **in memory** by default; “Remember on this device” stores it in `localStorage` after a clear warning, and can be removed any time. The app never logs or ships a key.

## Claude mode (optional)

- Models: `claude-opus-5` (default), `claude-sonnet-5`, `claude-haiku-4-5`.
- Streaming responses; adaptive thinking with an effort level on Opus 5 / Sonnet 5.
- Documents are sent as `document` content blocks with **citations enabled** — extracted text as a plain-text source, or the original PDF as base64 (≤ 12 MB / 100 pages) so Claude sees layout and figures. Returned `char_location` / `page_location` citations are mapped back to exact passages and rendered as numbered chips.
- `claude-opus-5` requests opt into server-side refusal fallbacks (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`); a fallback is shown under the answer.
- `stop_reason` is checked before reading content: refusals discard partial output and show the category; `max_tokens` marks the answer as cut off. API errors are handled distinctly (401 bad key, 403, 404 model, 429 with a `retry-after` countdown, 400/413, 5xx/529, network).
- The document prefix is prompt-cached so follow-up questions are cheaper.

## Run it

Requires Node 20+.

```bash
cd web
npm install
npm run dev        # http://localhost:5302
npm test           # vitest: engine, parsers, anchors, study tools, Claude request/stream with mocked fetch
npm run build      # type-check + production build into web/dist
npm run preview    # serve the build on http://localhost:8812
```

The build is fully static with relative asset paths (`base: './'`) and hash routing, so `web/dist` can be served from any sub-path (e.g. `/play/ai-summary/`) or embedded in an iframe. All fonts and parsers are bundled locally; heavy pieces (pdf.js, mammoth, JSZip, the Anthropic SDK) load only when needed.

Regenerate the bundled samples or test fixtures with `npm run samples` and `node scripts/make-fixtures.mjs`.

## How it works

```
web/src/
  engine/   pure, deterministic text intelligence (runs in a worker and in tests)
            text.ts (sentences, tokens, stemming) · textrank.ts · keyphrases.ts · entities.ts
            readability.ts · segment.ts (sections, chunks, anchors) · bm25.ts · qa.ts
            study.ts (flashcards, quiz, glossary) · outline.ts · compare.ts · analyze.ts
  ingest/   file → blocks: pdf.ts + pdf-layout.ts (columns, headings, de-hyphenation,
            running headers/footers), office.ts (mammoth), pptx.ts, html.ts, blocks.ts (MD/TXT)
  workers/  engine.worker.ts — parsing and analysis off the main thread
  ai/       models.ts, request.ts (request builder), stream.ts (streaming, stop reasons,
            errors), citations.ts (citation → passage), client.ts (lazy SDK, key handling)
  store/    IndexedDB wrapper with in-memory fallback, app state and actions, hash router
  ui/       React components (Brief, Ask, Study, Map, Compare, Reader, dialogs)
```

- **TextRank** builds a sentence graph whose edges blend TF-IDF cosine with the original TextRank overlap measure, then runs personalised PageRank biased towards lead sentences, heading terms and key-phrase-rich sentences. **MMR** (with a same-section penalty) picks a varied summary.
- **Key phrases** are 1–4-word candidates split at stopwords and punctuation (RAKE), filtered for verb-like edges, scored by frequency, length, position and word degree, deduplicated, and re-ranked by IDF across the library.
- **Q&A** retrieves chunks with BM25, re-scores candidate sentences by IDF-weighted query coverage, answer-type cues (dates, numbers, causes, definitions) and document structure (“findings” → Results), and reports confidence honestly.

## Limitations

- Scanned (image-only) PDFs have no text layer; the app detects this and asks for an OCR’d file. Legacy `.doc` / `.ppt` are not supported.
- Local summaries are extractive and English-centric (stemming, stopwords, syllables). They pick sentences; they don’t rewrite them.
- PDF structure is inferred from fonts and positions, so unusual layouts (complex tables, three or more columns) may read out of order.
- Everything is per-browser: there is no sync between devices.

## v1 (February 2026)

The original course project — React 18 + Vite with Supabase auth/storage and OpenRouter models — is preserved in [`app/`](app/). It needs a Supabase project and API keys to run; v2 replaces it with a self-contained, key-optional design.
