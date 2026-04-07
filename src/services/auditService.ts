// src/services/auditService.ts

import { v4 as uuidv4 } from 'uuid';
import { store } from '../models/store';
import { AuditAction, AuditEntry, Report, User } from '../types';
import { logger } from '../utils/logger';
import { Request } from 'express';

export function recordAudit(
  action: AuditAction,
  actor: User,
  req: Request,
  resourceId: string,
  resourceType: AuditEntry['resourceType'],
  opts: {
    before?: Partial<Report>;
    after?: Partial<Report>;
    changedFields?: string[];
  } = {}
): void {
  const entry: AuditEntry = {
    id: uuidv4(),
    action,
    actorId: actor.id,
    actorEmail: actor.email,
    resourceId,
    resourceType,
    before: opts.before,
    after: opts.after,
    changedFields: opts.changedFields,
    ipAddress: (req.headers['x-forwarded-for'] as string) ?? req.ip ?? 'unknown',
    userAgent: req.headers['user-agent'] ?? 'unknown',
    timestamp: new Date().toISOString(),
  };

  store.appendAudit(entry);

  logger.info('audit', {
    auditId: entry.id,
    action,
    actorId: actor.id,
    actorEmail: actor.email,
    resourceId,
    resourceType,
    changedFields: opts.changedFields,
    requestId: req.requestId,
  });
}

/** Compute the set of top-level keys that differ between two objects. */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];
  for (const k of keys) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
      changed.push(k);
    }
  }
  return changed;
}
