// src/routes/attachmentRoutes.ts

import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import mime from 'mime-types';
import { store } from '../models/store';
import { requireAuth, requireRole } from '../middleware/auth';
import {
  NotFoundError,
  TooLargeError,
  UnsupportedMediaError,
  ForbiddenError,
  AppError,
} from '../utils/errors';
import { storage } from '../services/storageService';
import { recordAudit } from '../services/auditService';
import { Attachment } from '../types';
import { reqLogger } from '../utils/logger';

const router = Router({ mergeParams: true });

// ── File restrictions

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

// ── Multer – write to system temp, then move to storage layer 

const upload = multer({
  dest: path.join(process.cwd(), 'uploads', 'tmp'),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
fileFilter: (_req, file, cb) => {
  const detectedMime = mime.lookup(file.originalname) || file.mimetype;
  if (!ALLOWED_MIME_TYPES.has(detectedMime)) {
    cb(new Error(`UNSUPPORTED_MIME:${detectedMime}`));
    return;
  }
  cb(null, true);
},
});

// ── POST /reports/:id/attachment 

router.post('/',
  requireAuth,
  requireRole('analyst', 'admin'),
  (req: Request, res: Response, next) => {
    const log = reqLogger(req.requestId);
    const report = store.getReportById(req.params['id']);
    if (!report) throw new NotFoundError('Report', req.params['id']);

    // Analysts may only attach to their own reports
    if (req.user!.role === 'analyst' && report.authorId !== req.user!.id) {
      throw new ForbiddenError('Analysts may only attach files to their own reports.');
    }

    // Max attachments per report guard
    if (report.attachments.length >= 25) {
      throw new AppError(422, 'ATTACHMENT_LIMIT', 'Reports may have at most 25 attachments.');
    }

upload.single('file')(req, res, async (err) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return next(new TooLargeError(`File exceeds the 20 MB limit.`));
  }
  if (err) {
    if (err.message.startsWith('UNSUPPORTED_MIME:')) {
      const detectedMime = err.message.split(':')[1];
      return next(new UnsupportedMediaError(
        `File type '${detectedMime}' is not permitted. Allowed: ${Array.from(ALLOWED_MIME_TYPES).join(', ')}`
      ));
    }
    return next(err);
  }

  if (!req.file) {
    return next(new AppError(400, 'NO_FILE', 'No file uploaded. Use field name "file".'));
  }


      try {
        const originalName = req.file.originalname;
        const mimeType = mime.lookup(originalName) || req.file.mimetype;

        // Double-check MIME 
        if (!ALLOWED_MIME_TYPES.has(mimeType)) {
          fs.unlinkSync(req.file.path);
          return next(new UnsupportedMediaError(`File type '${mimeType}' is not permitted.`));
        }

        // Move from temp to permanent storage
        const storagePath = await storage.save(req.file.path, originalName);

        const attachment: Attachment = {
          id: store.generateId(),
          reportId: report.id,
          filename: path.basename(storagePath),
          originalName,
          mimeType,
          sizeBytes: req.file.size,
          storagePath,
          uploadedBy: req.user!.id,
          uploadedAt: new Date().toISOString(),
          status: 'stored',
        };

        store.addAttachment(report.id, attachment);

        // Update report updatedAt
        report.updatedAt = new Date().toISOString();
        report.version += 1;
        store.saveReport(report);

        recordAudit('attachment.uploaded', req.user!, req, attachment.id, 'attachment');

        log.info('attachment:uploaded', {
          attachmentId: attachment.id,
          reportId: report.id,
          originalName,
          sizeBytes: attachment.sizeBytes,
          userId: req.user!.id,
        });

        // Generate a short-lived download token (1 hour)
        const tokenData = storage.buildDownloadToken(storagePath, 3600);

        res.status(201)
          .setHeader('Location', `/reports/${report.id}/attachment/${attachment.id}/download`)
          .json({
            id: attachment.id,
            reportId: attachment.reportId,
            originalName: attachment.originalName,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            uploadedAt: attachment.uploadedAt,
            status: attachment.status,
            download: {
              url: `/files/${tokenData.token}`,
              expiresAt: tokenData.expiresAt,
            },
          });
      } catch (saveErr) {
        // Clean up temp file on unexpected errors
        if (req.file && fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
        next(saveErr);
      }
    });
  }
);

// ── GET /reports/:id/attachment/:attachmentId/download 
// Returns a fresh signed URL (token) without serving the bytes directly.

router.get('/:attachmentId/download',
  requireAuth,
  requireRole('viewer', 'analyst', 'admin'),
  (req: Request, res: Response) => {
    const log = reqLogger(req.requestId);
    const report = store.getReportById(req.params['id']);
    if (!report) throw new NotFoundError('Report', req.params['id']);

    const attachment = store.getAttachment(report.id, req.params['attachmentId']);
    if (!attachment || attachment.status !== 'stored') {
      throw new NotFoundError('Attachment', req.params['attachmentId']);
    }

    const tokenData = storage.buildDownloadToken(attachment.storagePath, 3600);

    recordAudit('attachment.downloaded', req.user!, req, attachment.id, 'attachment');

    log.info('attachment:download_requested', {
      attachmentId: attachment.id,
      userId: req.user!.id,
    });

    res.json({
      attachmentId: attachment.id,
      originalName: attachment.originalName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      download: {
        url: `/files/${tokenData.token}`,
        expiresAt: tokenData.expiresAt,
      },
    });
  }
);

export default router;
