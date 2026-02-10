const mongoose = require('mongoose');
const crypto = require('crypto');

const reportSchema = new mongoose.Schema({
  documentId: {
    type: String,
    unique: true,
    index: true,
  },
  title: {
    type: String,
    required: true,
  },
  date: {
    type: Date,
    required: true,
  },
  location: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    required: true,
  },
  casualty: String,
  injury: String,
  status: {
    type: String,
    default: 'Pending Review',
  },
  fileName: String,
  filePath: String,
  latitude: Number,
  longitude: Number,
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Generate unique document ID before saving
reportSchema.pre('save', function(next) {
  if (!this.documentId) {
    const timestamp = Date.now().toString();
    const randomBytes = crypto.randomBytes(4).toString('hex');
    const hash = crypto.createHash('sha256')
      .update(timestamp + randomBytes)
      .digest('hex')
      .substring(0, 6)
      .toUpperCase();
    this.documentId = `RPT-${hash}`;
  }
  next();
});

module.exports = mongoose.model('Report', reportSchema);