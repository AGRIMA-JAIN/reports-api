// src/services/reportService.ts

import {
  Report,
  ReportMetrics,
  ReportEntry,
  EntryCategory,
  ReportPriority,
  ReportStatus,
} from '../types';

// ── Custom Business Rule: Completion Score 

export function computeCompletionScore(report: Report): number {
  let score = 0;

  if (report.title?.trim() && report.summary?.trim()) score += 20;

  const hasFindings = report.entries.some(e => e.category === 'finding');
  if (hasFindings) score += 20;

  const hasRecommendations = report.entries.some(e => e.category === 'recommendation');
  if (hasRecommendations) score += 20;

  const criticals = report.entries.filter(e => e.priority === 'critical');
  const allCriticalsFilled = criticals.length === 0 || criticals.every(e => e.body?.trim());
  if (allCriticalsFilled) score += 15;

  if (report.metadata.reviewers.length > 0) score += 10;
  if (report.dueDate) score += 10;
  if (report.attachments.length > 0) score += 5;

  return Math.min(100, score);
}

export function canPublish(report: Report): boolean {
  return computeCompletionScore(report) >= 70;
}

// ── Trend Indicator

function computeTrend(report: Report): ReportMetrics['trendIndicator'] {
  const daysSince = daysSinceLastUpdate(report);
  if (daysSince > 30) return 'declining';
  if (report.status === 'published') return 'stable';
  if (daysSince <= 7) return 'improving';
  return 'stable';
}

function daysSinceLastUpdate(report: Report): number {
  return Math.floor(
    (Date.now() - new Date(report.updatedAt).getTime()) / (1000 * 60 * 60 * 24)
  );
}

// ── Metrics computation 

export function computeMetrics(report: Report): ReportMetrics {
  const categories: Record<EntryCategory, number> = {
    observation: 0,
    finding: 0,
    recommendation: 0,
    action_item: 0,
  };
  const priorities: Record<ReportPriority, number> = {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };

  for (const e of report.entries) {
    categories[e.category] = (categories[e.category] ?? 0) + 1;
    priorities[e.priority] = (priorities[e.priority] ?? 0) + 1;
  }

  const totalAttachmentBytes = report.attachments.reduce(
    (sum, a) => sum + a.sizeBytes, 0
  );

  const days = daysSinceLastUpdate(report);
  const isOverdue =
    !!report.dueDate &&
    new Date(report.dueDate) < new Date() &&
    report.status !== 'published';

  return {
    totalEntries: report.entries.length,
    entriesByCategory: categories,
    entriesByPriority: priorities,
    totalComments: report.comments.length,
    totalAttachments: report.attachments.length,
    attachmentsTotalBytes: totalAttachmentBytes,
    criticalFindingsCount: report.entries.filter(
      e => e.priority === 'critical' && e.category === 'finding'
    ).length,
    completionScore: computeCompletionScore(report),
    trendIndicator: computeTrend(report),
    daysSinceLastUpdate: days,
    isOverdue,
  };
}

// ── Response shape builders 

export interface GetReportOptions {
  include?: string[];          // 'entries' | 'comments' | 'metrics' | 'attachments'
  view?: 'full' | 'summary';
  entriesPage?: number;
  entriesSize?: number;
  entriesSort?: 'createdAt' | 'priority';
  entriesSortDir?: 'asc' | 'desc';
  entriesFilter?: string;      // category filter
}

const PRIORITY_ORDER: Record<ReportPriority, number> = {
  critical: 4, high: 3, medium: 2, low: 1,
};

export function buildReportResponse(
  report: Report,
  opts: GetReportOptions = {}
): Record<string, unknown> {
  const {
    include = ['entries', 'comments', 'metrics', 'attachments'],
    view = 'full',
    entriesPage = 1,
    entriesSize = 20,
    entriesSort = 'createdAt',
    entriesSortDir = 'desc',
    entriesFilter,
  } = opts;

  // Strip sensitive storage paths from attachments
  const safeAttachments = report.attachments.map(({ storagePath: _sp, ...rest }) => rest);

  if (view === 'summary') {
    // ── Compact flat summary
    const metrics = computeMetrics(report);
    return {
      id: report.id,
      slug: report.slug,
      title: report.title,
      status: report.status,
      priority: report.priority,
      completionScore: metrics.completionScore,
      trendIndicator: metrics.trendIndicator,
      isOverdue: metrics.isOverdue,
      totalEntries: metrics.totalEntries,
      criticalFindings: metrics.criticalFindingsCount,
      totalAttachments: metrics.totalAttachments,
      department: report.metadata.department,
      fiscalPeriod: report.metadata.fiscalPeriod,
      region: report.metadata.region,
      dueDate: report.dueDate ?? null,
      updatedAt: report.updatedAt,
    };
  }

  // ── Full hierarchical response
  const result: Record<string, unknown> = {
    id: report.id,
    slug: report.slug,
    title: report.title,
    summary: report.summary,
    status: report.status,
    priority: report.priority,
    authorId: report.authorId,
    assignedTo: report.assignedTo ?? null,
    tags: report.tags,
    version: report.version,
    publishedAt: report.publishedAt ?? null,
    dueDate: report.dueDate ?? null,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
    metadata: report.metadata,
  };

  if (include.includes('metrics')) {
    result['metrics'] = computeMetrics(report);
  }

  if (include.includes('entries')) {
    let entries: ReportEntry[] = [...report.entries];

    // Filter by category
    if (entriesFilter) {
      entries = entries.filter(e => e.category === entriesFilter);
    }

    // Sort
    entries.sort((a, b) => {
      if (entriesSort === 'priority') {
        const diff = PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority];
        return entriesSortDir === 'asc' ? -diff : diff;
      }
      // Default: createdAt
      const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return entriesSortDir === 'asc' ? diff : -diff;
    });

    // Paginate
    const total = entries.length;
    const start = (entriesPage - 1) * entriesSize;
    const paged = entries.slice(start, start + entriesSize);

    result['entries'] = {
      data: paged,
      pagination: {
        page: entriesPage,
        size: entriesSize,
        total,
        totalPages: Math.ceil(total / entriesSize),
        hasNextPage: start + entriesSize < total,
        hasPrevPage: entriesPage > 1,
      },
    };
  }

  if (include.includes('comments')) {
    result['comments'] = report.comments;
  }

  if (include.includes('attachments')) {
    result['attachments'] = safeAttachments;
  }

  return result;
}

// ── Slug generation 

export function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
}

// ── Status transition guard 

const VALID_TRANSITIONS: Record<ReportStatus, ReportStatus[]> = {
  draft: ['under_review', 'archived'],
  under_review: ['draft', 'published', 'archived'],
  published: ['archived'],
  archived: [],
};

export function isValidTransition(from: ReportStatus, to: ReportStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}
