// The three bundled sample documents (original writing; see scripts/).

export interface SampleInfo {
  id: string;
  file: string;
  kind: 'pdf' | 'docx' | 'md';
  label: string;
  title: string;
  blurb: string;
  question: string;
}

export const SAMPLES: SampleInfo[] = [
  {
    id: 'spacing-study',
    file: 'samples/spacing-study.pdf',
    kind: 'pdf',
    label: 'Research paper · PDF',
    title: 'Spacing Out',
    blurb: 'A two-page study on retrieval practice, sleep and exam scores (fictional data).',
    question: 'What were the main findings?',
  },
  {
    id: 'sprint-notes',
    file: 'samples/sprint-notes.docx',
    kind: 'docx',
    label: 'Meeting notes · DOCX',
    title: 'Recall — Sprint 7',
    blurb: 'Planning notes with decisions, a budget and an action-item table.',
    question: 'What was decided about reminders?',
  },
  {
    id: 'tonle-sap',
    file: 'samples/tonle-sap.md',
    kind: 'md',
    label: 'Feature article · Markdown',
    title: 'The Lake That Breathes',
    blurb: 'Why Cambodia’s Tonlé Sap reverses its flow each year.',
    question: 'Why does the Tonlé Sap River reverse?',
  },
];

export function sampleById(id: string | undefined): SampleInfo | undefined {
  return SAMPLES.find((s) => s.id === id);
}
