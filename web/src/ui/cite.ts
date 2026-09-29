// Citation targets for locally-extracted sentences.

import type { CitationTarget } from '../ai/citations';
import { anchorLabel } from '../engine/segment';
import type { Analysis, Block } from '../engine/types';

export function sentenceTarget(docId: string, analysis: Analysis, blocks: Block[], si: number, fallbackLabel = '¶'): CitationTarget | null {
  const s = analysis.sentences[si];
  if (!s) return null;
  const block = blocks.find((b) => b.id === s.blockId);
  let label = anchorLabel(block?.anchor, '');
  if (!label) label = `${fallbackLabel} ${paragraphNumber(blocks, s.blockId)}`;
  return { docId, label, quote: s.text, ranges: [{ blockId: s.blockId, start: s.start, end: s.end }] };
}

function paragraphNumber(blocks: Block[], blockId: string): number {
  let n = 0;
  for (const b of blocks) {
    if (b.kind !== 'heading') n++;
    if (b.id === blockId) return n;
  }
  return n;
}
