// src/routes/getReport.ts

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { store } from '../models/store';
import { requireAuth, requireRole } from '../middleware/auth';
import { NotFoundError, ValidationError } from '../utils/errors';
import { buildReportResponse, GetReportOptions } from '../services/reportService';
import { reqLogger } from '../utils/logger';

const router = Router();

const querySchema = z.object({
  view: z.enum(['full', 'summary']).optional().default('full'),
  include: z.string().optional(),
  entries_page: z.coerce.number().int().min(1).optional().default(1),
  entries_size: z.coerce.number().int().min(1).max(100).optional().default(20),
  entries_sort: z.enum(['createdAt', 'priority']).optional().default('createdAt'),
  entries_sort_dir: z.enum(['asc', 'desc']).optional().default('desc'),
  entries_filter: z.enum(['observation', 'finding', 'recommendation', 'action_item']).optional(),
});

router.get('/:id',
  requireAuth,
  requireRole('viewer', 'analyst', 'admin'),
  (req: Request, res: Response) => {
    const log = reqLogger(req.requestId);
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError('Invalid query parameters.', parsed.error.errors.map(e => ({
        field: e.path.join('.'),
        code: e.code,
        message: e.message,
      })));
    }

    const q = parsed.data;
    const report = store.getReportById(req.params.id);
    if (!report) throw new NotFoundError('Report', req.params.id);

    // Confidential reports: only admin or the assigned analyst can view
    if (
      report.metadata.confidentialityLevel === 'restricted' &&
      req.user!.role !== 'admin' &&
      req.user!.id !== report.authorId &&
      req.user!.id !== report.assignedTo
    ) {
      throw new NotFoundError('Report', req.params.id); // 404, not 403 – avoids leaking existence
    }

    // Parse ?include= CSV
    const include: string[] | undefined = q.include
      ? q.include.split(',').map(s => s.trim()).filter(Boolean)
      : undefined;

    const opts: GetReportOptions = {
      view: q.view,
      include,
      entriesPage: q.entries_page,
      entriesSize: q.entries_size,
      entriesSort: q.entries_sort,
      entriesSortDir: q.entries_sort_dir,
      entriesFilter: q.entries_filter,
    };

    const body = buildReportResponse(report, opts);

    log.info('report:fetched', { reportId: report.id, view: q.view, userId: req.user!.id });
    res.setHeader('ETag', String(report.version));
    res.json(body);
  }
);

export default router;
