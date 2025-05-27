// server.js - Full example of a server that uses the MultiBucket library

const express = require('express');
const path = require('path');
const MultiBucket = require('../index');
require('dotenv').config();

// Create the MultiBucket instance
const storagePresigner = new MultiBucket({
  providers: [
    // AWS S3 configuration
    {
      id: 'genericS3',
      type: 's3',
      bucket: process.env.S3_PRIMARY_BUCKET || 'my-s3-bucket',
      region: process.env.S3_PRIMARY_REGION || 'us-east-1',
      accessKeyId: process.env.S3_PRIMARY_ACCESS_KEY || 'YOUR_AWS_ACCESS_KEY',
      secretAccessKey:process.env.S3_PRIMARY_SECRET_KEY || 'YOUR_AWS_SECRET_KEY',
      //publicUrlBase: process.env.S3_PRIMARY_PUBLIC_URL,
      weight: 3,
      rateLimit: 100
    },
    // Cloudflare R2 configuration
    {
      id: 'cloudflareR2',
      type: 'r2',
      bucket: process.env.R2_PRIMARY_BUCKET || 'my-r2-bucket',
      endpoint: process.env.R2_PRIMARY_ENDPOINT || 'https://account-id.r2.cloudflarestorage.com',
      accessKeyId: process.env.R2_PRIMARY_ACCESS_KEY || 'YOUR_R2_ACCESS_KEY',
      secretAccessKey: process.env.R2_PRIMARY_SECRET_KEY || 'YOUR_R2_SECRET_KEY',
      publicUrlBase: process.env.R2_PRIMARY_PUBLIC_URL || 'https://cdn.example.com',
      weight: 1,
      rateLimit: 50
    }
  ],
  // Optionally load more providers from external source
  // configSource: process.env.CONFIG_SOURCE || path.join(__dirname, 'storage-config.json'),
  loadBalanceStrategy: process.env.LOAD_BALANCE_STRATEGY || 'round-robin',
  defaultExpiry: parseInt(process.env.DEFAULT_EXPIRY || '3600')
});

// Create the API server
const app = express();
const port = process.env.PORT || 3000;

// Add CORS and JSON middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});
app.use(express.json());

// Add logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.originalUrl} - ${res.statusCode} - ${duration}ms`);
  });
  next();
});

// API rate limiting middleware (very simple implementation)
const apiRateLimit = {};
app.use((req, res, next) => {
  const ip = req.ip;
  const now = Date.now();
  
  if (!apiRateLimit[ip]) {
    apiRateLimit[ip] = {
      count: 0,
      resetTime: now + 60000 // 1 minute
    };
  }
  
  const limit = apiRateLimit[ip];
  
  if (now > limit.resetTime) {
    limit.count = 0;
    limit.resetTime = now + 60000;
  }
  
  limit.count++;
  
  if (limit.count > 100) { // 100 requests per minute
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }
  
  next();
});

// Authentication middleware (very simple implementation)
const apiKeys = [
  process.env.API_KEY || 'test-api-key'
];

const authenticate = (req, res, next) => {
  const apiKey = req.header('Authorization')?.replace('Bearer ', '') || 
                 req.query.apiKey;
                 
  if (!apiKey || !apiKeys.includes(apiKey)) {
    return res.status(401).json({ error: 'Unauthorized. Invalid API key.' });
  }
  
  next();
};

// Generate upload URL endpoint
app.post('/api/v1/upload-url', authenticate, async (req, res) => {
  try {
    const { filename, contentType, path, expiry, providerId } = req.body;
    
    if (!filename || !contentType) {
      return res.status(400).json({ 
        error: 'Bad request', 
        message: 'filename and contentType are required' 
      });
    }
    
    const result = await storagePresigner.generateUploadUrl({
      filename,
      contentType,
      path,
      expiry,
      providerId
    });
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Error generating upload URL:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      message: error.message 
    });
  }
});

// Generate read URL endpoint
app.post('/api/v1/read-url', authenticate, async (req, res) => {
  try {
    const { key, bucket, providerId, expiry } = req.body;
    
    if (!key) {
      return res.status(400).json({ 
        error: 'Bad request', 
        message: 'key is required' 
      });
    }
    
    const result = await storagePresigner.generateReadUrl({
      key,
      bucket,
      providerId,
      expiry
    });
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Error generating read URL:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      message: error.message 
    });
  }
});

// Stats endpoint (protected)
app.get('/api/v1/stats', authenticate, (req, res) => {
  const stats = storagePresigner.getStats();
  res.json({
    success: true,
    data: stats
  });
});

// Health check endpoint (public)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    providers: storagePresigner.providers.length,
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Serve a simple demo page
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Multi-Storage Presigner Demo</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        h1 { color: #333; }
        .container { margin-top: 20px; }
        .form-group { margin-bottom: 15px; }
        label { display: block; margin-bottom: 5px; }
        input, select { width: 100%; padding: 8px; box-sizing: border-box; }
        button { padding: 10px 15px; background: #4CAF50; color: white; border: none; cursor: pointer; }
        button:hover { background: #45a049; }
        pre { background: #f5f5f5; padding: 15px; overflow: auto; }
      </style>
    </head>
    <body>
      <h1>Multi-Storage Presigner Demo</h1>
      
      <div class="container">
        <h2>Generate Upload URL</h2>
        <div class="form-group">
          <label for="filename">Filename:</label>
          <input type="text" id="filename" value="example.jpg">
        </div>
        <div class="form-group">
          <label for="contentType">Content Type:</label>
          <input type="text" id="contentType" value="image/jpeg">
        </div>
        <div class="form-group">
          <label for="path">Path (optional):</label>
          <input type="text" id="path" value="uploads/images">
        </div>
        <div class="form-group">
          <label for="apiKey">API Key:</label>
          <input type="text" id="apiKey" value="${apiKeys[0]}">
        </div>
        <button id="generateUploadUrl">Generate Upload URL</button>
        
        <h3>Result:</h3>
        <pre id="uploadResult">Results will appear here...</pre>
      </div>
      
      <div class="container">
        <h2>Upload File using Presigned URL</h2>
        <div class="form-group">
          <label for="fileInput">Select File:</label>
          <input type="file" id="fileInput">
        </div>
        <div class="form-group">
          <label for="uploadUrl">Presigned Upload URL:</label>
          <input type="text" id="uploadUrl" placeholder="Paste presigned URL here">
        </div>
        <button id="uploadFile">Upload File</button>
        
        <h3>Upload Status:</h3>
        <pre id="uploadStatus">Status will appear here...</pre>
        <a id="downloadLink" href="#" style="display:none"></a>
      </div>
      
      <script>
        document.getElementById('generateUploadUrl').addEventListener('click', async () => {
          const filename = document.getElementById('filename').value;
          const contentType = document.getElementById('contentType').value;
          const path = document.getElementById('path').value;
          const apiKey = document.getElementById('apiKey').value;
          try {
            const response = await fetch('/api/v1/upload-url', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + apiKey
              },
              body: JSON.stringify({ filename, contentType, path })
            });
            
            const result = await response.json();
            document.getElementById('uploadResult').textContent = JSON.stringify(result, null, 2);
            
            if (result.success) {
              document.getElementById('uploadUrl').value = result.data.uploadUrl;
              document.getElementById('downloadLink').href = result.data.publicUrl;
              document.getElementById('downloadLink').textContent = result.data.publicUrl;
            }
          } catch (error) {
            document.getElementById('uploadResult').textContent = 'Error: ' + error.message;
          }
        });
        
        document.getElementById('uploadFile').addEventListener('click', async () => {
          const fileInput = document.getElementById('fileInput');
          const uploadUrl = document.getElementById('uploadUrl').value;
          const statusElem = document.getElementById('uploadStatus');
          
          if (!fileInput.files[0]) {
            statusElem.textContent = 'Error: Please select a file first';
            return;
          }
          
          if (!uploadUrl) {
            statusElem.textContent = 'Error: Please provide a presigned URL';
            return;
          }
          
          try {
            statusElem.textContent = 'Uploading...';
            
            const file = fileInput.files[0];
            const response = await fetch(uploadUrl, {
              method: 'PUT',
              body: file,
              headers: {
                'Content-Type': file.type
              }
            });
            
            if (response.ok) {
              statusElem.textContent = 'Upload successful!\\n\\nFile should be available at public URL shortly.';
                            document.getElementById('downloadLink').style.display = 'block';

            } else {
              statusElem.textContent = 'Upload failed: ' + response.statusText;
            }
          } catch (error) {
            statusElem.textContent = 'Error: ' + error.message;
          }
        });
      </script>
    </body>
    </html>
  `);
});

// Start the server
const server = app.listen(port, () => {
  console.log(`MultiBucket server running on port ${port}`);
  console.log(`Load balancing strategy: ${storagePresigner.loadBalanceStrategy}`);
  console.log(`Number of providers: ${storagePresigner.providers.length}`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});