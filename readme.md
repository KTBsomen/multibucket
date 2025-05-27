# Multi-Storage Presigner

A Node.js library for generating presigned URLs for multiple object storage providers (AWS S3, Cloudflare R2) with automatic load balancing.

## Features

- Support for multiple storage providers (AWS S3 and Cloudflare R2)
- Automatic load balancing between providers using various strategies
- Live configuration updates from file or remote URL
- Rate limiting and error handling
- RESTful API endpoints for generating presigned URLs
- Monitoring and statistics

## Installation

```bash
npm install multibucket
```

## Dependencies

This library requires the following dependencies:

```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner express axios chokidar
```

## Basic Usage

```javascript
const MultiBucket = require('multibucket');

// Create an instance with initial providers
const storagePresigner = new MultiBucket({
  providers: [
    {
      id: 's3-main',
      type: 's3',
      bucket: 'my-main-bucket',
      region: 'us-east-1',
      accessKeyId: 'YOUR_AWS_ACCESS_KEY',
      secretAccessKey: 'YOUR_AWS_SECRET_KEY',
      weight: 3,
      rateLimit: 100
    },
    {
      id: 'r2-cloudflare',
      type: 'r2',
      bucket: 'my-r2-bucket',
      endpoint: 'https://account-id.r2.cloudflarestorage.com',
      accessKeyId: 'YOUR_R2_ACCESS_KEY',
      secretAccessKey: 'YOUR_R2_SECRET_KEY',
      publicUrlBase: 'https://cdn.example.com'
    }
  ],
  loadBalanceStrategy: 'round-robin',
  defaultExpiry: 3600
});

// Start the API server
storagePresigner.createServer(3000);
```

## Configuration Options

### Constructor Options

- `providers`: Array of storage provider configurations
- `configSource`: Path or URL to a config file (optional)
- `loadBalanceStrategy`: Strategy for load balancing (default: 'round-robin')
- `defaultExpiry`: Default expiry time for presigned URLs in seconds (default: 3600)

### Provider Configuration

Each provider object requires the following properties:

#### Common Properties:
- `id`: Unique identifier for the provider
- `type`: Provider type ('s3' or 'r2')
- `bucket`: Bucket name
- `accessKeyId`: Access key ID
- `secretAccessKey`: Secret access key
- `weight` (optional): Weight for weighted-random load balancing
- `rateLimit` (optional): Maximum requests per second
- `publicUrlBase` (optional): Base URL for public access

#### S3-specific Properties:
- `region`: AWS region
- `endpoint` (optional): Custom endpoint for S3-compatible services
- `forcePathStyle` (optional): Use path-style addressing

#### R2-specific Properties:
- `endpoint`: R2 endpoint URL

## Load Balancing Strategies

- `round-robin`: Cycle through providers sequentially
- `least-used`: Select the provider with the fewest requests
- `least-errors`: Select the provider with the lowest error rate
- `weighted-random`: Select providers randomly based on their weight

## External Configuration

You can provide a path to a JSON file or a URL in the `configSource` option:

```javascript
const storagePresigner = new MultiBucket({
  configSource: './storage-config.json'
});
```

The library will watch for changes to the file or poll the URL to update the configuration dynamically.

## API Endpoints

When you start the server with `createServer()`, the following endpoints are available:

### Generate Upload URL

```
POST /generate-upload-url
```

Request body:
```json
{
  "filename": "example.jpg",
  "contentType": "image/jpeg",
  "path": "uploads/images",
  "expiry": 1800,
  "providerId": "s3-main"
}
```

Response:
```json
{
  "uploadUrl": "https://my-main-bucket.s3.us-east-1.amazonaws.com/uploads/images/uuid-example.jpg?...",
  "publicUrl": "https://my-main-bucket.s3.us-east-1.amazonaws.com/uploads/images/uuid-example.jpg",
  "key": "uploads/images/uuid-example.jpg",
  "bucket": "my-main-bucket",
  "provider": "s3-main",
  "expires": "2023-06-01T12:30:00.000Z"
}
```

### Generate Read URL

```
POST /generate-read-url
```

Request body:
```json
{
  "key": "uploads/images/uuid-example.jpg",
  "providerId": "s3-main",
  "expiry": 3600
}
```

Response:
```json
{
  "readUrl": "https://my-main-bucket.s3.us-east-1.amazonaws.com/uploads/images/uuid-example.jpg?...",
  "key": "uploads/images/uuid-example.jpg",
  "bucket": "my-main-bucket",
  "provider": "s3-main",
  "expires": "2023-06-01T13:00:00.000Z"
}
```

### Get Stats

```
GET /stats
```

Response:
```json
{
  "providerCount": 2,
  "totalRequests": 150,
  "providerStats": [
    {
      "id": "s3-main",
      "type": "s3",
      "requestCount": 100,
      "errorCount": 2,
      "errorRate": "0.0200"
    },
    {
      "id": "r2-cloudflare",
      "type": "r2",
      "requestCount": 50,
      "errorCount": 0,
      "errorRate": "0.0000"
    }
  ]
}
```

### Health Check

```
GET /health
```

Response:
```json
{
  "status": "ok",
  "providers": 2,
  "timestamp": "2023-06-01T11:00:00.000Z"
}
```

## Programmatic Usage

You can also generate presigned URLs programmatically:

```javascript
// Generate upload URL
const uploadUrlInfo = await storagePresigner.generateUploadUrl({
  filename: 'example.jpg',
  contentType: 'image/jpeg',
  path: 'uploads/images',
  expiry: 1800
});

// Generate read URL
const readUrlInfo = await storagePresigner.generateReadUrl({
  key: 'uploads/images/uuid-example.jpg',
  providerId: 's3-main',
  expiry: 3600
});
```

## License

MIT