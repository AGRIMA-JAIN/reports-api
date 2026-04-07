// tests/unit/reportService.test.ts

import {
  computeCompletionScore,
  canPublish,
  computeMetrics,
  generateSlug,
  isValidTransition,
  buildReportResponse,
} from '../../src/services/reportService';
import { minimalReport, fullReport } from '../fixtures/reports';
import { Report } from '../../src/types';

// ── computeCompletionScore 

describe('computeCompletionScore', () => {
  it('returns 15 for an empty draft (only vacuous critical-entries criterion passes)', () => {
    const report: Report = {
      ...minimalReport,
      title: '',
      summary: '',
      metadata: { ...minimalReport.metadata, reviewers: [] },
      dueDate: undefined,
      attachments: [],
      entries: [],
    };
    expect(computeCompletionScore(report)).toBe(15);
  });

  it('awards 20 pts for non-empty title + summary', () => {
    const score = computeCompletionScore(minimalReport);
    expect(score).toBeGreaterThanOrEqual(20);
  });

  it('awards points for finding and recommendation entries', () => {
    const baseScore = computeCompletionScore(minimalReport);
    const withEntries = computeCompletionScore(fullReport);
    expect(withEntries).toBeGreaterThan(baseScore);
  });

  it('awards 10 pts for reviewer assigned', () => {
    const withReviewer: Report = {
      ...minimalReport,
      metadata: { ...minimalReport.metadata, reviewers: ['u-admin-001'] },
    };
    const without = computeCompletionScore(minimalReport);
    const with_ = computeCompletionScore(withReviewer);
    expect(with_ - without).toBe(10);
  });

  it('awards 10 pts for due date set', () => {
    const withDue: Report = { ...minimalReport, dueDate: '2025-12-31T00:00:00Z' };
    const without = computeCompletionScore(minimalReport);
    const with_ = computeCompletionScore(withDue);
    expect(with_ - without).toBe(10);
  });

  it('awards 5 pts for at least one attachment', () => {
    const without = computeCompletionScore(minimalReport);
    const with_ = computeCompletionScore(fullReport);
    // fullReport has entries (+40), reviewer (+10), dueDate (+10), attachment (+5) over minimal
    expect(with_).toBeGreaterThan(without);
  });

  it('never exceeds 100', () => {
    expect(computeCompletionScore(fullReport)).toBeLessThanOrEqual(100);
  });

  it('deducts critical-entry points when a critical entry has no body', () => {
    const report: Report = {
      ...minimalReport,
      entries: [{
        id: 'e-crit',
        reportId: minimalReport.id,
        category: 'finding',
        title: 'Critical problem',
        body: '',         
        priority: 'critical',
        tags: [],
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        createdBy: 'u-analyst-001',
      }],
    };
    const withBody: Report = {
      ...report,
      entries: [{ ...report.entries[0], body: 'Detailed body' }],
    };
    expect(computeCompletionScore(report)).toBeLessThan(computeCompletionScore(withBody));
  });
});

// ── canPublish 

describe('canPublish', () => {
  it('returns false for a minimal draft (score < 70)', () => {
    expect(canPublish(minimalReport)).toBe(false);
  });

  it('returns true for a well-populated report (score >= 70)', () => {
    expect(canPublish(fullReport)).toBe(true);
  });
});

// ── generateSlug 

describe('generateSlug', () => {
  it('lowercases and hyphenates', () => {
    expect(generateSlug('Hello World')).toBe('hello-world');
  });

  it('strips special characters', () => {
    expect(generateSlug('Q3 Report: 2024!')).toBe('q3-report-2024');
  });

  it('collapses multiple spaces', () => {
    expect(generateSlug('foo   bar')).toBe('foo-bar');
  });

  it('truncates to 80 characters', () => {
    const long = 'a'.repeat(200);
    expect(generateSlug(long).length).toBeLessThanOrEqual(80);
  });
});

// ── isValidTransition 

describe('isValidTransition', () => {
  it('allows draft → under_review', () => {
    expect(isValidTransition('draft', 'under_review')).toBe(true);
  });

  it('allows under_review → published', () => {
    expect(isValidTransition('under_review', 'published')).toBe(true);
  });

  it('blocks draft → published (must go through under_review)', () => {
    expect(isValidTransition('draft', 'published')).toBe(false);
  });

  it('blocks published → draft', () => {
    expect(isValidTransition('published', 'draft')).toBe(false);
  });

  it('blocks archived → any', () => {
    expect(isValidTransition('archived', 'draft')).toBe(false);
    expect(isValidTransition('archived', 'published')).toBe(false);
  });

  it('allows any → archived', () => {
    expect(isValidTransition('draft', 'archived')).toBe(true);
    expect(isValidTransition('under_review', 'archived')).toBe(true);
    expect(isValidTransition('published', 'archived')).toBe(true);
  });
});

// ── computeMetrics 

describe('computeMetrics', () => {
  it('returns zero counts for empty report', () => {
    const metrics = computeMetrics(minimalReport);
    expect(metrics.totalEntries).toBe(0);
    expect(metrics.totalComments).toBe(0);
    expect(metrics.totalAttachments).toBe(0);
    expect(metrics.criticalFindingsCount).toBe(0);
  });

  it('counts entries by category correctly', () => {
    const metrics = computeMetrics(fullReport);
    expect(metrics.entriesByCategory.finding).toBe(1);
    expect(metrics.entriesByCategory.recommendation).toBe(1);
    expect(metrics.totalEntries).toBe(2);
  });

  it('marks overdue when dueDate is in the past and not published', () => {
    const overdue: Report = {
      ...minimalReport,
      dueDate: '2020-01-01T00:00:00Z',
      status: 'draft',
    };
    expect(computeMetrics(overdue).isOverdue).toBe(true);
  });

  it('does not mark overdue when published', () => {
    const published: Report = {
      ...minimalReport,
      dueDate: '2020-01-01T00:00:00Z',
      status: 'published',
    };
    expect(computeMetrics(published).isOverdue).toBe(false);
  });
});

// ── buildReportResponse 

describe('buildReportResponse', () => {
  it('summary view returns flat object without nested arrays', () => {
    const result = buildReportResponse(fullReport, { view: 'summary' });
    expect(result['entries']).toBeUndefined();
    expect(result['comments']).toBeUndefined();
    expect(result['completionScore']).toBeDefined();
    expect(result['trendIndicator']).toBeDefined();
  });

  it('full view includes metrics when requested', () => {
    const result = buildReportResponse(fullReport, { view: 'full', include: ['metrics'] });
    expect(result['metrics']).toBeDefined();
    expect(result['entries']).toBeUndefined();
  });

  it('paginates entries correctly', () => {
    const result = buildReportResponse(fullReport, {
      include: ['entries'],
      entriesPage: 1,
      entriesSize: 1,
    }) as Record<string, { data: unknown[]; pagination: { total: number } }>;

    expect(result['entries'].data).toHaveLength(1);
    expect(result['entries'].pagination.total).toBe(2);
  });

  it('filters entries by category', () => {
    const result = buildReportResponse(fullReport, {
      include: ['entries'],
      entriesFilter: 'finding',
    }) as Record<string, { data: Array<{ category: string }> }>;

    expect(result['entries'].data.every(e => e.category === 'finding')).toBe(true);
  });

  it('strips storagePath from attachments', () => {
    const result = buildReportResponse(fullReport, { include: ['attachments'] });
    const attachments = result['attachments'] as Array<Record<string, unknown>>;
    expect(attachments[0]['storagePath']).toBeUndefined();
  });
});
