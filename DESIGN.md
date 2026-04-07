# Design Write-Up

## 1. Domain Model & Assumptions

I modelled this as an **analytical reporting system** — internal ops/business reports shared across teams. Assumptions:

- **Reports** are the central aggregate owning entries, comments, and attachments.
- **Entries** are structured findings/recommendations (not freeform notes).
- Reports follow a lifecycle: `draft → under_review → published → archived`.
- Users are pre-registered; no self-signup needed.
- Attachments are knowledge artifacts (PDFs, spreadsheets, images).

---

## 2. Persistence

**In-memory store** behind a repository interface. No route code references the store directly — only the interface methods (`getReportById`, `saveReport`, `slugExists`, etc.). Swapping to PostgreSQL means implementing those four methods in a Postgres adapter.

**Postgres schema sketch:**
- `reports(id UUID PK, slug TEXT UNIQUE, version INTEGER, metadata JSONB)`
- `report_entries`, `comments`, `attachments` as child tables with FK
- `audit_log` append-only with index on `resource_id`
- Optimistic lock via `UPDATE … WHERE version = $1` checking rows-affected

---

## 3. Auth & Security

**JWT (stateless):** Suits horizontal scaling — no session store. Tokens carry `sub`, `email`, `role`. Secret is env-var; in production rotated via AWS Secrets Manager / Vault.

**RBAC:** Three roles (`viewer < analyst < admin`) with a numeric hierarchy. Route-level `requireRole()` middleware + resource-level ownership check for analysts.

**Other hardening:**
- `helmet` sets security headers (CSP, HSTS, X-Content-Type-Options, etc.)
- Rate limiting: 300/15 min globally, 20/15 min on auth routes
- Auth failures always return 401 to avoid email enumeration
- `restricted` reports return 404 (not 403) to avoid leaking existence

---

## 4. GET — Complex Formatting

**Shape switching via `?view=`:**  
`view=summary` returns a flat compact object; `view=full` returns the full hierarchy.  
`?include=` CSV enables selective field expansion (e.g. `include=entries,metrics`).

This pattern (used by Stripe, GitHub, Shopify) avoids field masks or GraphQL while keeping the surface small.

**Computed fields** (`completionScore`, `trendIndicator`, `isOverdue`, `daysSinceLastUpdate`) are derived at read time, never stored — avoids stale aggregate problems. At scale, short-TTL Redis caching (60 s) would eliminate recomputation on hot reports.

**Pagination** on entries uses page/size parameters. Comments and attachments are not paginated — their cardinality is expected to stay small (< 100). The pattern is identical if that assumption needs to change.

---

## 5. PUT — Idempotency & Concurrency

**Partial semantics (merge-patch, RFC 7396):** Clients send only changed fields. This is practical — sending the entire deeply nested Report in every update is unwieldy.

**Optimistic concurrency via `If-Match: <version>`:** The server rejects `If-Match != stored version` with 412. This prevents last-write-wins data loss without pessimistic row locks. Version counters are simpler to expose in API responses than ETags (which require hashing the body).

**Audit trail:** Every PUT stores before/after snapshots and a `changedFields` diff. In production the "before" snapshot would reference an immutable event-sourcing log rather than a full object copy.

---

## 6. POST — Invariants & Side Effects

**Slug uniqueness** is the duplicate-detection mechanism. Slug is derived from the title and stored as a UNIQUE key. A timestamp suffix auto-resolves near-collisions, documented in the error response.

**XSS prevention:** `sanitize-html` strips all tags from free-text fields before storage.

**Idempotency keys:** The server caches `{statusCode, body}` for 24 h. Clients may safely retry after timeouts without creating duplicates. Production cache: Redis with TTL.

**Async jobs — why enqueue instead of await:**  
Awaiting SMTP or search-index calls in the HTTP handler couples user latency to third-party reliability. Enqueueing decouples them.

**Failure handling:**

| Layer | Mechanism |
|---|---|
| Retry | Exponential back-off: 1s, 2s, 4s, 8s, 16s (5 attempts) |
| Dead-letter | After max attempts, status → `dead`, logged at ERROR |
| Compensating | Alert ops (Slack/PagerDuty); mark report with "notification_failed" flag |

The report itself is never rolled back — creation is the primary transaction; notifications are best-effort.

---

## 7. File Upload

**Multipart (server-side) vs. pre-signed S3 URL:**  
For files ≤ 20 MB, server-side multipart is simpler and doesn't expose cloud credentials to the client. For files > 100 MB in production, the pre-signed flow is better:

```
1. POST /reports/:id/attachment/presign  → { url, fields }
2. Client PUT directly to S3
3. S3 event → Lambda → POST /reports/:id/attachment/confirm
```

**Storage abstraction:** `StorageAdapter` interface (`save`, `delete`, `buildDownloadToken`, `resolveToken`) is today implemented by `localDiskAdapter`. Swapping to S3 means implementing those four methods with `@aws-sdk/client-s3` — no route changes.

**Signed download tokens:** Short-lived (1 h) random hex token maps to a storage path. Advantages: shareable without sharing auth credentials, auto-expiry without cron jobs, CDN-compatible.

**File type validation — three layers:**
1. `mime-types.lookup(originalName)` checks extension
2. `multer.fileFilter` blocks at upload time
3. Second MIME check before storage

Production addition: `file-type` library reads magic bytes — extensions can be spoofed, magic bytes cannot.

**Malware scanning (described, not implemented):**
```
receive → temp file → ClamAV scan → pass: store / fail: delete + 422
```
Always fail-closed: if scanner is unreachable, reject the upload.

---

## 8. Custom Business Rule — Completion Score

A **Completion Score** (0–100) controls whether a report may be published.

| Criterion | Points |
|---|---|
| Non-empty title AND summary | 20 |
| ≥1 `finding` entry | 20 |
| ≥1 `recommendation` entry | 20 |
| All `critical` entries have body text | 15 |
| ≥1 reviewer in metadata | 10 |
| `dueDate` set | 10 |
| ≥1 attachment | 5 |

**Threshold: 70.** A PUT attempting to set `status=published` when `score < 70` returns 422 with `code: PUBLISH_GATE_FAILED`.

**Justification:** Without this gate, incomplete drafts can accidentally reach published state. The numeric score surfaces actionable guidance (via `_hints` on POST and `metrics.completionScore` on GET), is easy to display as a progress bar, and the threshold is adjustable via configuration.

---

## 9. Logging & Observability

**Winston** writes structured JSON in production, pretty-printed in development. Every log entry includes `requestId`, `timestamp`, `level`, `service`, and contextual metadata.

**Audit log** is separate — records before/after state for compliance and forensic use. Production destination: append-only Postgres table or DynamoDB.

**HTTP access logs** via `morgan` forwarded to Winston stream.

Production: logs ship to Datadog / CloudWatch; audit log to a SIEM.

---

## 10. Scalability Path

| Concern | Current | Production |
|---|---|---|
| Persistence | In-memory | PostgreSQL + PgBouncer |
| Job queue | In-process `setInterval` | BullMQ + Redis or SQS + Lambda |
| Idempotency cache | `Map` | Redis with TTL |
| Download tokens | `Map` | Redis with TTL |
| File storage | Local disk | S3 / GCS with SSE |
| Rate limiting | In-process | Redis-backed (multi-node) |
| Caching | None | Redis short-TTL for GET /reports/:id |
| Search | None | Elasticsearch for full-text entries |

The API is stateless at the HTTP layer — no correctness-critical in-memory state. Horizontal scaling is achieved by deploying multiple instances behind a load balancer with a shared Redis and Postgres backend.

---

## 11. What I Would Add With More Time

1. `GET /reports` — paginated list with sorting, filtering, cursor pagination
2. Entry CRUD sub-endpoints (`POST/PUT/DELETE /reports/:id/entries/:entryId`)
3. OpenAPI 3.0 spec auto-generated from Zod schemas (`zod-to-openapi`)
4. Integration tests (Supertest against the full Express app)
5. Refresh token rotation
6. Field-level encryption for `restricted` reports at rest
7. WebSocket push when report status changes
