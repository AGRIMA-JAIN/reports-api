// src/routes/putReport.ts

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import sanitizeHtml from 'sanitize-html';
import { store } from '../models/store';
import { requireAuth, requireRole } from '../middleware/auth';
import {
  NotFoundError,
  ValidationError,
  ConflictError,
  PreconditionFailedError,
  ForbiddenError,
} from '../utils/errors';
import {
  buildReportResponse,
  canPublish,
  generateSlug,
  isValidTransition,
} from '../services/reportService';
import { recordAudit, diffFields } from '../services/auditService';
import { Report, ReportStatus } from '../types';
import { reqLogger } from '../utils/logger';

const router = Router();

// ── Partial update schema (all fields optional) 

const updateMetadataSchema = z.object({
  department: z.string().min(1).max(100).optional(),
  fiscalPeriod: z.string().regex(/^\d{4}-Q[1-4]$/, 'Must be in format YYYY-QN').optional(),
  region: z.string().min(1).max(50).optional(),
  confidentialityLevel: z.enum(['public', 'internal', 'confidential', 'restricted']).optional(),
  reviewers: z.array(z.string()).optional(),
  externalRef: z.string().max(100).optional(),
}).optional();

const updateReportSchema = z.object({
  title: z.string().min(3).max(200).optional(),
  summary: z.string().min(10).max(2000).optional(),
  status: z.enum(['draft', 'under_review', 'published', 'archived']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  dueDate: z.string().datetime({ offset: true }).nullable().optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  metadata: updateMetadataSchema,
  assignedTo: z.string().uuid().nullable().optional(),
});

function sanitize(text: string): string {
  return sanitizeHtml(text, { allowedTags: [], allowedAttributes: {} }).trim();
}

// ── Route handler 

router.put('/:id',
  requireAuth,
  requireRole('analyst', 'admin'),
  (req: Request, res: Response) => {
    const log = reqLogger(req.requestId);
    const report = store.getReportById(req.params.id);
    if (!report) throw new NotFoundError('Report', req.params.id);

    // ── Ownership: analysts may only edit their own reports 
    if (req.user!.role === 'analyst' && report.authorId !== req.user!.id) {
      throw new ForbiddenError('Analysts may only edit reports they authored.');
    }

    // ── Optimistic concurrency 
    const ifMatch = req.headers['if-match'];
    if (ifMatch !== undefined) {
      const clientVersion = parseInt(ifMatch, 10);
      if (isNaN(clientVersion) || clientVersion !== report.version) {
        throw new PreconditionFailedError(
          `Version conflict: client has version ${ifMatch}, server has version ${report.version}. Re-fetch and retry.`
        );
      }
    }

    // ── Payload validation 
    const parsed = updateReportSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid update payload.', parsed.error.errors.map(e => ({
        field: e.path.join('.'),
        code: e.code,
        message: e.message,
      })));
    }

    const updates = parsed.data;
    if (Object.keys(updates).length === 0) {
      throw new ValidationError('No update fields provided.', [
        { field: '_body', code: 'EMPTY_BODY', message: 'At least one field must be provided.' },
      ]);
    }

    // ── Snapshot before for audit 
    const before: Partial<Report> = { ...report };

    // ── Status transition validation
    if (updates.status && updates.status !== report.status) {
      if (!isValidTransition(report.status, updates.status as ReportStatus)) {
        throw new ValidationError(
          `Cannot transition report from '${report.status}' to '${updates.status}'.`,
          [{ field: 'status', code: 'INVALID_TRANSITION', message: 'Transition not allowed.' }]
        );
      }

      // Business rule: must pass completion score to publish
      if (updates.status === 'published' && !canPublish(report)) {
        throw new ValidationError(
          'Report cannot be published. completionScore must be ≥ 70.',
          [{ field: 'status', code: 'PUBLISH_GATE_FAILED', message: 'Completion score too low.' }]
        );
      }
    }

    // ── Apply updates 
    if (updates.title !== undefined) {
      const sanitized = sanitize(updates.title);
      if (sanitized !== report.title) {
       
        const newSlug = generateSlug(sanitized);
        if (store.slugExists(newSlug, report.id)) {
          throw new ConflictError('New title produces a slug that conflicts with another report.', [
            { field: 'title', code: 'DUPLICATE_SLUG', message: 'Slug already taken.' },
          ]);
        }
        report.slug = newSlug;
      }
      report.title = sanitize(updates.title);
    }

    if (updates.summary !== undefined) report.summary = sanitize(updates.summary);
    if (updates.priority !== undefined) report.priority = updates.priority;
    if (updates.tags !== undefined) report.tags = updates.tags.map(sanitize);
    if (updates.dueDate !== undefined) report.dueDate = updates.dueDate ?? undefined;
    if (updates.assignedTo !== undefined) {
      if (updates.assignedTo && !store.getUserById(updates.assignedTo)) {
        throw new ValidationError('Assigned user not found.', [
          { field: 'assignedTo', code: 'NOT_FOUND', message: 'User does not exist.' },
        ]);
      }
      report.assignedTo = updates.assignedTo ?? undefined;
    }

    if (updates.status !== undefined) {
      report.status = updates.status as ReportStatus;
      if (updates.status === 'published' && !report.publishedAt) {
        report.publishedAt = new Date().toISOString();
      }
    }

    if (updates.metadata !== undefined) {
      report.metadata = { ...report.metadata, ...updates.metadata };
    }

    // ── Bump version & timestamp 
    report.version += 1;
    report.updatedAt = new Date().toISOString();

    store.saveReport(report);

    // ── Audit trail 
    const after: Partial<Report> = { ...report };
    const changedFields = diffFields(
      before as Record<string, unknown>,
      after as Record<string, unknown>
    );

    recordAudit('report.updated', req.user!, req, report.id, 'report', {
      before,
      after,
      changedFields,
    });

    log.info('report:updated', {
      reportId: report.id,
      changedFields,
      newVersion: report.version,
      userId: req.user!.id,
    });

    const responseBody = buildReportResponse(report, { include: ['metrics'] });
    res.setHeader('ETag', String(report.version));
    res.json(responseBody);
  }
);

export default router;
