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
DecisionChoseTradeoff AcceptedPersistenceIn-memory store behind repository interfaceData lost on restart — swap to Postgres with zero route changesAuthStateless JWTCannot revoke tokens without Redis deny-list — mitigated by 8h expiryConcurrencyOptimistic locking (If-Match)Occasional 412 on conflict — better throughput than pessimistic row locksJob queueIn-process workerJobs lost on crash — isolated to jobQueue.ts, swap to BullMQ in one fileFile storageLocal disk adapterNot shared across instances — StorageAdapter interface makes S3 swap trivialPaginationPage/size offsetPage drift on high-mutation lists — acceptable for low-mutation report entriesMetricsComputed at read timeRecomputes every GET — correct over fast; Redis cache fixes at scaleFile uploadServer-side multipartFile bytes through Node process — acceptable under 20 MB limitDownload tokensSingle-use, 1 hourCannot bookmark URLs — prevents accidental sharing of sensitive files

## Custom Business Rule — Completion Score
What It Is
A Report cannot be promoted to published unless its Completion Score >= 70. The score (0–100) is computed at read time from content quality.
Score Components
CriterionPointsNon-empty title + summary+20≥1 finding entry+20≥1 recommendation entry+20All critical entries have body text+15≥1 reviewer assigned+10Due date set+10≥1 attachment+5
API Behaviour

GET → metrics.completionScore always visible
POST → _hints lists exactly what is missing
PUT status: published → 422 PUBLISH_GATE_FAILED if score < 70

Implementation
Single pure function in reportService.ts — no new DB fields, fully unit tested, weights adjustable in one place.
Justification
Without this gate, empty unreviewed drafts can accidentally reach published. A numeric score was chosen over a binary checklist because it shows partial progress, is easy to render as a progress bar, and the 70 threshold allows publication without demanding perfection (e.g. attachments are encouraged but not mandatory).

## Tests

```bash
npm test              # 68 tests
npm run type-check    # TypeScript check
npm run lint          # ESLint
```