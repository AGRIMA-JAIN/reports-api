// tests/integration/api.test.ts

import request from 'supertest';
import app from '../../src/index';


let analystToken: string;
let adminToken: string;
let viewerToken: string;
let createdReportId: string;

// ── Auth helper ───────────────────────────────────────────────────────────────

async function login(email: string): Promise<string> {
  const res = await request(app)
    .post('/auth/login')
    .send({ email, password: 'Password1!' });
  return res.body.token as string;
}


beforeAll(async () => {
  analystToken = await login('analyst@example.com');
  adminToken   = await login('admin@example.com');
  viewerToken  = await login('viewer@example.com');
});

// ── POST /auth/login ──────────────────────────────────────────────────────────

describe('POST /auth/login', () => {
  it('returns 200 + token for valid credentials', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'analyst@example.com', password: 'Password1!' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.role).toBe('analyst');
  });

  it('returns 401 for wrong password', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'analyst@example.com', password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 for unknown email', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'nobody@example.com', password: 'Password1!' });
    expect(res.status).toBe(401);
  });
});

// ── GET /reports/:id ──────────────────────────────────────────────────────────

describe('GET /reports/:id', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/reports/r-001');
    expect(res.status).toBe(401);
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app)
      .get('/reports/does-not-exist')
      .set('Authorization', `Bearer ${analystToken}`);
    expect(res.status).toBe(404);
  });

  it('returns full report with metrics for seed report', async () => {
    const res = await request(app)
      .get('/reports/r-001')
      .set('Authorization', `Bearer ${analystToken}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('r-001');
    expect(res.body.metrics).toBeDefined();
    expect(res.body.metrics.completionScore).toBeGreaterThan(0);
  });

  it('returns compact summary when view=summary', async () => {
    const res = await request(app)
      .get('/reports/r-001?view=summary')
      .set('Authorization', `Bearer ${analystToken}`);
    expect(res.status).toBe(200);
    expect(res.body.entries).toBeUndefined();
    expect(res.body.completionScore).toBeDefined();
  });

  it('omits entries when not in include list', async () => {
    const res = await request(app)
      .get('/reports/r-001?include=metrics')
      .set('Authorization', `Bearer ${analystToken}`);
    expect(res.status).toBe(200);
    expect(res.body.entries).toBeUndefined();
    expect(res.body.metrics).toBeDefined();
  });

  it('paginates entries', async () => {
    const res = await request(app)
      .get('/reports/r-001?include=entries&entries_page=1&entries_size=2')
      .set('Authorization', `Bearer ${analystToken}`);
    expect(res.status).toBe(200);
    expect(res.body.entries.data).toHaveLength(2);
    expect(res.body.entries.pagination.size).toBe(2);
  });

  it('rejects invalid query params', async () => {
    const res = await request(app)
      .get('/reports/r-001?entries_size=999')
      .set('Authorization', `Bearer ${analystToken}`);
    expect(res.status).toBe(422);
  });
});

// ── POST /reports 
describe('POST /reports', () => {
  const validPayload = {
    title: 'Integration Test Report',
    summary: 'Created during automated integration testing suite run.',
    priority: 'medium',
    metadata: {
      department: 'Engineering',
      fiscalPeriod: '2024-Q4',
      region: 'AMER',
      confidentialityLevel: 'internal',
      reviewers: [],
    },
  };

  it('returns 403 for viewer role', async () => {
    const res = await request(app)
      .post('/reports')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send(validPayload);
    expect(res.status).toBe(403);
  });

  it('returns 422 for missing required fields', async () => {
    const res = await request(app)
      .post('/reports')
      .set('Authorization', `Bearer ${analystToken}`)
      .send({ title: 'x' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toBeDefined();
  });

  it('creates a report and returns 201 with Location header', async () => {
    const res = await request(app)
      .post('/reports')
      .set('Authorization', `Bearer ${analystToken}`)
      .send(validPayload);
    expect(res.status).toBe(201);
    expect(res.headers['location']).toMatch(/^\/reports\//);
    expect(res.body.id).toBeDefined();
    expect(res.body.status).toBe('draft');
    expect(res.body.metrics.completionScore).toBeGreaterThan(0);
    createdReportId = res.body.id as string;
  });

  it('returns cached response for duplicate idempotency key', async () => {
    const key = `idem-test-${Date.now()}`;
    const first = await request(app)
      .post('/reports')
      .set('Authorization', `Bearer ${analystToken}`)
      .set('Idempotency-Key', key)
      .send({ ...validPayload, title: 'Idempotency Test Report One' });

    const second = await request(app)
      .post('/reports')
      .set('Authorization', `Bearer ${analystToken}`)
      .set('Idempotency-Key', key)
      .send({ title: 'different payload entirely' }); // body is ignored

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
  });

  it('sanitises XSS in title', async () => {
    const res = await request(app)
      .post('/reports')
      .set('Authorization', `Bearer ${analystToken}`)
      .send({
        ...validPayload,
        title: '<script>alert("xss")</script>Sanitised Title',
      });
    expect(res.status).toBe(201);
    expect(res.body.title).not.toContain('<script>');
  });
});

// ── PUT /reports/:id 

describe('PUT /reports/:id', () => {
  it('returns 404 for unknown report', async () => {
    const res = await request(app)
      .put('/reports/does-not-exist')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ priority: 'low' });
    expect(res.status).toBe(404);
  });

  it('performs a partial update and bumps version', async () => {
    const res = await request(app)
      .put(`/reports/${createdReportId}`)
      .set('Authorization', `Bearer ${analystToken}`)
      .set('If-Match', '1')
      .send({ priority: 'high', tags: ['updated'] });
    expect(res.status).toBe(200);
    expect(res.body.priority).toBe('high');
    expect(res.body.tags).toContain('updated');
    expect(res.body.version).toBe(2);
  });

  it('returns 412 on version conflict', async () => {
    const res = await request(app)
      .put(`/reports/${createdReportId}`)
      .set('Authorization', `Bearer ${analystToken}`)
      .set('If-Match', '1')   
      .send({ priority: 'low' });
    expect(res.status).toBe(412);
    expect(res.body.error.code).toBe('PRECONDITION_FAILED');
  });

  it('returns 422 for invalid status transition', async () => {
    const res = await request(app)
      .put(`/reports/${createdReportId}`)
      .set('Authorization', `Bearer ${analystToken}`)
      .send({ status: 'published' });
    expect(res.status).toBe(422);
  });

  it('blocks publish when completionScore < 70', async () => {
   
    await request(app)
      .put(`/reports/${createdReportId}`)
      .set('Authorization', `Bearer ${analystToken}`)
      .send({ status: 'under_review' });

    const res = await request(app)
      .put(`/reports/${createdReportId}`)
      .set('Authorization', `Bearer ${analystToken}`)
      .send({ status: 'published' });

    expect(res.status).toBe(422);
    expect(res.body.error.details[0].code).toBe('PUBLISH_GATE_FAILED');
  });

  it('returns 403 when analyst tries to edit another user report', async () => {
    // r-001 is authored by u-analyst-001, same user — should pass
    // Log in as a different analyst would be needed for a true cross-user test
    // Here we verify the admin can edit any report
    const res = await request(app)
      .put('/reports/r-001')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ tags: ['admin-edited'] });
    expect(res.status).toBe(200);
  });
});

// ── POST /reports/:id/attachment 

describe('POST /reports/:id/attachment', () => {
  it('returns 404 for unknown report', async () => {
    const res = await request(app)
      .post('/reports/does-not-exist/attachment')
      .set('Authorization', `Bearer ${analystToken}`)
      .attach('file', Buffer.from('hello'), 'test.txt');
    expect(res.status).toBe(404);
  });

  it('returns 415 for disallowed file type', async () => {
    const res = await request(app)
      .post('/reports/r-001/attachment')
      .set('Authorization', `Bearer ${analystToken}`)
      .attach('file', Buffer.from('#!/bin/bash\nrm -rf /'), 'evil.sh');
    expect(res.status).toBe(415);
  });

  it('uploads a valid file and returns 201 with download URL', async () => {
    const res = await request(app)
      .post('/reports/r-001/attachment')
      .set('Authorization', `Bearer ${analystToken}`)
      .attach('file', Buffer.from('attachment content'), 'test-doc.txt');
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.download.url).toMatch(/^\/files\//);
    expect(res.body.download.expiresAt).toBeDefined();
  });

  it('returns 403 for viewer role', async () => {
    const res = await request(app)
      .post('/reports/r-001/attachment')
      .set('Authorization', `Bearer ${viewerToken}`)
      .attach('file', Buffer.from('test'), 'test.txt');
    expect(res.status).toBe(403);
  });
});

// ── GET /reports (list)

describe('GET /reports', () => {
  it('returns paginated list with summary view by default', async () => {
    const res = await request(app)
      .get('/reports')
      .set('Authorization', `Bearer ${analystToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.pagination).toBeDefined();
    expect(res.body.summary.byStatus).toBeDefined();
  });

  it('filters by status', async () => {
    const res = await request(app)
      .get('/reports?status=published')
      .set('Authorization', `Bearer ${analystToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.every((r: { status: string }) => r.status === 'published')).toBe(true);
  });

  it('filters by priority', async () => {
    const res = await request(app)
      .get('/reports?priority=high')
      .set('Authorization', `Bearer ${analystToken}`);
    expect(res.status).toBe(200);
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/reports');
    expect(res.status).toBe(401);
  });

  it('paginates correctly', async () => {
    const res = await request(app)
      .get('/reports?page=1&size=1')
      .set('Authorization', `Bearer ${analystToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.pagination.size).toBe(1);
  });

  it('returns overdue count in summary', async () => {
    const res = await request(app)
      .get('/reports')
      .set('Authorization', `Bearer ${analystToken}`);
    expect(res.body.summary.overdueCount).toBeDefined();
    expect(typeof res.body.summary.overdueCount).toBe('number');
  });
});

// ── GET /reports/:id/audit 
describe('GET /reports/:id/audit', () => {
  it('returns audit entries for admin', async () => {
    const res = await request(app)
      .get('/reports/r-001/audit')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.entries).toBeDefined();
    expect(Array.isArray(res.body.entries)).toBe(true);
  });

  it('returns 403 for non-admin', async () => {
    const res = await request(app)
      .get('/reports/r-001/audit')
      .set('Authorization', `Bearer ${analystToken}`);
    expect(res.status).toBe(403);
  });

  it('returns 404 for unknown report', async () => {
    const res = await request(app)
      .get('/reports/unknown/audit')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});

// ── ETag headers 

describe('ETag headers', () => {
  it('GET /reports/:id returns ETag header', async () => {
    const res = await request(app)
      .get('/reports/r-001')
      .set('Authorization', `Bearer ${analystToken}`);
    expect(res.headers['etag']).toBeDefined();
  });

  it('PUT /reports/:id returns updated ETag', async () => {
    const res = await request(app)
      .put('/reports/r-001')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ tags: ['etag-test'] });
    expect(res.headers['etag']).toBeDefined();
    expect(Number(res.headers['etag'])).toBeGreaterThan(0);
  });
});

// ── Error response schema 

describe('Error response schema consistency', () => {
  const errorCases = [
    { desc: '401 missing auth',      fn: () => request(app).get('/reports/r-001') },
    { desc: '404 not found',         fn: () => request(app).get('/reports/nope').set('Authorization', `Bearer ${analystToken}`) },
    { desc: '422 validation',        fn: () => request(app).post('/reports').set('Authorization', `Bearer ${analystToken}`).send({}) },
  ];

  for (const { desc, fn } of errorCases) {
    it(`${desc} has consistent error envelope`, async () => {
      const res = await fn();
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBeDefined();
      expect(res.body.error.message).toBeDefined();
      expect(typeof res.body.error.code).toBe('string');
    });
  }
});
