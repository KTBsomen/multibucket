// Example usage of MultiBucket

const MultiBucket = require('./index');

// Create an instance with initial providers
const storagePresigner = new MultiBucket({
  providers: [
    {
      id: 's3-main',
      type: 's3',
      bucket: 'my-main-bucket',
      region: 'us-east-1',
      accessKeyId: 'AKIAEXAMPLE',
      secretAccessKey: 'secret-key-example',
      weight: 3, // This provider gets 3x more requests in weighted-random mode
      rateLimit: 100 // Requests per second
    },
    {
      id: 'r2-cloudflare',
      type: 'r2',
      bucket: 'my-r2-bucket',
      endpoint: 'https://account-id.r2.cloudflarestorage.com',
      accessKeyId: 'R2-ACCESS-KEY',
      secretAccessKey: 'r2-secret-key-example',
      publicUrlBase: 'https://cdn.example.com',
      weight: 1
    }
  ],
  // Optionally load more providers from external source
  configSource: './storage-config.json',
  loadBalanceStrategy: 'round-robin', // Options: round-robin, least-used, least-errors, weighted-random
  defaultExpiry: 3600 // Default presigned URL expiry in seconds
});

// Example external config file (storage-config.json)
/*
{
  "providers": [
    {
      "id": "s3-backup",
      "type": "s3",
      "bucket": "my-backup-bucket",
      "region": "eu-west-1",
      "accessKeyId": "AKIABACKUP",
      "secretAccessKey": "backup-secret-key",
      "rateLimit": 50
    }
  ],
  "loadBalanceStrategy": "least-errors",
  "defaultExpiry": 7200
}
*/

// Start the API server
const { server } = storagePresigner.createServer(3000);

// Example of generating upload URL programmatically
async function exampleUpload() {
  try {
    const uploadUrlInfo = await storagePresigner.generateUploadUrl({
      filename: 'example.jpg',
      contentType: 'image/jpeg',
      path: 'uploads/images',
      expiry: 1800 // 30 minutes
    });
    
    console.log('Upload URL generated:', uploadUrlInfo);
    // Now you can use uploadUrlInfo.uploadUrl to upload the file
    // After upload, the file will be accessible at uploadUrlInfo.publicUrl
  } catch (error) {
    console.error('Error generating upload URL:', error);
  }
}

// Example of generating read URL programmatically
async function exampleReadUrl() {
  try {
    const readUrlInfo = await storagePresigner.generateReadUrl({
      key: 'uploads/images/123-example.jpg',
      providerId: 's3-main',
      expiry: 3600 // 1 hour
    });
    
    console.log('Read URL generated:', readUrlInfo);
    // Now you can use readUrlInfo.readUrl to download or access the file
  } catch (error) {
    console.error('Error generating read URL:', error);
  }
}

// Run examples
exampleUpload();
exampleReadUrl();

// Example of using the HTTP API:
/*
  # Generate upload URL
  curl -X POST http://localhost:3000/generate-upload-url \
    -H "Content-Type: application/json" \
    -d '{"filename":"test.png","contentType":"image/png","path":"uploads/images"}'

  # Generate read URL
  curl -X POST http://localhost:3000/generate-read-url \
    -H "Content-Type: application/json" \
    -d '{"key":"uploads/images/uuid-test.png","providerId":"s3-main"}'

  # Get stats
  curl http://localhost:3000/stats
*/