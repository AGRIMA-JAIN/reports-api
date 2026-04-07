import { Report, User } from '../../src/types';

export const mockUser: User = {
  id: 'u-analyst-001',
  email: 'analyst@example.com',
  name: 'Bob Analyst',
  role: 'analyst',
  passwordHash: '$2a$10$placeholder',
  createdAt: '2024-01-01T00:00:00Z',
};

export const minimalReport: Report = {
  id: 'r-test-001',
  slug: 'test-report',
  title: 'Test Report',
  summary: 'A test report summary',
  status: 'draft',
  priority: 'medium',
  authorId: 'u-analyst-001',
  metadata: {
    department: 'Engineering',
    fiscalPeriod: '2024-Q4',
    region: 'AMER',
    confidentialityLevel: 'internal',
    reviewers: [],
  },
  entries: [],
  comments: [],
  attachments: [],
  tags: [],
  version: 1,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

export const fullReport: Report = {
  ...minimalReport,
  id: 'r-test-002',
  slug: 'full-report',
  title: 'Full Report',
  summary: 'A comprehensive test report with all fields populated',
  metadata: { ...minimalReport.metadata, reviewers: ['u-admin-001'] },
  dueDate: new Date(Date.now() + 86400000).toISOString(),
  entries: [
    {
      id: 'e-001',
      reportId: 'r-test-002',
      category: 'finding',
      title: 'Critical issue found',
      body: 'Detailed description of the finding',
      priority: 'high',
      tags: ['security'],
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      createdBy: 'u-analyst-001',
    },
    {
      id: 'e-002',
      reportId: 'r-test-002',
      category: 'recommendation',
      title: 'Fix the issue',
      body: 'Detailed recommendation',
      priority: 'high',
      tags: [],
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      createdBy: 'u-analyst-001',
    },
  ],
  attachments: [
    {
      id: 'att-001',
      reportId: 'r-test-002',
      filename: 'abc123.pdf',
      originalName: 'report.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      storagePath: '/uploads/abc123.pdf',
      uploadedBy: 'u-analyst-001',
      uploadedAt: '2024-01-01T00:00:00Z',
      status: 'stored',
    },
  ],
};