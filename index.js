const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const axios = require('axios');
const express = require('express');
const crypto = require('crypto');

/**
 * MultiBucket - A library to generate presigned URLs for multiple storage providers
 * with automatic load balancing between them.
 */
class MultiBucket {
  /**
   * Constructor for MultiBucket
   * 
   * @param {Object} options - Configuration options
   * @param {Array} options.providers - Initial array of storage provider configurations
   * @param {String} options.configSource - Path or URL to a config file (optional)
   * @param {Object} options.loadBalanceStrategy - Strategy for load balancing (default: 'round-robin')
   * @param {Number} options.defaultExpiry - Default expiry time in seconds for presigned URLs (default: 3600)
   */
  constructor(options = {}) {
    this.providers = options.providers || [];
    this.configSource = options.configSource;
    this.loadBalanceStrategy = options.loadBalanceStrategy || 'round-robin';
    this.defaultExpiry = options.defaultExpiry || 3600;
    this.currentProviderIndex = 0;
    this.providerUsage = {};
    this.app = null;

    // Initialize provider usage metrics
    this.providers.forEach(provider => {
      this.providerUsage[provider.id] = {
        requestCount: 0,
        errorCount: 0,
        lastUsed: 0,
        rateLimit: provider.rateLimit || 1000
      };
    });

    // Load external configuration if provided
    if (this.configSource) {
      this.loadExternalConfig();
    }
  }

  /**
   * Load configuration from an external source (file or URL)
   */
  async loadExternalConfig() {
    try {
      let configData;
      
      if (this.configSource.startsWith('http://') || this.configSource.startsWith('https://')) {
        // Load from URL
        const response = await axios.get(this.configSource);
        configData = response.data;
        console.log('Config loaded from URL:', this.configSource);
        
        // Set up polling for remote config changes
        setInterval(async () => {
          try {
            const response = await axios.get(this.configSource);
            this.updateConfig(response.data);
          } catch (error) {
            console.error('Error polling remote config:', error.message);
          }
        }, 60000); // Poll every minute
      } else {
        // Load from local file
        configData = JSON.parse(fs.readFileSync(this.configSource, 'utf8'));
        console.log('Config loaded from file:', this.configSource);
        
        // Watch for local file changes
        chokidar.watch(this.configSource).on('change', (path) => {
          try {
            const updatedConfig = JSON.parse(fs.readFileSync(path, 'utf8'));
            this.updateConfig(updatedConfig);
            console.log('Config file updated:', path);
          } catch (error) {
            console.error('Error reading updated config file:', error.message);
          }
        });
      }
      
      this.updateConfig(configData);
    } catch (error) {
      console.error('Error loading external configuration:', error.message);
    }
  }

  /**
   * Update configuration with new data
   * 
   * @param {Object} configData - The new configuration data
   */
  updateConfig(configData) {
    if (configData.providers) {
      // Add new providers
      configData.providers.forEach(newProvider => {
        const existingProviderIndex = this.providers.findIndex(p => p.id === newProvider.id);
        
        if (existingProviderIndex >= 0) {
          // Update existing provider
          this.providers[existingProviderIndex] = { ...this.providers[existingProviderIndex], ...newProvider };
        } else {
          // Add new provider
          this.providers.push(newProvider);
          this.providerUsage[newProvider.id] = {
            requestCount: 0,
            errorCount: 0,
            lastUsed: 0,
            rateLimit: newProvider.rateLimit || 1000
          };
        }
      });
      
      // Remove providers that no longer exist in the new config
      if (configData.removeStaleProviders) {
        const newProviderIds = configData.providers.map(p => p.id);
        this.providers = this.providers.filter(p => newProviderIds.includes(p.id));
      }
    }
    
    // Update other configuration options
    if (configData.loadBalanceStrategy) {
      this.loadBalanceStrategy = configData.loadBalanceStrategy;
    }
    
    if (configData.defaultExpiry) {
      this.defaultExpiry = configData.defaultExpiry;
    }
  }

  /**
   * Get a storage provider based on the load balancing strategy
   * 
   * @returns {Object} The selected provider
   */
  getStorageProvider() {
    if (this.providers.length === 0) {
      throw new Error('No storage providers configured');
    }
    
    let selectedProvider;
    
    switch (this.loadBalanceStrategy) {
      case 'round-robin':
        selectedProvider = this.providers[this.currentProviderIndex];
        this.currentProviderIndex = (this.currentProviderIndex + 1) % this.providers.length;
        break;
        
      case 'least-used':
        selectedProvider = this.providers.reduce((least, current) => {
          return (this.providerUsage[current.id].requestCount < this.providerUsage[least.id].requestCount) 
            ? current : least;
        }, this.providers[0]);
        break;
        
      case 'least-errors':
        // Select provider with the least errors
        selectedProvider = this.providers.reduce((least, current) => {
          const leastErrorRate = this.providerUsage[least.id].errorCount / (this.providerUsage[least.id].requestCount || 1);
          const currentErrorRate = this.providerUsage[current.id].errorCount / (this.providerUsage[current.id].requestCount || 1);
          return (currentErrorRate < leastErrorRate) ? current : least;
        }, this.providers[0]);
        break;
        
      case 'weighted-random':
        // Providers with higher weight are more likely to be selected
        const totalWeight = this.providers.reduce((sum, provider) => sum + (provider.weight || 1), 0);
        let random = Math.random() * totalWeight;
        
        for (const provider of this.providers) {
          const weight = provider.weight || 1;
          if (random < weight) {
            selectedProvider = provider;
            break;
          }
          random -= weight;
        }
        
        // Fallback in case of precision errors
        if (!selectedProvider) {
          selectedProvider = this.providers[0];
        }
        break;
        
      default:
        selectedProvider = this.providers[0];
    }
    
    // Check if the selected provider is rate limited
    const now = Date.now();
    const providerUsage = this.providerUsage[selectedProvider.id];
    
    if (now - providerUsage.lastUsed < (1000 / providerUsage.rateLimit)) {
      // Provider is rate limited, try to find another one
      const availableProvider = this.providers.find(p => {
        const usage = this.providerUsage[p.id];
        return now - usage.lastUsed >= (1000 / usage.rateLimit);
      });
      
      if (availableProvider) {
        selectedProvider = availableProvider;
      }
      // If no available provider is found, we'll use the originally selected one despite rate limiting
    }
    
    // Update provider usage metrics
    providerUsage.requestCount++;
    providerUsage.lastUsed = now;
    
    return selectedProvider;
  }

  /**
   * Create a client for the given provider
   * 
   * @param {Object} provider - The storage provider configuration
   * @returns {Object} A client for the provider
   */
  createClient(provider) {
    if (provider.type === 's3') {
      return new S3Client({
        region: provider.region,
        endpoint: provider.endpoint,
        credentials: {
          accessKeyId: provider.accessKeyId,
          secretAccessKey: provider.secretAccessKey
        },
        forcePathStyle: provider.forcePathStyle || false
      });
    } else if (provider.type === 'r2') {
      // Cloudflare R2 uses the same S3 API client but with different endpoint
      return new S3Client({
        region: 'auto',
        endpoint: provider.endpoint,
        credentials: {
          accessKeyId: provider.accessKeyId,
          secretAccessKey: provider.secretAccessKey
        },
        forcePathStyle: true
      });
    } else {
      throw new Error(`Unsupported provider type: ${provider.type}`);
    }
  }

  /**
   * Generate a presigned URL for uploading a file
   * 
   * @param {Object} options - Options for generating the presigned URL
   * @param {String} options.filename - The original filename
   * @param {String} options.contentType - The content type of the file
   * @param {Number} options.expiry - Expiry time in seconds (optional, defaults to constructor value)
   * @param {String} options.path - Custom path within the bucket (optional)
   * @param {String} options.providerId - Specific provider ID to use (optional)
   * @returns {Promise<Object>} An object containing the presigned URL and related information
   */
  async generateUploadUrl(options) {
    try {
      // Get a provider based on load balancing strategy or use the specified one
      const provider = options.providerId 
        ? this.providers.find(p => p.id === options.providerId) 
        : this.getStorageProvider();
      
      if (!provider) {
        throw new Error(`Provider not found: ${options.providerId}`);
      }
      
      const client = this.createClient(provider);
      
      // Generate a unique key for the file
      const uniqueId = crypto.randomUUID();
      const key = options.path 
        ? `${options.path.replace(/^\/|\/$/g, '')}/${uniqueId}-${options.filename}`
        : `${uniqueId}-${options.filename}`;
      
      // Create a command for putting the object
      const command = new PutObjectCommand({
        Bucket: provider.bucket,
        Key: key,
        ContentType: options.contentType,
      });
      
      // Generate the presigned URL
      const expiry = options.expiry || this.defaultExpiry;
      const signedUrl = await getSignedUrl(client, command, { expiresIn: expiry });
      
      // Generate the public URL for future reference
      let publicUrl;
      if (provider.type === 's3') {
        publicUrl = `https://${provider.bucket}.s3.${provider.region}.amazonaws.com/${key}`;
        // If a custom domain is specified, use that instead
        if (provider.publicUrlBase) {
          publicUrl = `${provider.publicUrlBase.replace(/\/$/g, '')}/${key}`;
        }
      } else if (provider.type === 'r2') {
        // For R2, we need the custom domain (Cloudflare doesn't provide default public URLs)
        if (provider.publicUrlBase) {
          publicUrl = `${provider.publicUrlBase.replace(/\/$/g, '')}/${key}`;
        } else {
          publicUrl = null; // No public URL available without a custom domain
        }
      }
      
      return {
        uploadUrl: signedUrl,
        publicUrl,
        key,
        bucket: provider.bucket,
        provider: provider.id,
        expires: new Date(Date.now() + expiry * 1000).toISOString(),
      };
    } catch (error) {
      // Update error count for the provider
      if (error.providerInfo && this.providerUsage[error.providerInfo.id]) {
        this.providerUsage[error.providerInfo.id].errorCount++;
      }
      
      throw new Error(`Failed to generate upload URL: ${error.message}`);
    }
  }

  /**
   * Generate a presigned URL for reading/downloading a file
   * 
   * @param {Object} options - Options for generating the presigned URL
   * @param {String} options.key - The object key
   * @param {String} options.bucket - The bucket name (optional if the key already includes provider info)
   * @param {String} options.providerId - Specific provider ID to use
   * @param {Number} options.expiry - Expiry time in seconds (optional, defaults to constructor value)
   * @returns {Promise<Object>} An object containing the presigned URL
   */
  async generateReadUrl(options) {
    try {
      // Find the provider based on the provided ID or try to match bucket
      let provider;
      
      if (options.providerId) {
        provider = this.providers.find(p => p.id === options.providerId);
      } else if (options.bucket) {
        provider = this.providers.find(p => p.bucket === options.bucket);
      }
      
      if (!provider) {
        throw new Error('Provider not found. Please specify a valid providerId or bucket');
      }
      
      const client = this.createClient(provider);
      
      // Create a command for getting the object
      const command = new GetObjectCommand({
        Bucket: provider.bucket,
        Key: options.key,
      });
      
      // Generate the presigned URL
      const expiry = options.expiry || this.defaultExpiry;
      const signedUrl = await getSignedUrl(client, command, { expiresIn: expiry });
      
      return {
        readUrl: signedUrl,
        key: options.key,
        bucket: provider.bucket,
        provider: provider.id,
        expires: new Date(Date.now() + expiry * 1000).toISOString(),
      };
    } catch (error) {
      throw new Error(`Failed to generate read URL: ${error.message}`);
    }
  }

  /**
   * Get stats about the storage providers
   * 
   * @returns {Object} Stats about usage and errors
   */
  getStats() {
    return {
      providerCount: this.providers.length,
      totalRequests: Object.values(this.providerUsage).reduce((sum, usage) => sum + usage.requestCount, 0),
      providerStats: this.providers.map(provider => ({
        id: provider.id,
        type: provider.type,
        requestCount: this.providerUsage[provider.id].requestCount,
        errorCount: this.providerUsage[provider.id].errorCount,
        errorRate: this.providerUsage[provider.id].requestCount > 0
          ? (this.providerUsage[provider.id].errorCount / this.providerUsage[provider.id].requestCount).toFixed(4)
          : 0
      }))
    };
  }

  /**
   * Create an Express.js server to expose the presigned URL generation as APIs
   * 
   * @param {Number} port - The port to listen on (default: 3000)
   * @returns {Object} The Express app instance
   */
  createServer(port = 3000) {
    const app = express();
    app.use(express.json());
    
    // Middleware to handle errors
    const errorHandler = (err, req, res, next) => {
      console.error('API Error:', err.message);
      res.status(500).json({ error: err.message });
    };
    
    // Generate upload URL endpoint
    app.post('/generate-upload-url', async (req, res, next) => {
      try {
        const { filename, contentType, expiry, path, providerId } = req.body;
        
        if (!filename || !contentType) {
          return res.status(400).json({ error: 'filename and contentType are required' });
        }
        
        const result = await this.generateUploadUrl({
          filename,
          contentType,
          expiry,
          path,
          providerId
        });
        
        res.json(result);
      } catch (error) {
        next(error);
      }
    });
    
    // Generate read URL endpoint
    app.post('/generate-read-url', async (req, res, next) => {
      try {
        const { key, bucket, providerId, expiry } = req.body;
        
        if (!key) {
          return res.status(400).json({ error: 'key is required' });
        }
        
        const result = await this.generateReadUrl({
          key,
          bucket,
          providerId,
          expiry
        });
        
        res.json(result);
      } catch (error) {
        next(error);
      }
    });
    
    // Stats endpoint
    app.get('/stats', (req, res) => {
      res.json(this.getStats());
    });
    
    // Health check endpoint
    app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        providers: this.providers.length,
        timestamp: new Date().toISOString()
      });
    });
    
    app.use(errorHandler);
    
    // Start the server
    const server = app.listen(port, () => {
      console.log(`MultiBucket server running on port ${port}`);
    });
    
    this.app = app;
    return { app, server };
  }
}

module.exports = MultiBucket;