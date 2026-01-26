const { spawn } = require('child_process');
const path = require('path');

class RAGService {
  constructor(pythonScriptPath) {
    this.pythonScriptPath = pythonScriptPath;
  }

  async query(userMessage) {
    return new Promise((resolve, reject) => {
      // Spawn Python process to run RAG query
      const python = spawn('python3', [
        this.pythonScriptPath,
        '--query',
        userMessage
      ]);

      let output = '';
      let error = '';

      python.stdout.on('data', (data) => {
        output += data.toString();
      });

      python.stderr.on('data', (data) => {
        error += data.toString();
      });

      python.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Python process exited with code ${code}: ${error}`));
        } else {
          try {
            const response = JSON.parse(output);
            resolve(response);
          } catch (e) {
            resolve({ response: output.trim() });
          }
        }
      });
    });
  }
}

module.exports = RAGService;