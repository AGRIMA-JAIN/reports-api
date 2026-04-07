// src/services/storageService.ts

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { logger } from '../utils/logger';

export interface StorageAdapter {
  save(tempPath: string, filename: string): Promise<string>;  // returns storagePath
  delete(storagePath: string): Promise<void>;
  buildDownloadToken(storagePath: string, expiresInSeconds: number): DownloadToken;
  resolveToken(token: string): string | null;  // storagePath or null if invalid/expired
}

export interface DownloadToken {
  token: string;
  expiresAt: string;
}

// ── In-memory token store 

interface TokenRecord {
  storagePath: string;
  expiresAt: Date;
}
const tokenStore = new Map<string, TokenRecord>();

// ── Local Disk Adapter 

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

// Ensure uploads directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

export const localDiskAdapter: StorageAdapter = {
  async save(tempPath: string, originalName: string): Promise<string> {
    const ext = path.extname(originalName);
    const storedName = `${crypto.randomBytes(16).toString('hex')}${ext}`;
    const dest = path.join(UPLOAD_DIR, storedName);
    fs.renameSync(tempPath, dest);
    logger.info('storage:saved', { src: tempPath, dest });
    return dest;
  },

  async delete(storagePath: string): Promise<void> {
    if (fs.existsSync(storagePath)) {
      fs.unlinkSync(storagePath);
      logger.info('storage:deleted', { storagePath });
    }
  },

  buildDownloadToken(storagePath: string, expiresInSeconds = 3600): DownloadToken {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
    tokenStore.set(token, { storagePath, expiresAt });
    return { token, expiresAt: expiresAt.toISOString() };
  },

  resolveToken(token: string): string | null {
    const record = tokenStore.get(token);
    if (!record) return null;
    if (new Date() > record.expiresAt) {
      tokenStore.delete(token);
      return null;
    }
    tokenStore.delete(token); 
    return record.storagePath;
  },
};

// ── Active adapter

export const storage: StorageAdapter = localDiskAdapter;


