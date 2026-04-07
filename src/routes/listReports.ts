// src/routes/listReports.ts
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { store } from '../models/store';
import { requireAuth, requireRole } from '../middleware/auth';
import { ValidationError } from '../utils/errors';
import { buildReportResponse, computeMetrics } from '../services/reportService';
import { Report, ReportPriority } from '../types';
import { reqLogger } from '../utils/logger';

const router = Router();

const PRIORITY_ORDER: Record<ReportPriority, number> = {
  critical: 4, high: 3, medium: 2, low: 1,
};

const querySchema = z.object({
  page:       z.coerce.number().int().min(1).optional().default(1),
  size:       z.coerce.number().int().min(1).max(100).optional().default(20),
  status:     z.enum(['draft', 'under_review', 'published', 'archived']).optional(),
  priority:   z.enum(['low', 'medium', 'high', 'critical']).optional(),
  department: z.string().optional(),
  sort:       z.enum(['createdAt', 'updatedAt', 'priority', 'title']).optional().default('createdAt'),
  sort_dir:   z.enum(['asc', 'desc']).optional().default('desc'),
  view:       z.enum(['full', 'summary']).optional().default('summary'),
});

router.get('/',
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
    let reports: Report[] = store.getAllReports();

    // Non-admins cannot see restricted reports they don't own
    reports = reports.filter(r => {
      if (r.metadata.confidentialityLevel !== 'restricted') return true;
      if (req.user!.role === 'admin') return true;
      return r.authorId === req.user!.id || r.assignedTo === req.user!.id;
    });

    // Filters
    if (q.status)     reports = reports.filter(r => r.status === q.status);
    if (q.priority)   reports = reports.filter(r => r.priority === q.priority);
    if (q.department) reports = reports.filter(r =>
      r.metadata.department.toLowerCase().includes(q.department!.toLowerCase())
    );

    // Sort
    reports.sort((a, b) => {
      let diff = 0;
      switch (q.sort) {
        case 'priority':
          diff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
          break;
        case 'title':
          diff = a.title.localeCompare(b.title);
          break;
        case 'updatedAt':
          diff = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
          break;
        default:
          diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      }
      return q.sort_dir === 'asc' ? diff : -diff;
    });

    // Pagination
    const total = reports.length;
    const start = (q.page - 1) * q.size;
    const paged = reports.slice(start, start + q.size);

    const data = paged.map(r => buildReportResponse(r, { view: q.view, include: ['metrics'] }));

    log.info('reports:listed', { total, page: q.page, size: q.size, userId: req.user!.id });

    res.json({
      data,
      pagination: {
        page: q.page,
        size: q.size,
        total,
        totalPages: Math.ceil(total / q.size),
        hasNextPage: start + q.size < total,
        hasPrevPage: q.page > 1,
      },
      summary: {
        byStatus: {
          draft:        reports.filter(r => r.status === 'draft').length,
          under_review: reports.filter(r => r.status === 'under_review').length,
          published:    reports.filter(r => r.status === 'published').length,
          archived:     reports.filter(r => r.status === 'archived').length,
        },
        overdueCount: reports.filter(r => computeMetrics(r).isOverdue).length,
      },
    });
  }
);

export default router;