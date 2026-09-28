// Small fixtures for tests and end-to-end checks: a PPTX deck with speaker
// notes and a table, a plain-text memo, and an HTML page. Run: node scripts/make-fixtures.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import PptxGenJS from 'pptxgenjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] ?? join(here, '..', 'tests', 'fixtures');
mkdirSync(out, { recursive: true });

const pptx = new PptxGenJS();
pptx.title = 'Solar Microgrids for Rural Clinics';
const s1 = pptx.addSlide();
s1.addText('Solar Microgrids for Rural Clinics', { placeholder: 'title', x: 0.5, y: 1.5, w: 9, h: 1, fontSize: 32, bold: true });
s1.addText('Field pilot briefing · fictional data', { x: 0.5, y: 2.6, w: 9, h: 0.5, fontSize: 16 });
const s2 = pptx.addSlide();
s2.addText('Why clinics need reliable power', { x: 0.5, y: 0.3, w: 9, h: 0.8, fontSize: 26, bold: true });
s2.addText(
  [
    { text: 'Vaccine fridges must stay between 2 and 8 degrees Celsius.', options: { bullet: true } },
    { text: 'Grid outages averaged 14 hours per week at the pilot clinics.', options: { bullet: true } },
    { text: 'Diesel generators cost about $310 per month to run.', options: { bullet: true } },
  ],
  { x: 0.5, y: 1.3, w: 9, h: 3, fontSize: 18 },
);
s2.addNotes('Emphasise the cold chain: a single warm night can spoil a month of vaccines.');
const s3 = pptx.addSlide();
s3.addText('Pilot results', { x: 0.5, y: 0.3, w: 9, h: 0.8, fontSize: 26, bold: true });
s3.addTable(
  [
    [{ text: 'Metric' }, { text: 'Before' }, { text: 'After' }],
    [{ text: 'Outage hours per week' }, { text: '14' }, { text: '1.5' }],
    [{ text: 'Monthly energy cost' }, { text: '$310' }, { text: '$45' }],
  ],
  { x: 0.5, y: 1.3, w: 9 },
);
s3.addText('Battery storage covered every night-time outage during the six-month pilot.', { x: 0.5, y: 3.4, w: 9, h: 0.8, fontSize: 16 });
s3.addNotes('The two remaining outage hours were planned maintenance.');
const s4 = pptx.addSlide();
s4.addText('Next steps', { x: 0.5, y: 0.3, w: 9, h: 0.8, fontSize: 26, bold: true });
s4.addText(
  [
    { text: 'Expand to twelve clinics by March 2027.', options: { bullet: true } },
    { text: 'Train two local technicians per district.', options: { bullet: true } },
  ],
  { x: 0.5, y: 1.3, w: 9, h: 2, fontSize: 18 },
);
const buf = await pptx.write({ outputType: 'nodebuffer' });
writeFileSync(join(out, 'microgrid-deck.pptx'), buf);

writeFileSync(
  join(out, 'field-memo.txt'),
  `FIELD MEMO

Water quality testing, week 12

The mobile lab tested 48 wells across three villages this week. Nine wells exceeded the arsenic guideline of 10 micrograms per litre, all of them deeper than 30 metres.

Recommendations

- Mark the nine wells with red caps and notify households by Friday.
- Re-test shallow wells after the rainy season, when contamination often changes.
- Share results with the district health office before 15 November.

The team will return on 3 December with filter kits funded by a $2,400 grant.
`,
);

writeFileSync(
  join(out, 'cycle-lanes.html'),
  `<!doctype html><html><head><title>Protected Cycle Lanes: A Six-Month Review</title><style>body{font-family:serif}</style><script>console.log('should be ignored')</script></head>
<body><nav><a href="/">Home</a> · <a href="/news">News</a></nav>
<article>
<h1>Protected Cycle Lanes: A Six-Month Review</h1>
<p>Six months after the city opened 11 kilometres of protected cycle lanes, weekday cycling trips on the corridor have risen by 38%. Travel times for buses were unchanged, according to the transport department.</p>
<h2>Safety</h2>
<p>Reported collisions involving cyclists fell from 21 to 9 compared with the same period last year. Most of the remaining collisions happened at junctions where the lane ends.</p>
<h2>What residents said</h2>
<ul><li>Parents said they now let teenagers cycle to school.</li><li>Some shop owners worried about losing parking spaces.</li></ul>
<p>The council will decide on extending the network at its meeting on 12 February 2027.</p>
</article><footer>© City Council</footer></body></html>`,
);
console.log('fixtures written to', out);
