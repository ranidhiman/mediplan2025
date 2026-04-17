const http = require('http');
const path = require('path');

const CONFIDENCE_THRESHOLD = 0.7;
const LLAMA_API_URL = process.env.LLAMA_API_URL || 'http://localhost:5002';

// Month lookup for multi-format date parsing
const MONTH_MAP = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  january: 0, february: 1, march: 2, april: 3, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

// Classification/header lines to skip when finding title
const SKIP_TITLE_LINES = new Set([
  'unclassified', 'secret', 'top secret', 'confidential',
  'for official use only', 'fouo', 'noforn', 'restricted',
  'unclassified//fouo', 'cui',
]);

function parseDateString(raw) {
  // DDmmmYY  e.g. "01Jan25"
  let m = raw.match(/^(\d{1,2})(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(\d{2})$/i);
  if (m) {
    const year = 2000 + parseInt(m[3], 10);
    return new Date(year, MONTH_MAP[m[2].toLowerCase()], parseInt(m[1], 10));
  }
  // D MMMM YYYY  e.g. "7 April 2026" or "07 Apr 2026"
  m = raw.match(/^(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{4})$/i);
  if (m) {
    return new Date(parseInt(m[3], 10), MONTH_MAP[m[2].toLowerCase()], parseInt(m[1], 10));
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tier 1 — Regex extraction
// ---------------------------------------------------------------------------
function regexExtract(text) {
  const results = {};

  // --- date: multiple military formats ---
  // Priority 1: DDmmmYYYY or DDmmmYY (e.g. 07Apr26, 07Apr2026)
  // Priority 2: DTG  e.g. 071200Z APR 26
  // Priority 3: long form  e.g. 7 April 2026
  const MON = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec';
  const MONFULL = 'January|February|March|April|May|June|July|August|September|October|November|December';

  const datePatterns = [
    { re: new RegExp(`\\b(\\d{1,2}(?:${MON})\\d{2,4})\\b`, 'i'), fmt: 'ddmmmyy' },
    { re: new RegExp(`\\b(\\d{6}Z?\\s*(?:${MON})\\s*\\d{2,4})\\b`, 'i'), fmt: 'dtg' },
    { re: new RegExp(`\\b(\\d{1,2}\\s+(?:${MON}|${MONFULL})\\s+\\d{4})\\b`, 'i'), fmt: 'long' },
  ];

  let dateFound = false;
  for (const { re, fmt } of datePatterns) {
    const m = text.match(re);
    if (m) {
      let rawDate = m[1].trim();
      // DTG: "170000ZMAR23" → "17MAR23"
      if (fmt === 'dtg') rawDate = rawDate.replace(/^(\d{2})\d{4}Z?\s*/, '$1').trim();
      const parsed = parseDateString(rawDate);
      results.date = {
        value: parsed ? parsed.toISOString() : m[1].trim(),
        raw: m[1].trim(),
        confidence: parsed ? 1.0 : 0.65,
        method: 'regex',
      };
      dateFound = true;
      break;
    }
  }
  if (!dateFound) results.date = { value: null, confidence: 0, method: 'regex' };

  // --- mgrsGrid: spaced (38T MN 12345 67890) or compact (38TMN1234567890) ---
  const mgrsSpaced = text.match(/\b(\d{2}[A-Z]{3}\s+\d{4,5}\s+\d{4,5}|\d{2}[A-Z]{2}\s+\d{4,5}\s+\d{4,5})\b/);
  const mgrsCompact = text.match(/\b(\d{2}[A-Z]{2,3}\d{8,10})\b/);
  if (mgrsSpaced) {
    results.mgrsGrid = { value: mgrsSpaced[1], confidence: 1.0, method: 'regex' };
  } else if (mgrsCompact) {
    results.mgrsGrid = { value: mgrsCompact[1], confidence: 0.9, method: 'regex' };
  } else {
    results.mgrsGrid = { value: null, confidence: 0, method: 'regex' };
  }

  // --- casualty: CAx<n> or "X casualties" or "WIA/KIA counts" ---
  const casMatch = text.match(/\bCAx(\d+)\b/i)
    || text.match(/\b(\d+)\s+(?:WIA|KIA|casualties|wounded|killed)\b/i);
  if (casMatch) {
    const isCax = /CAx/i.test(casMatch[0]);
    const count = isCax ? casMatch[1] : casMatch[1];
    results.casualty = {
      value: isCax ? `CAx${count}` : casMatch[0].trim(),
      count: parseInt(count, 10),
      confidence: isCax ? 1.0 : 0.75,
      method: 'regex',
    };
  } else {
    results.casualty = { value: null, confidence: 0, method: 'regex' };
  }

  // --- title: markdown heading → OPORD/AAR heading → first non-classification line ---
  const headingMatch = text.match(/^#{1,3}\s+(.+)$/m);
  if (headingMatch) {
    results.title = { value: headingMatch[1].trim(), confidence: 0.95, method: 'regex' };
  } else {
    // Look for military doc heading patterns: OPORD, AAR, FRAGO, WARNO, OPLAN, ANNEX
    const docHeading = text.match(/\b((?:OPORD|AAR|FRAGO|WARNO|OPLAN|ANNEX|SITREP|MEDEVAC|CASEVAC)\s+[\w\-\/]+(?:\s+[\w\-\/]+)?)/i);
    if (docHeading) {
      results.title = { value: docHeading[1].trim(), confidence: 0.85, method: 'regex' };
    } else {
      // First non-empty, non-classification line
      const firstLine = text.split('\n')
        .map(l => l.trim())
        .find(l => l.length > 2 && !SKIP_TITLE_LINES.has(l.toLowerCase()));
      results.title = firstLine
        ? { value: firstLine, confidence: 0.5, method: 'regex-fallback' }
        : { value: null, confidence: 0, method: 'regex' };
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Tier 2 — Llama extraction for low-confidence / missing fields
// ---------------------------------------------------------------------------
function llamaPost(urlPath, payload) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const base = new URL(LLAMA_API_URL);
    const options = {
      hostname: base.hostname,
      port: parseInt(base.port) || 5002,
      path: urlPath,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length },
    };
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => { chunks.push(chunk); });
      res.on('end', () => {
        const data = Buffer.concat(chunks).toString('utf8');
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`Invalid JSON from Flask: ${data.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const HALLUCINATED_VALUES = new Set([
  '38T MN 12345 67890', '38TMN1234567890', 'CAx3', 'CAx0',
  '2026-04-07T00:00:00.000Z', 'OPORD 1-26 IRON SHIELD',
]);

async function llmExtract(text, fieldsToEscalate) {
  if (fieldsToEscalate.length === 0) return {};

  const parsed = await llamaPost('/extract', { text, fields: fieldsToEscalate });

  const llmResults = {};
  for (const field of fieldsToEscalate) {
    let val = parsed[field] ?? null;
    if (typeof val === 'string' && HALLUCINATED_VALUES.has(val)) val = null;
    llmResults[field] = {
      value: val,
      confidence: val != null ? 0.75 : 0.1,
      method: 'llm',
    };
  }
  return llmResults;
}

// ---------------------------------------------------------------------------
// Public — tiered extraction for plain text
// ---------------------------------------------------------------------------
async function extract(text, onProgress = () => {}) {
  onProgress('regex', 30, 'Running pattern matching...');
  const regexResults = regexExtract(text);

  const total = Object.keys(regexResults).length;
  const fieldsToEscalate = Object.keys(regexResults).filter(
    f => regexResults[f].confidence < CONFIDENCE_THRESHOLD
  );
  const foundByRegex = total - fieldsToEscalate.length;
  onProgress('regex_done', 45, `Pattern matching: ${foundByRegex}/${total} fields found`);

  let llmResults = {};
  if (fieldsToEscalate.length > 0) {
    onProgress('llm', 55, `Sending ${fieldsToEscalate.length} field(s) to AI...`);
    try {
      llmResults = await llmExtract(text, fieldsToEscalate);
      const filled = Object.values(llmResults).filter(r => r.value != null).length;
      onProgress('llm_done', 80, `AI filled ${filled}/${fieldsToEscalate.length} remaining field(s)`);
    } catch (err) {
      console.error('[extractionService] LLM extraction failed:', err.message);
      onProgress('llm_error', 75, 'AI extraction failed — using pattern matches only');
    }
  } else {
    onProgress('llm_skip', 80, 'All fields matched — no AI call needed');
  }

  const merged = { ...regexResults };
  for (const [field, llmResult] of Object.entries(llmResults)) {
    if (llmResult.confidence > (merged[field]?.confidence ?? 0)) {
      merged[field] = llmResult;
    }
  }

  return { fields: merged, summary: buildSummary(merged) };
}

// ---------------------------------------------------------------------------
// Public — tiered extraction for PDFs (pdfplumber + regex + Llama in Python)
// ---------------------------------------------------------------------------
async function extractPdf(absoluteFilePath, onProgress = () => {}, fileName = '', documentId = null) {
  onProgress('extracting_text', 20, 'Extracting text from PDF...');
  const result = await llamaPost('/extract-pdf', {
    file_path: absoluteFilePath,
    file_name: fileName || path.basename(absoluteFilePath),
    document_id: documentId,
  });
  if (result.error) throw new Error(result.error);

  // Describe what the Python pipeline did, based on the returned field methods
  const fields = result.fields || {};
  const total = Object.keys(fields).length;
  const byRegex = Object.values(fields).filter(f => f.method !== 'llm').length;
  const byLlm   = Object.values(fields).filter(f => f.method === 'llm' && f.value != null).length;
  const pageInfo = result.pages ? ` (${result.pages} page(s), ${result.text_length} chars)` : '';

  onProgress('regex_done', 60, `Pattern matching: ${byRegex}/${total} fields found${pageInfo}`);
  if (byLlm > 0) {
    onProgress('llm_done', 80, `AI filled ${byLlm} additional field(s)`);
  } else {
    onProgress('llm_skip', 80, 'All fields matched — no AI call needed');
  }

  return result;
}

function buildSummary(fields) {
  return Object.fromEntries(
    Object.entries(fields).map(([k, v]) => [
      k,
      { value: v.value, confidence: v.confidence, method: v.method },
    ])
  );
}

module.exports = { extract, extractPdf, regexExtract };
