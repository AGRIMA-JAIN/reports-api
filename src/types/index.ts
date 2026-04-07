// src/types/index.ts

export type ReportStatus = 'draft' | 'under_review' | 'published' | 'archived';
export type ReportPriority = 'low' | 'medium' | 'high' | 'critical';
export type EntryCategory = 'observation' | 'finding' | 'recommendation' | 'action_item';
export type UserRole = 'viewer' | 'analyst' | 'admin';
export type AttachmentStatus = 'pending' | 'stored' | 'quarantined' | 'deleted';

// ── Core Domain Models

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  passwordHash: string;
  createdAt: string;
}

export interface ReportEntry {
  id: string;
  reportId: string;
  category: EntryCategory;
  title: string;
  body: string;
  priority: ReportPriority;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  createdBy: string; // userId
}

export interface Comment {
  id: string;
  reportId: string;
  entryId?: string;        // null = top-level report comment
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
  editedAt?: string;
}

export interface ReportMetadata {
  department: string;
  fiscalPeriod: string;    // e.g. "2024-Q3"
  region: string;
  confidentialityLevel: 'public' | 'internal' | 'confidential' | 'restricted';
  reviewers: string[];     // userIds
  externalRef?: string;    // e.g. ticket / CRM reference
}

export interface Attachment {
  id: string;
  reportId: string;
  filename: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  uploadedBy: string;
  uploadedAt: string;
  status: AttachmentStatus;
  // signed-URL token (rotated on each request)
  downloadToken?: string;
  downloadTokenExpiresAt?: string;
}

export interface Report {
  id: string;
  slug: string;            // unique human-readable business key  e.g. "q3-ops-2024"
  title: string;
  summary: string;
  status: ReportStatus;
  priority: ReportPriority;
  authorId: string;
  assignedTo?: string;     // analyst userId
  metadata: ReportMetadata;
  entries: ReportEntry[];
  comments: Comment[];
  attachments: Attachment[];
  tags: string[];
  version: number;         // optimistic concurrency counter
  publishedAt?: string;
  dueDate?: string;
  createdAt: string;
  updatedAt: string;
  // ── Computed 
  // These are derived at read time; NOT stored.
  metrics?: ReportMetrics;
}

export interface ReportMetrics {
  totalEntries: number;
  entriesByCategory: Record<EntryCategory, number>;
  entriesByPriority: Record<ReportPriority, number>;
  totalComments: number;
  totalAttachments: number;
  attachmentsTotalBytes: number;
  criticalFindingsCount: number;
  completionScore: number;       // 0–100, custom business rule (see design doc)
  trendIndicator: 'improving' | 'stable' | 'declining' | 'unknown';
  daysSinceLastUpdate: number;
  isOverdue: boolean;
}

// ── Audit Log 

export type AuditAction =
  | 'report.created'
  | 'report.updated'
  | 'report.status_changed'
  | 'attachment.uploaded'
  | 'attachment.downloaded'
  | 'user.login';

export interface AuditEntry {
  id: string;
  action: AuditAction;
  actorId: string;
  actorEmail: string;
  resourceId: string;
  resourceType: 'report' | 'attachment' | 'user';
  before?: Partial<Report>;
  after?: Partial<Report>;
  changedFields?: string[];
  ipAddress: string;
  userAgent: string;
  timestamp: string;
}

// ── Background Job Queue 

export type JobType = 'report.created.notify' | 'report.created.index';
export type JobStatus = 'queued' | 'processing' | 'done' | 'failed' | 'dead';

export interface Job {
  id: string;
  type: JobType;
  payload: Record<string, unknown>;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  nextRunAt: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

// ── API Contracts 

export interface ApiError {
  code: string;
  message: string;
  details?: FieldError[];
  requestId?: string;
}

export interface FieldError {
  field: string;
  code: string;
  message: string;
  rejectedValue?: unknown;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    size: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

// Augment Express Request with auth context
declare global {
  namespace Express {
    interface Request {
      user?: User;
      requestId: string;
    }
  }
}
