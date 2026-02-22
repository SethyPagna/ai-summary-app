import * as pdfjsLib from 'pdfjs-dist';
import mammoth from 'mammoth';
import JSZip from 'jszip';

// ─── File limits ─────────────────────────────────────────────────────────────
export const FILE_LIMITS = {
  maxSizeMB: 20,
  maxSizeBytes: 20 * 1024 * 1024,
  maxCharsForAI: 12000,
  supportedTypes: ['pdf', 'docx', 'pptx', 'txt'],
  notes: [
    'Maximum file size: 20 MB',
    'Supported formats: PDF, DOCX, PPTX, TXT',
    'Text is capped at ~12,000 characters sent to AI',
    'Scanned PDFs (image-only) cannot be extracted',
    '.doc and .ppt (legacy binary) have limited support — convert to .docx/.pptx for best results',
  ],
};

// ─── PDF.js worker ────────────────────────────────────────────────────────────
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

// ─── PDF ─────────────────────────────────────────────────────────────────────
export async function extractTextFromPDF(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = '';

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map((item) => item.str).join(' ');
    fullText += `[Page ${i}]\n${pageText}\n\n`;
  }

  const trimmed = fullText.trim();
  if (!trimmed) {
    throw new Error(
      'No text could be extracted from this PDF. It may be a scanned image-only PDF. Try running OCR on it first.'
    );
  }
  return trimmed;
}

// ─── DOCX ────────────────────────────────────────────────────────────────────
export async function extractTextFromDocx(file) {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  const text = result.value.trim();
  if (!text) throw new Error('No text found in this Word document. It may be empty or image-only.');
  return text;
}

// ─── PPTX — unzip XML slides ─────────────────────────────────────────────────
export async function extractTextFromPptx(file) {
  const arrayBuffer = await file.arrayBuffer();
  let zip;

  try {
    zip = await JSZip.loadAsync(arrayBuffer);
  } catch {
    throw new Error(
      'Could not open this PowerPoint file. It may be corrupted or in the older .ppt binary format. Please save it as .pptx and try again.'
    );
  }

  // Collect slide XML files in order: ppt/slides/slide1.xml, slide2.xml, …
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const na = parseInt(a.match(/\d+/)?.[0] || '0');
      const nb = parseInt(b.match(/\d+/)?.[0] || '0');
      return na - nb;
    });

  if (slideFiles.length === 0) {
    throw new Error(
      'No slides found in this PowerPoint file. It may be an unsupported format or an empty presentation.'
    );
  }

  let allText = '';

  for (let i = 0; i < slideFiles.length; i++) {
    const xml = await zip.files[slideFiles[i]].async('string');
    // Strip XML tags and decode common entities, preserve spacing
    const text = xml
      .replace(/<a:t>/g, ' ')           // text run open tag — add space before
      .replace(/<\/a:t>/g, ' ')          // text run close
      .replace(/<a:br\/>/g, '\n')        // line break element
      .replace(/<[^>]+>/g, '')           // strip remaining tags
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&#xD;/g, '\n')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (text) {
      allText += `[Slide ${i + 1}]\n${text}\n\n`;
    }
  }

  const finalText = allText.trim();
  if (!finalText) {
    throw new Error(
      'No readable text found in this presentation. Slides may contain only images or shapes without text.'
    );
  }
  return finalText;
}

// ─── Master dispatcher ────────────────────────────────────────────────────────
export async function extractTextFromFile(file) {
  // Size check first
  if (file.size > FILE_LIMITS.maxSizeBytes) {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
    throw new Error(
      `File is too large (${sizeMB} MB). Maximum allowed size is ${FILE_LIMITS.maxSizeMB} MB. Please compress or split the file.`
    );
  }

  const ext = file.name.split('.').pop().toLowerCase();

  switch (ext) {
    case 'pdf':
      return extractTextFromPDF(file);

    case 'docx':
      return extractTextFromDocx(file);

    case 'doc':
      return extractTextFromDocx(file).catch(() => {
        throw new Error(
          'Legacy .doc format has limited support. Please open the file in Word and save it as .docx, then re-upload.'
        );
      });

    case 'pptx':
      return extractTextFromPptx(file);

    case 'ppt':
      // Try PPTX path first (some .ppt files are actually OOXML)
      return extractTextFromPptx(file).catch(() => {
        throw new Error(
          'Legacy .ppt binary format cannot be extracted in the browser. Open the file in PowerPoint and save as .pptx, then re-upload.'
        );
      });

    case 'txt':
      return file.text();

    default:
      throw new Error(
        `Unsupported file type ".${ext}". Supported formats: ${FILE_LIMITS.supportedTypes.join(', ')}.`
      );
  }
}

export function truncateText(text, maxChars = FILE_LIMITS.maxCharsForAI) {
  if (text.length <= maxChars) return text;
  return (
    text.slice(0, maxChars) +
    `\n\n…[Content truncated at ${maxChars.toLocaleString()} characters. The full text is stored but only this portion was sent to the AI.]`
  );
}
