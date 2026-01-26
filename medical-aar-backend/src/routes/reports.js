const express = require('express');
const router = express.Router();
const multer = require('multer');
const Report = require('../models/Report');
const auth = require('../middleware/auth');

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

router.post('/upload', auth, upload.single('file'), async (req, res) => {
  try {
    const metadata = JSON.parse(req.body.metadata);
    const report = new Report({
      ...metadata,
      fileName: req.file.originalname,
      filePath: req.file.path,
      uploadedBy: req.user.id,
    });
    await report.save();
    res.status(201).json(report);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;