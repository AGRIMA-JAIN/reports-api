// src/index.ts


import 'express-async-errors'; // must be first import — patches async errors
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import { attachRequestId } from './middleware/requestContext';
import { globalErrorHandler } from './middleware/errorHandler';
import authRoutes from './routes/authRoutes';
import getReportRoute from './routes/getReport';
import postReportRoute from './routes/postReport';
import putReportRoute from './routes/putReport';
import attachmentRoutes from './routes/attachmentRoutes';
import fileRoutes from './routes/fileRoutes';
import { startWorker } from './jobs/jobQueue';
import { logger } from './utils/logger';
import listReportsRoute from './routes/listReports';
import auditRoutes from './routes/auditRoutes';

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// ── Security headers 
app.use(helmet());

// ── Request ID (must be very first middleware after helmet) 
app.use(attachRequestId);

// ── HTTP request logging (structured, skips health checks) 
app.use(
  morgan('combined', {
    stream: { write: (msg) => logger.http(msg.trim()) },
    skip: (req) => req.url === '/health',
  })
);

// ── Body parsers 
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// ── Global rate limiter 
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutes
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests — please slow down.' } },
});
app.use(limiter);

// Stricter limiter for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many login attempts.' } },
});

// ── Health check (unauthenticated) 
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ── Routes 
app.use('/auth', authLimiter, authRoutes);

app.use('/reports', listReportsRoute); // GET  /reports (list)
app.use('/reports', getReportRoute);   // GET  /reports/:id
app.use('/reports', postReportRoute);  // POST /reports
app.use('/reports', putReportRoute);   // PUT  /reports/:id

// Attachment sub-resource
app.use(
  '/reports/:id/attachment',
  (req, _res, next) => { (req.params as Record<string,string>)['id'] = req.params['id']; next(); },
  attachmentRoutes
);

// Audit trail (admin only)
app.use(
  '/reports/:id/audit',
  (req, _res, next) => { (req.params as Record<string,string>)['id'] = req.params['id']; next(); },
  auditRoutes
);

// Signed file download
app.use('/files', fileRoutes);

// ── 404 catch-all 
app.use((_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found.' } });
});

// ── Global error handler (must be last) 
app.use(globalErrorHandler);

// ── Start server 
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    logger.info('server:started', { port: PORT, env: process.env.NODE_ENV || 'development' });
  });

  startWorker(2_000);
}




export default app;
