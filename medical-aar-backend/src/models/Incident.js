const mongoose = require('mongoose');
const crypto = require('crypto');

const incidentSchema = new mongoose.Schema({
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
  type: {
    type: String,
    required: true,
  },
  severity: {
    type: String,
    enum: ['Info', 'Moderate', 'Severe'],
    default: 'Info',
  },
  description: String,
  latitude: {
    type: Number,
    required: true,
  },
  longitude: {
    type: Number,
    required: true,
  },
  relatedReport: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Report',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Generate unique document ID before saving
incidentSchema.pre('save', function(next) {
  if (!this.documentId) {
    const timestamp = Date.now().toString();
    const randomBytes = crypto.randomBytes(4).toString('hex');
    const hash = crypto.createHash('sha256')
      .update(timestamp + randomBytes)
      .digest('hex')
      .substring(0, 6)
      .toUpperCase();
    this.documentId = `INC-${hash}`;
  }
  next();
});

module.exports = mongoose.model('Incident', incidentSchema);