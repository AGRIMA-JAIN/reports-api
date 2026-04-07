# Reports API

Production-quality REST API built with **Node.js + TypeScript**.

---

## Quick Start

```bash
npm install
cp .env.example .env
npm run dev
# → http://localhost:3000
```

## Seed Credentials (password: `Password1!`)

| Email | Role |
|---|---|
| admin@example.com | admin |
| analyst@example.com | analyst |
| viewer@example.com | viewer |

---

## Authentication

```bash
# Get token
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"analyst@example.com","password":"Password1!"}' \
  | jq -r .token)

# Use token
curl http://localhost:3000/reports/r-001 -H "Authorization: Bearer $TOKEN"
```

---

## Endpoints

### GET /reports
```bash
curl http://localhost:3000/reports -H "Authorization: Bearer $TOKEN"
curl "http://localhost:3000/reports?status=published&sort=priority&page=1&size=5" -H "Authorization: Bearer $TOKEN"
```

### GET /reports/:id
```bash
# Full view
curl http://localhost:3000/reports/r-001 -H "Authorization: Bearer $TOKEN"

# Summary view
curl "http://localhost:3000/reports/r-001?view=summary" -H "Authorization: Bearer $TOKEN"

# Filtered entries
curl "http://localhost:3000/reports/r-001?include=entries,metrics&entries_filter=finding&entries_sort=priority" -H "Authorization: Bearer $TOKEN"
```

### POST /reports
```bash
curl -X POST http://localhost:3000/reports \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: unique-key-001" \
  -d '{
    "title": "Q4 Security Audit 2024",
    "summary": "Full audit of security controls for Q4.",
    "priority": "critical",
    "metadata": {
      "department": "InfoSec",
      "fiscalPeriod": "2024-Q4",
      "region": "GLOBAL",
      "confidentialityLevel": "internal",
      "reviewers": []
    }
  }'
```

**Required fields:** `title`, `summary`, `priority`, `metadata.department`, `metadata.fiscalPeriod`, `metadata.region`, `metadata.confidentialityLevel`

**Optional fields:** `dueDate`, `tags`, `assignedTo`, `metadata.reviewers`, `metadata.externalRef`

### PUT /reports/:id
```bash
# Partial update with optimistic lock
curl -X PUT http://localhost:3000/reports/<id> \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "If-Match: 1" \
  -d '{"priority": "high", "tags": ["updated"]}'

# Status transition
curl -X PUT http://localhost:3000/reports/<id> \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "under_review"}'
```

**Valid transitions:** `draft → under_review → published → archived`

### POST /reports/:id/attachment
```bash
curl -X POST http://localhost:3000/reports/r-001/attachment \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@./report.pdf"
```
**Allowed types:** PDF, JPEG, PNG, GIF, WebP, CSV, TXT, DOC, DOCX, XLS, XLSX — max 20 MB

### GET /files/:token
```bash
curl -O http://localhost:3000/files/<token>
# Token is single-use, expires in 1 hour
```

### GET /reports/:id/audit (admin only)
```bash
curl http://localhost:3000/reports/r-001/audit -H "Authorization: Bearer $ADMIN_TOKEN"
```

---

## Roles & Permissions

Action| viewer| analyst| admin
GET /reports, GET /reports/:id| yes| yes|yes
POST /reports| no| yes| yes
PUT /reports/:id| no| own only| yes
POST attachment| no| own only| yes
GET /files/:token| yes| yes| yes
GET /reports/:id/audit| no| no| yes

## Custom Business Rule — Completion Score

A report **cannot be published unless `completionScore >= 70`**.

| Criterion | Points |
|---|---|
| Non-empty title + summary | +20 |
| ≥1 finding entry | +20 |
| ≥1 recommendation entry | +20 |
| All critical entries have body text | +15 |
| ≥1 reviewer assigned | +10 |
| Due date set | +10 |
| ≥1 attachment | +5 |

Score is returned in `metrics.completionScore` on every GET. Missing items are listed in `_hints` on POST. Attempting to publish with score < 70 returns `422 PUBLISH_GATE_FAILED`.

---

## Error Format

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request payload.",
    "details": [{ "field": "title", "code": "too_small", "message": "..." }],
    "requestId": "uuid"
  }
}
```

| HTTP | Code |
|---|---|
| 401 | UNAUTHORIZED |
| 403 | FORBIDDEN |
| 404 | NOT_FOUND |
| 412 | PRECONDITION_FAILED |
| 415 | UNSUPPORTED_MEDIA_TYPE |
| 422 | VALIDATION_ERROR |
| 500 | INTERNAL_SERVER_ERROR |

---
## Tradeoffs
**Persistence** — I went with an in-memory store sitting behind a repository interface. The obvious downside is that data doesn't survive a restart, but the interface contract means swapping in Postgres later requires no changes to any route code — just a new adapter.

**Authentication** — Stateless JWT made the most sense for horizontal scaling since there's no shared session store to worry about. The tradeoff is that you can't revoke a token mid-session without a Redis deny-list, but the 8-hour expiry keeps the risk window short.

**Concurrency** — I used optimistic locking via the If-Match header rather than pessimistic row locks. Clients will occasionally hit a 412 and need to re-fetch, but that's far better than the throughput and deadlock problems that come with locking rows for the duration of a request.

**Job Queue** — The in-process worker is the simplest approach that still demonstrates retry, back-off, and dead-letter behaviour. The real tradeoff is that jobs in-flight when the process crashes are lost. Since all the queue logic lives in jobQueue.ts, swapping to BullMQ is a one-file change.

**File Storage** — Local disk works fine for a single instance but breaks down across multiple nodes. I abstracted it behind a StorageAdapter interface for exactly this reason — the S3 implementation would just be four methods.

**Pagination** — Page/size offset pagination is simpler to implement and reason about. The known weakness is page drift when items are inserted between requests, but for report entries which rarely change mid-session, this is an acceptable tradeoff.

**Metrics** — Computing completionScore, isOverdue, and trendIndicator at read time means they're always accurate, even if child data changes. The cost is recomputation on every GET, which a short-lived Redis cache would fix at scale without sacrificing correctness.

**File Upload** — Running uploads through the server lets me validate type and size before anything hits storage. The downside is that all file bytes pass through the Node process, but at a 20 MB cap this is perfectly manageable.

**Download Tokens** — Single-use, 1-hour tokens mean users can't bookmark download links, which is a minor inconvenience. The upside is that a leaked URL can only be used once, which matters for a system handling confidential reports.

## Tests

```bash
npm test              # 68 tests
npm run type-check    # TypeScript check
npm run lint          # ESLint
```
