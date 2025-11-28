// Type declarations for multibucket (minimal)
// Project: multibucket
// Definitions are kept minimal to reflect public API exported by index.js

interface ProviderConfig {
    id: string;
    type: 's3' | 'r2';
    bucket: string;
    region?: string;
    endpoint?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    weight?: number;
    publicUrlBase?: string;
    rateLimit?: number;
    forcePathStyle?: boolean;
}

interface MultiBucketOptions {
    providers?: ProviderConfig[];
    configSource?: string;
    loadBalanceStrategy?: string;
    defaultExpiry?: number;
}

interface UploadUrlResult {
    uploadUrl: string;
    publicUrl: string | null;
    key: string;
    bucket: string;
    provider: string;
    expires: string; // ISO timestamp
}

interface ReadUrlResult {
    readUrl: string;
    key: string;
    bucket: string;
    provider: string;
    expires: string; // ISO timestamp
}

declare class MultiBucket {
    constructor(options?: MultiBucketOptions);
    loadExternalConfig(): Promise<void>;
    updateConfig(configData: any): void;
    getStorageProvider(): ProviderConfig;
    createClient(provider: ProviderConfig): any;
    generateUploadUrl(options: { filename: string; contentType: string; expiry?: number; path?: string; providerId?: string; keySpecified?: string }): Promise<UploadUrlResult>;
    generateReadUrl(options: { key: string; bucket?: string; providerId?: string; expiry?: number }): Promise<ReadUrlResult>;
    getStats(): any;
    createServer(port?: number): { app: any; server: any };
}

export = MultiBucket;
