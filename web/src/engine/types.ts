// Core data model shared by ingestion, the local engine, storage and the UI.
// Everything here is plain JSON so it can cross the worker boundary and live
// in IndexedDB unchanged.

export type DocKind = 'pdf' | 'docx' | 'pptx' | 'txt' | 'md' | 'html' | 'paste';

export type BlockKind = 'heading' | 'paragraph' | 'li' | 'quote' | 'code' | 'table' | 'note';

/** Where a block lives in the original file. Used for citation labels. */
export interface Anchor {
  page?: number;
  slide?: number;
  /** Text of the nearest heading above this block (if any). */
  section?: string;
}

export interface Block {
  id: string;
  kind: BlockKind;
  text: string;
  /** Heading level (1 = top) or list nesting depth. */
  level?: number;
  /** Table cells, when kind === 'table'. `text` holds rows joined for search. */
  rows?: string[][];
  anchor: Anchor;
}

/** The extracted, structured form of a document (before analysis). */
export interface ParsedDoc {
  title: string;
  kind: DocKind;
  blocks: Block[];
  pages?: number;
  slides?: number;
  warnings?: string[];
}

export interface Sentence {
  i: number;
  blockId: string;
  /** Char offsets inside the block's text. */
  start: number;
  end: number;
  text: string;
  words: number;
  /** Index of the section (see Analysis.sections) the sentence belongs to. */
  section: number;
}

export interface Section {
  index: number;
  title: string;
  level: number;
  blockId: string | null;
  /** Sentence index range [start, end). */
  sentStart: number;
  sentEnd: number;
  anchor: Anchor;
}

export interface Chunk {
  id: string;
  index: number;
  sentStart: number;
  sentEnd: number;
  blockIds: string[];
  anchor: Anchor;
  heading: string;
  text: string;
}

export interface Keyphrase {
  phrase: string;
  key: string;
  score: number;
  count: number;
  /** First sentence index where the phrase appears. */
  first: number;
}

export type EntityType = 'date' | 'money' | 'percent' | 'email' | 'url' | 'name';

export interface Entity {
  type: EntityType;
  text: string;
  count: number;
  sentences: number[];
}

export interface ReadingStats {
  words: number;
  sentences: number;
  paragraphs: number;
  uniqueWords: number;
  readingMinutes: number;
  flesch: number;
  fleschLabel: string;
  grade: number;
  avgSentenceWords: number;
}

export interface Flashcard {
  id: string;
  kind: 'cloze' | 'define';
  front: string;
  back: string;
  /** For cloze cards: the full sentence with the answer in place. */
  context: string;
  sentence: number;
}

export interface QuizQuestion {
  id: string;
  prompt: string;
  options: string[];
  answer: number;
  sentence: number;
  explanation: string;
}

export interface GlossaryEntry {
  term: string;
  definition: string;
  sentence: number;
  defining: boolean;
}

export interface OutlineNode {
  id: string;
  label: string;
  kind: 'root' | 'section' | 'phrase';
  /** Sentence to jump to, or -1. */
  sentence: number;
  children: OutlineNode[];
}

export interface SummarySet {
  tldr: number[];
  short: number[];
  detailed: number[];
  sections: { section: number; sentences: number[] }[];
}

export interface Analysis {
  version: number;
  docId: string;
  sentences: Sentence[];
  /** TextRank score per sentence (0..1, normalised). */
  scores: number[];
  sections: Section[];
  chunks: Chunk[];
  summary: SummarySet;
  keyphrases: Keyphrase[];
  entities: Entity[];
  stats: ReadingStats;
  flashcards: Flashcard[];
  quiz: QuizQuestion[];
  glossary: GlossaryEntry[];
  outline: OutlineNode;
  /** Top stemmed terms with counts; used for library TF-IDF and compare. */
  terms: Record<string, number>;
  suggestions: string[];
}

export const ANALYSIS_VERSION = 3;
