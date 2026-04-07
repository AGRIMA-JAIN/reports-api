// src/models/store.ts

import {
  Report,
  User,
  AuditEntry,
  Job,
  Attachment,
} from '../types';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

// ── Seed data 

const SEED_PASSWORD_HASH = bcrypt.hashSync('Password1!', 10);

const seedUsers: User[] = [
  {
    id: 'u-admin-001',
    email: 'admin@example.com',
    name: 'Alice Admin',
    role: 'admin',
    passwordHash: SEED_PASSWORD_HASH,
    createdAt: new Date('2024-01-01').toISOString(),
  },
  {
    id: 'u-analyst-001',
    email: 'analyst@example.com',
    name: 'Bob Analyst',
    role: 'analyst',
    passwordHash: SEED_PASSWORD_HASH,
    createdAt: new Date('2024-01-02').toISOString(),
  },
  {
    id: 'u-viewer-001',
    email: 'viewer@example.com',
    name: 'Carol Viewer',
    role: 'viewer',
    passwordHash: SEED_PASSWORD_HASH,
    createdAt: new Date('2024-01-03').toISOString(),
  },
];

const seedReports: Report[] = [
  {
    id: 'r-001',
    slug: 'q3-ops-2024',
    title: 'Q3 Operations Report 2024',
    summary: 'Comprehensive analysis of Q3 operational performance across all regions.',
    status: 'published',
    priority: 'high',
    authorId: 'u-analyst-001',
    assignedTo: 'u-analyst-001',
    metadata: {
      department: 'Operations',
      fiscalPeriod: '2024-Q3',
      region: 'AMER',
      confidentialityLevel: 'internal',
      reviewers: ['u-admin-001'],
      externalRef: 'JIRA-1042',
    },
    entries: [
      {
        id: 'e-001',
        reportId: 'r-001',
        category: 'finding',
        title: 'Supply chain delays in Q3',
        body: 'Average lead times increased by 14% compared to Q2.',
        priority: 'high',
        tags: ['supply-chain', 'logistics'],
        createdAt: new Date('2024-09-01').toISOString(),
        updatedAt: new Date('2024-09-01').toISOString(),
        createdBy: 'u-analyst-001',
      },
      {
        id: 'e-002',
        reportId: 'r-001',
        category: 'recommendation',
        title: 'Diversify supplier base',
        body: 'Recommend onboarding at least 2 alternative suppliers per critical SKU.',
        priority: 'critical',
        tags: ['supply-chain', 'risk-mitigation'],
        createdAt: new Date('2024-09-02').toISOString(),
        updatedAt: new Date('2024-09-05').toISOString(),
        createdBy: 'u-analyst-001',
      },
      {
        id: 'e-003',
        reportId: 'r-001',
        category: 'observation',
        title: 'Customer satisfaction stable',
        body: 'NPS held at 42 despite operational headwinds.',
        priority: 'medium',
        tags: ['customer-success'],
        createdAt: new Date('2024-09-10').toISOString(),
        updatedAt: new Date('2024-09-10').toISOString(),
        createdBy: 'u-analyst-001',
      },
      {
        id: 'e-004',
        reportId: 'r-001',
        category: 'action_item',
        title: 'Initiate supplier RFQ process',
        body: 'Procurement to issue RFQ by 2024-10-15.',
        priority: 'high',
        tags: ['procurement'],
        createdAt: new Date('2024-09-12').toISOString(),
        updatedAt: new Date('2024-09-12').toISOString(),
        createdBy: 'u-admin-001',
      },
    ],
    comments: [
      {
        id: 'c-001',
        reportId: 'r-001',
        authorId: 'u-admin-001',
        authorName: 'Alice Admin',
        body: 'Good work — please add risk ratings to each finding.',
        createdAt: new Date('2024-09-15').toISOString(),
      },
    ],
    attachments: [],
    tags: ['operations', 'quarterly', '2024'],
    version: 3,
    publishedAt: new Date('2024-09-20').toISOString(),
    dueDate: new Date('2024-10-01').toISOString(),
    createdAt: new Date('2024-08-15').toISOString(),
    updatedAt: new Date('2024-09-20').toISOString(),
  },
];

// ── In-memory collections 

class InMemoryStore {
  private users: Map<string, User> = new Map();
  private usersByEmail: Map<string, User> = new Map();
  private reports: Map<string, Report> = new Map();
  private reportsBySlug: Map<string, Report> = new Map();
  private auditLog: AuditEntry[] = [];
  private jobQueue: Map<string, Job> = new Map();

  constructor() {
    for (const u of seedUsers) {
      this.users.set(u.id, u);
      this.usersByEmail.set(u.email, u);
    }
    for (const r of seedReports) {
      this.reports.set(r.id, r);
      this.reportsBySlug.set(r.slug, r);
    }
  }

  // ── Users 

  getUserById(id: string): User | undefined {
    return this.users.get(id);
  }

  getUserByEmail(email: string): User | undefined {
    return this.usersByEmail.get(email);
  }

  // ── Reports
  getReportById(id: string): Report | undefined {
    return this.reports.get(id);
  }

  getReportBySlug(slug: string): Report | undefined {
    return this.reportsBySlug.get(slug);
  }

  getAllReports(): Report[] {
    return Array.from(this.reports.values());
  }

  saveReport(report: Report): void {
    this.reports.set(report.id, report);
    this.reportsBySlug.set(report.slug, report);
  }

  slugExists(slug: string, excludeId?: string): boolean {
    const existing = this.reportsBySlug.get(slug);
    if (!existing) return false;
    if (excludeId && existing.id === excludeId) return false;
    return true;
  }

  // ── Audit Log 

  appendAudit(entry: AuditEntry): void {
    this.auditLog.push(entry);
  }

  getAuditForResource(resourceId: string): AuditEntry[] {
    return this.auditLog.filter(e => e.resourceId === resourceId);
  }

  // ── Job Queue 

  enqueueJob(job: Job): void {
    this.jobQueue.set(job.id, job);
  }

  getJob(id: string): Job | undefined {
    return this.jobQueue.get(id);
  }

  updateJob(job: Job): void {
    this.jobQueue.set(job.id, job);
  }

  getPendingJobs(): Job[] {
    const now = new Date().toISOString();
    return Array.from(this.jobQueue.values()).filter(
      j => (j.status === 'queued' || j.status === 'processing') && j.nextRunAt <= now
    );
  }

  // ── Attachments (stored inline on Report) 

  addAttachment(reportId: string, attachment: Attachment): boolean {
    const report = this.reports.get(reportId);
    if (!report) return false;
    report.attachments.push(attachment);
    return true;
  }

  getAttachment(reportId: string, attachmentId: string): Attachment | undefined {
    return this.reports.get(reportId)?.attachments.find(a => a.id === attachmentId);
  }

  updateAttachment(reportId: string, attachment: Attachment): boolean {
    const report = this.reports.get(reportId);
    if (!report) return false;
    const idx = report.attachments.findIndex(a => a.id === attachment.id);
    if (idx === -1) return false;
    report.attachments[idx] = attachment;
    return true;
  }

  generateId(): string {
    return uuidv4();
  }
}

// Singleton export
export const store = new InMemoryStore();
