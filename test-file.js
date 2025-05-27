const MultiBucket = require('../index');
const express = require('express');
const supertest = require('supertest');

// Mock AWS SDK modules
jest.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: jest.fn().mockImplementation(() => ({
      // Mock implementation
    })),
    PutObjectCommand: jest.fn().mockImplementation((params) => ({
      ...params,
      __type: 'PutObjectCommand'
    })),
    GetObjectCommand: jest.fn().mockImplementation((params) => ({
      ...params,
      __type: 'GetObjectCommand'
    }))
  };
});

jest.mock('@aws-sdk/s3-request-presigner', () => {
  return {
    getSignedUrl: jest.fn().mockImplementation((client, command, options) => {
      const type = command.__type;
      const bucket = command.Bucket;
      const key = command.Key;
      
      if (type === 'PutObjectCommand') {
        return Promise.resolve(`https://${bucket}.example.com/${key}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=EXAMPLE`);
      } else if (type === 'GetObjectCommand') {
        return Promise.resolve(`https://${bucket}.example.com/${key}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=EXAMPLE&X-Amz-Signature=READ`);
      }
      return Promise.resolve('https://mock-url.com');
    })
  };
});

// Mock fs and axios modules
jest.mock('fs', () => ({
  readFileSync: jest.fn().mockImplementation(() => JSON.stringify({
    providers: [
      {
        id: 'test-provider',
        type: 's3',
        bucket: 'test-bucket',
        region: 'test-region',
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret'
      }
    ]
  })),
  existsSync: jest.fn().mockReturnValue(true)
}));

jest.mock('axios', () => ({
  get: jest.fn().mockImplementation(() => Promise.resolve({
    data: {
      providers: [
        {
          id: 'remote-provider',
          type: 'r2',
          bucket: 'remote-bucket',
          endpoint: 'https://remote.example.com',
          accessKeyId: 'remote-key',
          secretAccessKey: 'remote-secret'
        }
      ]
    }
  }))
}));

jest.mock('chokidar', () => ({
  watch: jest.fn().mockReturnValue({
    on: jest.fn()
  })
}));

describe('MultiBucket', () => {
  let presigner;
  
  beforeEach(() => {
    presigner = new MultiBucket({
      providers: [
        {
          id: 'test-s3',
          type: 's3',
          bucket: 'test-s3-bucket',
          region: 'us-east-1',
          accessKeyId: 'test-access-key',
          secretAccessKey: 'test-secret-key'
        },
        {
          id: 'test-r2',
          type: 'r2',
          bucket: 'test-r2-bucket',
          endpoint: 'https://test.r2.cloudflarestorage.com',
          accessKeyId: 'test-r2-key',
          secretAccessKey: 'test-r2-secret',
          publicUrlBase: 'https://test-cdn.example.com'
        }
      ],
      loadBalanceStrategy: 'round-robin',
      defaultExpiry: 3600
    });
  });
  
  test('should initialize with provided providers', () => {
    expect(presigner.providers.length).toBe(2);
    expect(presigner.providers[0].id).toBe('test-s3');
    expect(presigner.providers[1].id).toBe('test-r2');
  });
  
  test('should get a provider based on load balancing strategy', () => {
    // Test round-robin
    const provider1 = presigner.getStorageProvider();
    const provider2 = presigner.getStorageProvider();
    const provider3 = presigner.getStorageProvider();
    
    expect(provider1.id).toBe('test-s3');
    expect(provider2.id).toBe('test-r2');
    expect(provider3.id).toBe('test-s3');
    
    // Test least-used strategy
    presigner.loadBalanceStrategy = 'least-used';
    presigner.providerUsage['test-s3'].requestCount = 10;
    presigner.providerUsage['test-r2'].requestCount = 5;
    
    const leastUsedProvider = presigner.getStorageProvider();
    expect(leastUsedProvider.id).toBe('test-r2');
    
    // Test least-errors strategy
    presigner.loadBalanceStrategy = 'least-errors';
    presigner.providerUsage['test-s3'].errorCount = 2;
    presigner.providerUsage['test-r2'].errorCount = 0;
    
    const leastErrorsProvider = presigner.getStorageProvider();
    expect(leastErrorsProvider.id).toBe('test-r2');
    
    // Test weighted-random strategy
    presigner.loadBalanceStrategy = 'weighted-random';
    presigner.providers[0].weight = 1;
    presigner.providers[1].weight = 0; // Force selection of first provider
    
    const weightedProvider = presigner.getStorageProvider();
    expect(weightedProvider.id).toBe('test-s3');
  });
  
  test('should create the right client for each provider type', () => {
    const s3Client = presigner.createClient(presigner.providers[0]);
    const r2Client = presigner.createClient(presigner.providers[1]);
    
    expect(s3Client).toBeDefined();
    expect(r2Client).toBeDefined();
  });
  
  test('should throw error for unsupported provider type', () => {
    const unsupportedProvider = {
      id: 'unsupported',
      type: 'unsupported',
      bucket: 'test-bucket'
    };
    
    expect(() => {
      presigner.createClient(unsupportedProvider);
    }).toThrow('Unsupported provider type: unsupported');
  });
  
  test('should generate upload URL', async () => {
    const result = await presigner.generateUploadUrl({
      filename: 'test.jpg',
      contentType: 'image/jpeg',
      path: 'uploads'
    });
    
    expect(result).toBeDefined();
    expect(result.uploadUrl).toContain('test-s3-bucket.example.com');
    expect(result.key).toContain('uploads');
    expect(result.key).toContain('test.jpg');
  });
  
  test('should generate read URL', async () => {
    const result = await presigner.generateReadUrl({
      key: 'uploads/test.jpg',
      providerId: 'test-s3'
    });
    
    expect(result).toBeDefined();
    expect(result.readUrl).toContain('test-s3-bucket.example.com');
    expect(result.readUrl).toContain('X-Amz-Signature=READ');
  });
  
  test('should return correct stats', () => {
    presigner.providerUsage['test-s3'].requestCount = 100;
    presigner.providerUsage['test-s3'].errorCount = 5;
    presigner.providerUsage['test-r2'].requestCount = 50;
    presigner.providerUsage['test-r2'].errorCount = 2;
    
    const stats = presigner.getStats();
    
    expect(stats.providerCount).toBe(2);
    expect(stats.totalRequests).toBe(150);
    expect(stats.providerStats[0].id).toBe('test-s3');
    expect(stats.providerStats[0].requestCount).toBe(100);
    expect(stats.providerStats[0].errorCount).toBe(5);
    expect(stats.providerStats[0].errorRate).toBe('0.0500');
  });
  
  test('should create an express server', () => {
    const { app, server } = presigner.createServer(3001);
    
    expect(app).toBeDefined();
    expect(server).toBeDefined();
    
    server.close();
  });
  
  test('API endpoints should work correctly', async () => {
    const app = express();
    app.use(express.json());
    
    // Mock the methods to avoid actual server creation
    app.post('/generate-upload-url', async (req, res) => {
      const result = await presigner.generateUploadUrl(req.body);
      res.json(result);
    });
    
    app.post('/generate-read-url', async (req, res) => {
      const result = await presigner.generateReadUrl(req.body);
      res.json(result);
    });
    
    app.get('/stats', (req, res) => {
      res.json(presigner.getStats());
    });
    
    app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        providers: presigner.providers.length,
        timestamp: new Date().toISOString()
      });
    });
    
    const request = supertest(app);
    
    // Test upload URL endpoint
    const uploadResponse = await request
      .post('/generate-upload-url')
      .send({
        filename: 'test.jpg',
        contentType: 'image/jpeg',
        path: 'uploads'
      });
    
    expect(uploadResponse.status).toBe(200);
    expect(uploadResponse.body.uploadUrl).toBeDefined();
    
    // Test read URL endpoint
    const readResponse = await request
      .post('/generate-read-url')
      .send({
        key: 'uploads/test.jpg',
        providerId: 'test-s3'
      });
    
    expect(readResponse.status).toBe(200);
    expect(readResponse.body.readUrl).toBeDefined();
    
    // Test stats endpoint
    const statsResponse = await request.get('/stats');
    expect(statsResponse.status).toBe(200);
    expect(statsResponse.body.providerCount).toBeDefined();
    
    // Test health endpoint
    const healthResponse = await request.get('/health');
    expect(healthResponse.status).toBe(200);
    expect(healthResponse.body.status).toBe('ok');
  });
});