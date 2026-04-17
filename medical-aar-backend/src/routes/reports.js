const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const http = require('http');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const Report = require('../models/Report');
const auth = require('../middleware/auth');
const { extract, extractPdf } = require('../services/extractionService');

function flaskPost(urlPath, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const options = {
      hostname: 'localhost',
      port: 5002,
      path: urlPath,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.log']);

// ── SSE job store ─────────────────────────────────────────────────────────────
// Each upload gets a jobId. Progress events are buffered so a client that
// connects slightly after the upload starts still replays missed events.
const jobs = new Map();

function createJob() {
  const jobId = require('crypto').randomBytes(8).toString('hex');
  jobs.set(jobId, { events: [], subscribers: new Set(), done: false });
  setTimeout(() => jobs.delete(jobId), 10 * 60 * 1000); // expire after 10 min
  return jobId;
}

function emitJobEvent(jobId, stage, percent, message, extra = {}) {
  const job = jobs.get(jobId);
  if (!job) return;
  const event = { stage, percent, message, ...extra };
  job.events.push(event);
  for (const res of job.subscribers) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
}

function closeJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.done = true;
  for (const res of job.subscribers) res.end();
  job.subscribers.clear();
}
// ─────────────────────────────────────────────────────────────────────────────

// Assign stable serial numbers to LLM-derived fields so a human can locate
// and correct them in the saved JSON file with any text editor.
function buildExtractionJson(extraction, documentId, fileName) {
  let llmCounter = 1;
  const fields = {};
  for (const [key, field] of Object.entries(extraction.fields || {})) {
    fields[key] = {
      serial: ['llm', 'ollama'].includes(field.method) ? `LLM-${String(llmCounter++).padStart(3, '0')}` : null,
      value: field.value,
      confidence: field.confidence,
      method: field.method,
    };
  }
  return {
    _meta: {
      documentId: documentId || null,
      fileName,
      extractedAt: new Date().toISOString(),
      note: 'Fields marked with a serial number (LLM-XXX) were extracted by AI. ' +
            'To correct a discrepancy, find the serial number in this file and update "value".',
    },
    fields,
  };
}

// Auth middleware that also checks query params (for download links)
const authWithQuery = (req, res, next) => {
  try {
    let token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token && req.query.token) {
      token = req.query.token;
    }
    if (!token) {
      return res.status(401).json({ message: 'No authentication token' });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ message: 'Invalid token' });
  }
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  },
});

const upload = multer({ storage });

router.get('/', auth, async (req, res) => {
  try {
    const reports = await Report.find().sort({ createdAt: -1 });
    res.json(reports);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const report = new Report({
      ...req.body,
      uploadedBy: req.user.id,
    });
    await report.save();
    res.status(201).json(report);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST /api/reports/extract — extract fields from raw text without saving
router.post('/extract', auth, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ message: '"text" string is required' });
    }
    const result = await extract(text);
    res.json(result);
  } catch (error) {
    console.error('Extraction error:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/reports/progress/:jobId — SSE stream for upload progress
// Uses authWithQuery so EventSource can pass token as ?token=
router.get('/progress/:jobId', authWithQuery, (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ message: 'Job not found' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Replay any events that fired before the client connected
  for (const event of job.events) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  if (job.done) { res.end(); return; }

  job.subscribers.add(res);
  req.on('close', () => job.subscribers.delete(res));
});

router.post('/upload', auth, upload.single('file'), (req, res) => {
  let metadata;
  try {
    metadata = JSON.parse(req.body.metadata);
  } catch {
    return res.status(400).json({ message: 'Invalid metadata JSON' });
  }

  const jobId = createJob();
  const emit = (stage, percent, message, extra) =>
    emitJobEvent(jobId, stage, percent, message, extra);

  // Return the jobId immediately — client connects SSE then watches progress
  res.status(202).json({ jobId });

  // Run extraction pipeline async — does not block the HTTP response
  (async () => {
    try {
      emit('received', 5, `File received — ${req.file.originalname}`);

      const ext = path.extname(req.file.originalname).toLowerCase();
      const filenameStem = path.basename(req.file.originalname, ext);

      // Save a stub report first so we have a MongoDB _id to pass to Flask for ChromaDB indexing
      emit('saving', 10, 'Creating report record...');
      const report = new Report({
        title:      filenameStem,
        type:       'After Action Report',
        status:     'Pending Review',
        fileName:   req.file.originalname,
        filePath:   req.file.path,
        uploadedBy: req.user.id,
      });
      await report.save();
      // Re-fetch to get documentId generated by the pre-save hook (e.g. RPT-XXXXXX)
      const savedReport = await Report.findById(report._id);
      const reportId = savedReport._id.toString();
      const humanId = savedReport.documentId;
      console.log('[upload] reportId:', reportId, 'documentId:', humanId);

      let extraction = null;
      try {
        if (ext === '.pdf') {
          console.log('[upload] calling extractPdf with humanId:', humanId);
          extraction = await extractPdf(path.resolve(req.file.path), emit, req.file.originalname, humanId);
        } else if (TEXT_EXTENSIONS.has(ext)) {
          emit('reading', 15, 'Reading document...');
          const fileText = fs.readFileSync(req.file.path, 'utf8');
          extraction = await extract(fileText, emit);
        } else {
          emit('reading', 50, 'File type has no extraction support — saving as-is');
        }
      } catch (extractErr) {
        console.warn('Extraction failed, saving report without extracted fields:', extractErr.message);
        emit('llm_error', 80, `Extraction failed: ${extractErr.message} — saving report anyway`);
      }

      emit('schema', 88, 'Building adaptive schema...');
      let extractionPath = null;
      if (extraction) {
        extractionPath = req.file.path + '.extraction.json';
        fs.writeFileSync(extractionPath, JSON.stringify(
          buildExtractionJson(extraction, humanId, req.file.originalname),
          null, 2
        ));
      }

      // Update report with extracted fields
      const f = extraction?.fields || {};
      const title    = f.title?.value    || filenameStem;
      const mgrsGrid = f.mgrsGrid?.value || null;
      const casualty = f.casualty?.value || null;
      const rawDate  = f.date?.value || null;
      const date     = rawDate && !isNaN(new Date(rawDate).getTime()) ? new Date(rawDate) : null;

      emit('saving', 95, `Saving — "${title}"`);
      savedReport.title          = title;
      savedReport.date           = date;
      savedReport.location       = mgrsGrid || f.location?.value || 'Unknown';
      savedReport.mgrsGrid       = mgrsGrid;
      savedReport.casualty       = casualty;
      savedReport.extractionPath = extractionPath;
      await savedReport.save();

      emit('complete', 100, 'Report saved successfully', { report: savedReport });
      closeJob(jobId);
    } catch (err) {
      console.error('Async upload error:', err);
      emitJobEvent(jobId, 'error', 0, err.message);
      closeJob(jobId);
    }
  })();
});

// GET /api/reports/:id/extraction — serve the saved extraction JSON
router.get('/:id/extraction', auth, async (req, res) => {
  try {
    const report = await Report.findById(req.params.id);
    if (!report) return res.status(404).json({ message: 'Report not found' });
    if (!report.extractionPath || !fs.existsSync(report.extractionPath)) {
      return res.status(404).json({ message: 'No extraction data for this report' });
    }
    const data = JSON.parse(fs.readFileSync(report.extractionPath, 'utf8'));
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST /api/reports/:id/reindex — re-embed document in ChromaDB after JSON edit
router.post('/:id/reindex', auth, async (req, res) => {
  try {
    const report = await Report.findById(req.params.id);
    if (!report) return res.status(404).json({ message: 'Report not found' });
    if (!report.filePath) return res.status(404).json({ message: 'No file path on report' });

    const fields = report.extractionPath && fs.existsSync(report.extractionPath)
      ? JSON.parse(fs.readFileSync(report.extractionPath, 'utf8'))
      : {};

    const data = await flaskPost('/reindex', {
      document_id: report.documentId || report._id.toString(),
      file_path:   path.resolve(report.filePath),
      file_name:   report.fileName,
      fields,
    });
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// PUT /api/reports/:id/extraction — overwrite with manually corrected JSON
router.put('/:id/extraction', auth, async (req, res) => {
  try {
    const report = await Report.findById(req.params.id);
    if (!report) return res.status(404).json({ message: 'Report not found' });
    if (!report.extractionPath) {
      return res.status(404).json({ message: 'No extraction file path recorded for this report' });
    }
    fs.writeFileSync(report.extractionPath, JSON.stringify(req.body, null, 2));
    res.json({ message: 'Extraction updated' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// PUT /api/reports/:id — update report fields
router.put('/:id', auth, async (req, res) => {
  try {
    const allowed = ['title', 'date', 'location', 'mgrsGrid', 'type', 'casualty', 'injury', 'status'];
    const updates = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => allowed.includes(k))
    );
    const report = await Report.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!report) return res.status(404).json({ message: 'Report not found' });
    res.json(report);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const report = await Report.findById(req.params.id);
    if (!report) {
      return res.status(404).json({ message: 'Report not found' });
    }
    res.json(report);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get('/:id/download', authWithQuery, async (req, res) => {
  try {
    const report = await Report.findById(req.params.id);
    if (!report) {
      return res.status(404).json({ message: 'Report not found' });
    }
    if (!report.filePath) {
      return res.status(404).json({ message: 'No file attached to this report' });
    }
    const filePath = path.resolve(report.filePath);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: 'File not found on server' });
    }
    res.download(filePath, report.fileName);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Serve file inline (for in-page viewing)
router.get('/:id/view', authWithQuery, async (req, res) => {
  try {
    const report = await Report.findById(req.params.id);
    if (!report) {
      return res.status(404).json({ message: 'Report not found' });
    }
    if (!report.filePath) {
      return res.status(404).json({ message: 'No file attached to this report' });
    }
    const filePath = path.resolve(report.filePath);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: 'File not found on server' });
    }
    res.setHeader('Content-Disposition', `inline; filename="${report.fileName}"`);
    res.sendFile(filePath);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Delete a report and its file
router.delete('/:id', auth, async (req, res) => {
  try {
    const report = await Report.findById(req.params.id);
    if (!report) {
      return res.status(404).json({ message: 'Report not found' });
    }

    // Delete uploaded file from disk
    if (report.filePath) {
      const filePath = path.resolve(report.filePath);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    // Delete extraction JSON sidecar file
    if (report.extractionPath && fs.existsSync(report.extractionPath)) {
      fs.unlinkSync(report.extractionPath);
    }

    // Remove from ChromaDB + SQLite so chatbot no longer knows about this doc
    const docId = report.documentId || report._id.toString();
    try {
      await flaskPost('/delete-document', { document_id: docId });
    } catch (flaskErr) {
      console.warn('[delete] Flask cleanup failed (non-fatal):', flaskErr.message);
    }

    await Report.findByIdAndDelete(req.params.id);
    res.json({ message: 'Report deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;