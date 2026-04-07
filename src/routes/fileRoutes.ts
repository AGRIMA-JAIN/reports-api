// src/routes/fileRoutes.ts

import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import mime from 'mime-types';
import { storage } from '../services/storageService';
import { AppError } from '../utils/errors';
import { reqLogger } from '../utils/logger';

const router = Router();

router.get('/:token', (req: Request, res: Response) => {
  const log = reqLogger(req.requestId);
  const { token } = req.params;

  const storagePath = storage.resolveToken(token);
  if (!storagePath) {
    throw new AppError(410, 'TOKEN_EXPIRED_OR_INVALID', 'Download link has expired or is invalid.');
  }

  if (!fs.existsSync(storagePath)) {
    log.error('file:missing_on_disk', { storagePath, token });
    throw new AppError(404, 'FILE_NOT_FOUND', 'File could not be located.');
  }

  const filename = path.basename(storagePath);
  const mimeType = mime.lookup(storagePath) || 'application/octet-stream';

  log.info('file:served', { token, storagePath, mimeType });

  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  fs.createReadStream(storagePath).pipe(res);
});

export default router;
