// src/routes/auditRoutes.ts
import { Router, Request, Response } from 'express';
import { store } from '../models/store';
import { requireAuth, requireRole } from '../middleware/auth';
import { NotFoundError } from '../utils/errors';
import { reqLogger } from '../utils/logger';

const router = Router({ mergeParams: true });

router.get('/',
  requireAuth,
  requireRole('admin'),
  (req: Request, res: Response) => {
    const log = reqLogger(req.requestId);

    const report = store.getReportById(req.params['id']);
    if (!report) throw new NotFoundError('Report', req.params['id']);

    const entries = store.getAuditForResource(report.id);

    log.info('audit:retrieved', {
      reportId: report.id,
      entryCount: entries.length,
      userId: req.user!.id,
    });

    res.json({
      reportId: report.id,
      total: entries.length,
      entries: entries.sort((a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      ),
    });
  }
);

export default router;