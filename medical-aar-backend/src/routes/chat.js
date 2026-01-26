const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const RAGService = require('../services/ragService');
const path = require('path');

// Initialize RAG service with path to Python script
const ragService = new RAGService(
  path.join(__dirname, '../../path-to-rag-folder/rag_api.py')
);

// Chat endpoint
router.post('/', auth, async (req, res) => {
  try {
    const { message } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Query RAG system
    const ragResponse = await ragService.query(message);
    
    res.json({
      response: ragResponse.response || ragResponse,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('RAG query error:', error);
    res.status(500).json({ 
      error: 'Failed to process query',
      details: error.message 
    });
  }
});

module.exports = router;