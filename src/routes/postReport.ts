// src/routes/postReport.ts

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import sanitizeHtml from 'sanitize-html';
import { store } from '../models/store';
import { requireAuth, requireRole } from '../middleware/auth';
import { ConflictError, ValidationError } from '../utils/errors';
import {
  buildReportResponse,
  canPublish,
  generateSlug,
  computeCompletionScore,
} from '../services/reportService';
import { recordAudit } from '../services/auditService';
import { enqueue } from '../jobs/jobQueue';
import { Report } from '../types';
import { reqLogger } from '../utils/logger';

const router = Router();

// ── Idempotency key cache 
const idempotencyCache = new Map<string, { statusCode: number; body: unknown }>();

// ── Input validation schema 

const metadataSchema = z.object({
  department: z.string().min(1).max(100),
  fiscalPeriod: z.string().regex(/^\d{4}-Q[1-4]$/, 'Must be in format YYYY-QN'),
  region: z.string().min(1).max(50),
  confidentialityLevel: z.enum(['public', 'internal', 'confidential', 'restricted']),
  reviewers: z.array(z.string().uuid()).optional().default([]),
  externalRef: z.string().max(100).optional(),
});

const createReportSchema = z.object({
  title: z.string().min(3).max(200),
  summary: z.string().min(10).max(2000),
  priority: z.enum(['low', 'medium', 'high', 'critical']),
  dueDate: z.string().datetime({ offset: true }).optional(),
  tags: z.array(z.string().max(50)).max(20).optional().default([]),
  metadata: metadataSchema,
  assignedTo: z.string().uuid().optional(),
});

// ── Sanitise text to prevent stored XSS

function sanitize(text: string): string {
  return sanitizeHtml(text, { allowedTags: [], allowedAttributes: {} }).trim();
}

// ── Route handler 

router.post('/',
  requireAuth,
  requireRole('analyst', 'admin'),
  (req: Request, res: Response) => {
    const log = reqLogger(req.requestId);

    // ── Idempotency check 
    const idempKey = req.headers['idempotency-key'] as string | undefined;
    if (idempKey) {
      const cached = idempotencyCache.get(idempKey);
      if (cached) {
        log.info('report:idempotency_hit', { idempKey });
        res.status(cached.statusCode).json(cached.body);
        return;
      }
    }

    // ── Payload validation 
    const parsed = createReportSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request payload.', parsed.error.errors.map(e => ({
        field: e.path.join('.'),
        code: e.code,
        message: e.message,
        rejectedValue: e.path.reduce((o: unknown, k) => {
          if (o && typeof o === 'object') return (o as Record<string, unknown>)[k as string];
          return undefined;
        }, req.body),
      })));
    }

    const data = parsed.data;

    // ── Sanitise free-text fields
    data.title = sanitize(data.title);
    data.summary = sanitize(data.summary);
    data.tags = data.tags.map(sanitize);

    // ── Business invariant
    let slug = generateSlug(data.title);
    if (store.slugExists(slug)) {
      // Append a short suffix to de-collide
      slug = `${slug}-${Date.now().toString(36)}`;
      if (store.slugExists(slug)) {
        throw new ConflictError(
          `A report with a similar title already exists. Choose a distinct title.`,
          [{ field: 'title', code: 'DUPLICATE_SLUG', message: 'Title produces a duplicate slug.' }]
        );
      }
    }

    // ── Validate assignedTo user exists 
    if (data.assignedTo && !store.getUserById(data.assignedTo)) {
      throw new ValidationError('Invalid assignedTo user.', [
        { field: 'assignedTo', code: 'NOT_FOUND', message: 'User not found.' },
      ]);
    }

    // ── Build & persist 
    const now = new Date().toISOString();
    const report: Report = {
      id: store.generateId(),
      slug,
      title: data.title,
      summary: data.summary,
      status: 'draft',
      priority: data.priority,
      authorId: req.user!.id,
      assignedTo: data.assignedTo,
      metadata: {
        ...data.metadata,
        reviewers: data.metadata.reviewers ?? [],
      },
      entries: [],
      comments: [],
      attachments: [],
      tags: data.tags,
      version: 1,
      dueDate: data.dueDate,
      createdAt: now,
      updatedAt: now,
    };

    store.saveReport(report);

    // ── Audit 
    recordAudit('report.created', req.user!, req, report.id, 'report', { after: report });

    // ── Async side effects (non-blocking) 
    const jobPayload = { reportId: report.id, slug: report.slug, authorId: report.authorId };
    enqueue('report.created.notify', jobPayload);
    enqueue('report.created.index', jobPayload);

    log.info('report:created', { reportId: report.id, slug, userId: req.user!.id });

    const responseBody = buildReportResponse(report, { include: ['metrics'] });
    const completionScore = computeCompletionScore(report);

    const fullResponse = {
      ...responseBody,
      _hints: canPublish(report)
        ? []
        : [`completionScore is ${completionScore}/100. Score must be ≥70 to publish.`],
    };

    // Cache for idempotency
    if (idempKey) {
      idempotencyCache.set(idempKey, { statusCode: 201, body: fullResponse });
      // Evict after 24 h
      setTimeout(() => idempotencyCache.delete(idempKey), 24 * 60 * 60 * 1000);
    }

    res
      .status(201)
      .setHeader('Location', `/reports/${report.id}`)
      .json(fullResponse);
  }
);

export default router;
