# SAMCO — Requirements Conformance Report

Working tree on 2026-09-15. **Nothing has been committed or pushed.**

The requirement-by-requirement traceability is in `docs/SAMCO-REQUIREMENTS-CONFORMANCE-MATRIX.md`. This report summarises it, records the decisions taken, and states plainly what is not done.

---

## 1. Executive summary

SAMCO's implemented modules were audited line by line against the SRS and Part II (Module Operating Logic):
- Foundation, Queue, Banquet, Tasks & Routines, Reports / Dashboard / Exports, Displays, Auth and Audit.

Where a requirement applied to what SAMCO already does, the gap was implemented on SAMCO's own architecture:
- NestJS, Prisma/PostgreSQL and Next.js;
- server-side authorization with company + branch tenancy;
- the existing audit, realtime, scheduler and report registry.

No Firebase or Flutter pattern, second authorization or event system, Redis, or client-side database access was introduced.

**Outcome by requirement** (123 matrix rows):

| Status | Count |
|---|---|
| Implemented in this pass | 49 |
| Already satisfied, re-verified | 23 |
| Partially satisfied | 15 |
| Deferred, with reasons | 21 |
| Future module (Inventory / Finance / POS etc.) | 7 |
| Rejected as a deliberate deviation | 6 |
| Not applicable | 2 |

**Largest changes.**
- **Banquet money and operations.**
  - Layered pricing: extra pax, extra charges, three separately permissioned discount kinds, GST as CGST+SGST, and a no-GST mode.
  - Payment stages and second-person verification.
  - A database-enforced "paid ≤ total" rule.
  - Past-event edit control; editable confirmed bookings.
  - Hall slots and an availability calendar; list tabs, filters and search.
  - Printable bill (GSTIN / FSSAI) and KOT; cancellation reasons.
  - Kitchen-board data minimisation.
- **Reports and dashboard.**
  - en-IN / branch-timezone exports and screens.
  - Drill-down; an outstanding-balances report; routine on-time/late compliance.
  - Dashboard periods and an All Branches aggregate.
  - Stable pagination with bounded offsets; a single permission resolution per request.
  - A fixed dead "Run" button.
- **Foundation.**
  - Branch selection that persists per user; deep links that survive sign-in, with open-redirect protection.
  - Signed-in devices with remote sign-out.
  - Security headers and proxy trust; a PostgreSQL advisory lock for scheduled jobs.
  - Branch tax settings and an audit log viewer.
  - A route-inventory test that proves default-deny across every route.
- **Routines.**
  - Typed checklist answers (number, text, rating, date) in the one existing engine.
  - A transposed compliance log.
  - A reference-routine library built only from items the source documents name.
- **Earlier in the same pass.**
  - Own-task visibility (`tasks.view_own`), task ownership, reassignment tracking, comments and routine deadlines.
  - Queue scheduled bookings, skip, check-in, audited contact, table availability and totals; display controls.
  - A privilege-escalation fix in role assignment; explicit system audit events; an e2e database safety guard.

**Verification.** Every suite passes on the final tree:

| Check | Result |
|---|---|
| API unit | 713 / 713 |
| API e2e | 658 / 658 |
| Web unit | 415 / 415 |
| Playwright | 37 / 37 |
| oxlint, eslint | clean |
| API and web typecheck | clean |
| `nest build`, `next build` | succeed |
| `prisma validate` | valid |
| `prisma migrate status` | up to date |
| Drift check | empty migration |

This is not a claim that the SRS is fully met: the partial, deferred and future items in §7–§9 remain.

## 2. Documents reviewed

- `SRS_Restaurant_Operations_Platform.md` — all sections, including module descriptions §5.1–§5.11, non-functional requirements §7, recommendations §8 and appendices. Read completely before any code change.
- `Module_Logic_and_Infrastructure_Cost_Plan.md` (Part II) — cross-cutting logic §1, queue §2, banquet §3 (including pricing §3.4, payments §3.5 and "what to watch out for" §3.10), tasks and routines §4 (the eleven routines and item types §4.2–§4.3), inventory / finance / POS §5–§7, reports §8, notifications §9, and infrastructure and cost §13–§22. Read completely before any code change.

Both documents were treated as evidence of product behaviour, not as an implementation template.

## 3. Current SAMCO scope audited

| Area | What was audited |
|---|---|
| T0 foundation | Authentication and sessions; company / branch context; PermissionGuard and AuthorizationService; permission keys; users and roles; audit log; realtime broker and stream tickets; JobRegistry; display-device authentication; web shell and navigation |
| Phase 7 — Queue | Tokens and counters, state machine, podium / register / board, public and admin displays, tables, queue reports and widget |
| Phase 8 — Banquet | Halls, packages, bookings, lifecycle, payments, event plans, kitchen board and chef display, banquet reports and widget |
| Phase 9 — Tasks & routines | Tasks, checklists (templates and snapshots), routines and scheduler materialization, assignment, task reports and widget |
| Phase 10 — Reports & dashboard | Report registry and contract, range resolution, query parsing, XLSX/PDF export, dashboard service and widgets, web report and dashboard pages |
| Explicitly not built | Inventory / procurement, Finance, POS and POS KDS, full menu management, stock ledger and supplier workflow — minimum extension points only (§9) |

## 4. Requirements coverage summary

| Area | Implemented | Satisfied | Partial | Deferred | Future | Rejected | N/A |
|---|---|---|---|---|---|---|---|
| Cross-cutting platform (26) | 11 | 4 | 3 | 5 | 1 | 1 | 1 |
| Dashboard (9) | 1 | 2 | 3 | 2 | 1 | 0 | 0 |
| Queue (19) | 8 | 5 | 0 | 3 | 1 | 2 | 0 |
| Banquet (26) | 15 | 3 | 3 | 4 | 0 | 1 | 0 |
| Tasks & routines (17) | 6 | 4 | 4 | 3 | 0 | 0 | 0 |
| Reports & exports (8) | 5 | 1 | 0 | 1 | 0 | 1 | 0 |
| Future modules (4) | 0 | 0 | 0 | 0 | 4 | 0 | 0 |
| Non-functional / platform (14) | 3 | 4 | 2 | 3 | 0 | 1 | 1 |
| **Total (123 rows)** | **49** | **23** | **15** | **21** | **7** | **6** | **2** |

These counts were produced mechanically from the matrix's Status column.

## 5. Requirements implemented in this pass

**Banquet.** Matrix: FR-BQ-01, 03, 04, 05; BQ-CAL, LIST, PRICE, PAY, KDS, KOT, FIN, REPORTS, CHECKLIST, OVERPAY, CANCEL.

- **Pricing** (`banquet-money.ts` `priceBooking`).
  - base = rate × guaranteed guests; plus extra pax × rate; plus extra charges.
  - Minus line discounts, per-head discount × plates, and admin discount.
  - The result is the taxable value. CGST = SGST = round-half-up(taxable × rate / 2) in whole paise.
  - total = taxable + CGST + SGST.
  - Discounts can never exceed the bill.
  - Extra charges and discounts are append-only `banquet_booking_adjustments`; withdrawing one records a reversal, limited to one per line by a unique index.
  - Permissions: `banquet.charge.manage`, `banquet.discount.apply` (line and per-head), `banquet.discount.admin` (lump sum).
  - GST rate: the branch `banquet_gst_rate_bps` is snapshotted per booking; `apply_gst: false` gives no-GST mode. The rate is never client-supplied.
- **Payments.**
  - The server decides the stage (ADVANCE / INTERIM / FINAL).
  - `payment_status` is UNPAID / PARTIAL / PAID.
  - Verification is a separate append-only record; the recorder can never verify their own payment, and a payment is verified at most once.
  - The stored `paid_minor` is guarded by `CHECK (paid_minor <= total_amount_minor)`.
- **Edits and controls.**
  - Confirmed bookings are editable, re-priced from the booking's own snapshot.
  - Once the event has started, edits and pricing lines need `banquet.booking.edit_past`.
  - A change cannot push the total below the amount paid.
  - Hall moves remain guarded by the exclusion constraint.
  - Every change is audited with old and new values.
- **Operations.**
  - Hall slots (branch-local, overnight-aware) and an availability endpoint with a week/month calendar.
  - List tabs (drafts / upcoming / past / cancelled), payment filters (pending / paid / unverified), search, and date filters by event, advance or final payment date.
  - Hall-name snapshot; hall deactivation refused while upcoming confirmed events exist.
  - `cancellation_reason`.
  - Printable bill (branch GSTIN / FSSAI; a draft prints as a quotation) and KOT ("NOT A BILL - KITCHEN ONLY", no money or customer).
  - Customer names on the staff kitchen board only for banquet.view holders.
  - Branch-timezone datetime inputs.

**Reports and dashboard.** Matrix: FR-X1, FR-DB-01, RPT-DRILL, EXPORT, LIST, PAGE, RUN, X-L10N.

- **Exports.** Branch name; dd/MM/yyyy; en-IN numbers; instants as branch wall-clock dates in Excel.
- **Drill-down.** A report definition can declare `drilldown`; the banquet reports link to bookings.
- **New and extended reports.**
  - `banquet.outstanding`, computed from the payment history.
  - `tasks.routines` gains `on_time`, `late` and `on_time_rate`.
- **Pagination.** Tie-breakers and an offset cap of 100,000.
- **Dashboard.**
  - Permissions are resolved once; widgets run concurrently.
  - Period presets.
  - All Branches: every branch is proved individually; counts and per-currency money are summed; anything else is named as "not added".
- **Web.**
  - en-IN formatting, branch-local date labels and a drill-down link cell.
  - The Run button now always re-queries.

**Foundation.** Matrix: FR-X1.b, X3.a, X3.b (partial), X8, X-AUTHZ, X-ESC, X-HDR, X-SCHED, NFR-05, NFR-06.

- **Branch selection.** Remembered in localStorage per user, with a one-time carry-over from sessionStorage.
- **Deep links.** `/login?next=` with `safeNextPath` (same-origin paths only; `//host`, backslash tricks, control characters and `/login` loops are refused).
- **Signed-in devices.**
  - Captured at login: user agent (bounded to 300 characters), IP and last use.
  - The device list exposes an opaque handle derived from the session id, never the id itself, which is half of the refresh token.
  - Remote sign-out takes effect immediately.
  - The `/settings/devices` page is linked from the header.
- **Response hardening.**
  - API: nosniff, frame DENY, no-referrer, CORP same-site, `default-src 'none'`, Permissions-Policy, HSTS in production, and `TRUST_PROXY` (off by default).
  - Web: baseline headers and `poweredByHeader: false`.
- **Scheduler.** The PostgreSQL advisory lock is transaction-scoped, so it is released with the transaction whatever happens.
- **Settings screens.** Branch tax settings (`/settings/branches`) and the audit log viewer (`/settings/audit`).
- **Route inventory.** An e2e test classifies every controller route as permission / device / self / ticket / public.

**Routines.** Matrix: R-ENGINE, R-VIEW, R-DEADLINE, BQ-CHECKLIST, FR-X9.

- **Typed checklist answers.**
  - `ChecklistItemKind` (CHECK / NUMBER / TEXT / RATING / DATE), with canonical text values.
  - An answer marks the item done; the database requires `is_done = (value IS NOT NULL)` for typed items.
  - Updates are conditional on both the done flag and the value.
  - The audit records only that an answer was given.
- **Transposed log.** `GET /routines/:id/log` and its page.
- **Reference library.** 8 installable definitions.

**Earlier in this pass** (before the batches above).
- **Tasks.** `tasks.view_own`; task creator and assigner; reassignment count; append-only comments with edit diffs; routine `due_time`.
- **Queue.**
  - SCHEDULED status and a scheduler activation job; skip (CALLED→WAITING).
  - Check-in; same-day scheduling rule.
  - On-demand, audited contact (needs queue.call + customers.view; WhatsApp only for E.164 numbers).
  - Table availability; waiting totals; refusal to deactivate an occupied table.
- **Displays.** Per-device density and fullscreen controls.
- **Users.** Role assignment refuses self-assignment and any role carrying permissions the actor lacks.
- **Audit.** `systemEvent` for scheduler-created company events.
- **E2E safety.** Suites refuse to reset any database whose name does not contain "e2e".

## 6. Requirements already satisfied before this pass

Re-verified by the existing tests, which still pass:

- Company + branch tenancy and PermissionGuard with database-proved context.
- Append-only audit log.
- SSE realtime with single-use stream tickets.
- Display-device credentials and projections.
- Atomic daily token counters; one seated party per table.
- Banquet integer money, package snapshots, lifecycle state machine and the hall exclusion constraint.
- Append-only payments.
- Chef display without customer or money data.
- Idempotent routine materialization (unique routine + date).
- Two-key report authorization, bounded branch-local report ranges and capped exports.
- Permission-filtered dashboard widgets.
- Login throttling and session-bound access tokens.
- Accessible DOM display boards.

Matrix rows marked **Satisfied**: 23.

## 7. Requirements partially satisfied

| Requirement | What is met | What is missing |
|---|---|---|
| FR-X3.b | Company audit log viewer | A per-record "audit information" panel |
| FR-X6 | Localised XLSX/PDF; printable bill and KOT | WhatsApp share |
| FR-X7 | Per-device density and fullscreen | Tenant-wide typography scale |
| FR-DB-01.a | Today / 7 days / 30 days / this month | Custom range on the dashboard (reports have it) |
| FR-DB-01.b | Waiting, called, adults, kids, seated, longest wait | Total walked in and no-shows on the tile |
| FR-DB-01.c | Per-branch breakdown in All Branches | A dedicated Seated / Cancelled / Total matrix |
| FR-BQ-02 | No double booking under any concurrency | One booking holding several halls or slots (use separate bookings) |
| BQ-SETUP | Slots, rename, guarded deactivation | Hall merge, hall images |
| BQ-TERMS | Printable bill | Configurable terms and conditions |
| T-TEMPLATES | Checklist templates plus routines | One-off task templates |
| R-ITEMTYPES | Tick, number, text, rating, date | Photo (single / multiple), signature |
| R-EXPORT | Adherence report exports | Export of the transposed log |
| R-11 | 8 of 11 reference definitions | Kitchen, BM and Operational checklists (the source names no items) |
| NFR-04 | Query-count and concurrency optimisations; bounded ranges | A load test demonstrating under 3 s |
| P2-RT | Refetch on event; resync on reconnect | Last-Event-ID replay |

## 8. Requirements intentionally deferred

For each: why it is deferred, the missing dependency, and what should be done later.

- **Notifications (FR-X4).**
  - *Why:* a whole module (outbox, preferences, in-app centre, push); the instruction forbids fake notifications.
  - *Missing:* a notification outbox table and a delivery channel (web push / FCM equivalent).
  - *Later:* build an outbox written in the same transaction as the event, plus an in-app centre over the existing SSE broker.
- **Offline routine forms (FR-X5, R-OFFLINE, NFR-03).**
  - *Why:* needs client storage, idempotent submission keys and conflict rules; the instruction forbids global offline for bookings and payments.
  - *Missing:* a submission idempotency key on checklist answers; a service-worker queue.
  - *Later:* scope offline to checklist answers only, keyed by (task, item, client id).
- **Photo evidence (FR-X12, R-PHOTO).**
  - *Why:* no object storage; storing binaries in PostgreSQL and fake uploads are both forbidden.
  - *Missing:* S3-compatible storage, signed upload and download URLs, a thumbnail job.
  - *Later:* add a `media` table with ownership and scope, and a PHOTO checklist kind referencing media ids.
- **Queue waiter surface and signalling (Q-WAITER, Q-SIGNAL); QR self-join (Q-PUBLIC).**
  - *Why:* new staff role surfaces and an unauthenticated public surface. The public surface needs abuse controls (rate limits, one-time links) that do not exist yet.
  - *Later:* a waiter view over the existing board, and a public join endpoint with per-branch rate limiting and signed QR tokens.
- **Banquet voucher on cancellation (BQ-VOUCHER).**
  - *Why:* a voucher is a liability ledger, i.e. finance semantics.
  - *Missing:* the Finance module.
  - *Later:* model it in Finance and link it from the cancelled booking.
- **Buffet booking type (BQ-BUFFET), plate approval (BQ-PLATE), public booking link (BQ-PUBLIC).**
  - *Why:* each is a new workflow whose rules the documents only sketch; the public link is an unauthenticated surface.
  - *Later:* specify the rules, then build on the booking and KDS models.
- **Inter-branch search (FR-X1.c), branch capability boundary (FR-X2.c).**
  - *Why:* product rules are unspecified; capability switches would touch every guard.
  - *Later:* a per-branch module switch checked by PermissionGuard.
- **Dashboard daily chart (FR-DB-01.d), rollups (FR-DB-03).**
  - *Why:* no charting component; rollups are premature without load data.
  - *Later:* add a small chart over queue.summary, and rollups only if NFR-04 fails under measured load.
- **Activity calendar (T-CAL), WhatsApp share (RPT-SHARE), retention (NFR-09), ops (P2-OPS).**
  - *Why:* unspecified rules, or not code in this repository.
  - *Later:* retention jobs through the JobRegistry with append-only-safe archiving.

## 9. Requirements belonging to future Inventory / Finance / POS modules

These were deliberately NOT built (task instruction):
- Inventory and procurement: stock ledger, suppliers, POs, transfers, inventory reports.
- Finance: expenses, petty cash, daily closing, UPI, revenue widgets.
- POS: menu, billing, POS KDS / KOT routing, table release on bill close.
- AI assistant; cleaner and head consoles.

**Extension points that exist.**
- Reserved permission keys for POS, inventory and finance.
- The report registry and dashboard widget contract, so a future module registers providers without engine changes.
- The routine engine: Kitchen Balance, Wastage and Stock Request capture figures as typed answers, with no inventory posting.
- `RealtimeChannel` for new channels.
- No dashboard or report shows fabricated inventory, finance or POS figures.

## 10. Security findings

| # | Finding | Severity | Resolution | Test |
|---|---|---|---|---|
| S1 | Role assignment allowed privilege escalation: assigning a role carrying permissions the actor lacks, including to oneself | High | Fixed: 403 on self-assignment and on any permission the actor does not hold | rbac S1-a/b/c |
| S2 | Staff kitchen board returned customer names to kitchen-only roles | Medium | Fixed: names only for banquet.view holders | BQ-12 |
| S3 | No control on changing past banquet events (revenue integrity) | Medium | Fixed: `banquet.booking.edit_past` | BQ-5 |
| S4 | Discounts and payment verification were unpermissioned / absent; self-verification possible in principle | Medium | Fixed: three discount permissions; second-person verification | BQ-2, BQ-6, BQ-7 |
| S5 | Default deny was not proved: a route with no permission metadata passes PermissionGuard | Medium | Route-inventory test. It surfaced the companies routes: GET routes are scoped in the service to active membership; `POST /companies` is self-service creation by any signed-in user (grants nothing in existing companies). Classified and documented. **Product decision outstanding** on whether company creation should be restricted. | RI-1..5 |
| S6 | Signed-out deep link needs a redirect target, which invites open redirects | Low | `safeNextPath` accepts same-origin app paths only | next-path.test; pw "off-site next ignored" |
| S7 | Device list could leak refresh-token material | Low | An opaque one-way handle is returned instead of the session id | SD-1 |
| S8 | Missing response security headers; proxy IP handling for the login throttle | Low | Headers on API and web; `TRUST_PROXY` configurable, off by default | security-headers.spec |
| S9 | Audit payload PII | Info | Kept minimal: booking notes, cancellation reasons, checklist answers and payment references recorded as presence or change flags only | TY-4, BM-7, bookings spec |
| S10 | E2E suites could target a development database | Medium (operational) | `assertE2eDatabase` guard; runner pinned to `samco_e2e` | test utils |

`is_superadmin` still bypasses nothing. "Assigned" is still not "authorized" (task tests). Context headers remain requests, never proof.

## 11. Concurrency findings

**Banquet.**
- Every booking mutation (edit, pricing line, payment, transition, event plan) first takes a tenant-scoped `SELECT … FOR UPDATE` on the booking row. Each therefore sees the committed result of the one before.
- Overpayment is refused in the service and by `CHECK paid_minor <= total_amount_minor`, including when a discount or head-count change races a payment. Tests: BX-3, BQ-4.
- Double booking is refused by the exclusion constraint for confirmations and for edits that move a hall or window. Tests: BX-1, BC-9, BQ-9.
- Two verifiers racing yield exactly one verification (unique `payment_id`). Test: BQ-7.
- A line is withdrawn at most once (unique `reverses_id`).

**Tasks.**
- Checklist updates are conditional on the done flag and the value, so a lost race gives a 409, never a lost answer. Tests: TX-5, TX-6.
- Task mutations lock the row.

**Queue.** Status-conditional updates, the one-seated-party-per-table index and atomic counters are unchanged. Scheduled activation is idempotent.

**Scheduler.** Replicas no longer run the same job concurrently (advisory lock). Idempotency at the data layer is still the correctness guarantee.

**No artificial sleeps** were added to any test.

## 12. Performance findings

- **Dashboard.** Previously one full permission check per widget, run sequentially. Now permissions are resolved once and widgets run concurrently. All Branches runs branches concurrently.
- **Report catalogue.** Previously one check per report; now a single resolution.
- **Pagination.** Deep OFFSET is capped at 100,000; ORDER BY tie-breakers keep pages stable.
- **Bounded windows.** Report ranges ≤366 days; availability and routine log ≤62 days; exports synchronous and capped at 5,000 rows, refused on the total rather than silently truncated.
- **Indexes.** New `(booking_id, created_at)` on adjustments; slots indexed by hall; existing branch/date indexes serve the new queries. Outstanding balances use a LATERAL payment aggregate per booking in the window.
- **Not done.** No load test against the NFR-04 target of 3 s; availability is computed per request. See §19.

## 13. UI findings

Defects found and fixed, each with a test:

| Screen | Problem | Test |
|---|---|---|
| Reports | "Run" did nothing when no filter had changed (dead button) | RF-13b |
| Reports, dashboard | Dates and numbers in the viewer's locale and ISO form | RF-5, RF-5b, RF-13 |
| Banquet forms | Times entered and shown in the device timezone rather than the branch's | banquet "branch timezone" tests |
| Banquet detail | A confirmed booking could not be edited at all; no bill, discount, verification or cancellation reason | banquet detail tests |
| Audit log | The page was a "not available" placeholder | settings audit tests |

Each new control is permission-aware (hidden when not allowed) and re-validated by the API; no control is the security boundary.

**Remaining.** The Customers, Tables, Displays, Users and Roles screens are still honest "not available in this version" pages (their APIs exist). They are placeholders reached from navigation, not dead buttons, but they are gaps.

## 14. Browser acceptance results

Playwright runs real Chromium against production builds of the API and web app, on the dedicated `samco_browser_e2e` database. **37 / 37 passed.**

| Spec | Tests | Coverage |
|---|---|---|
| Existing role and display acceptance | 27 | Chef, worker and no-permission roles; queue / admin / chef displays, live updates, outage recovery, device security; phone layouts |
| `e2e/conformance.spec.ts` (new) | 10 | See below |

The new conformance tests:
- **Branch tax details** reach the printed bill and appear in the audit log (desktop).
- **A pricing line** re-prices the booking; a payment records as Advance; no self-verification is offered (desktop).
- **KOT** reads "NOT A BILL - KITCHEN ONLY", with no money or customer.
- **Availability calendar** works at phone width (375×812) with no sideways page scroll.
- **Outstanding-balances report** drills down to the booking at tablet size (768×1024).
- **Dashboard periods** work, and All Branches shows the Bengaluru + Pallavaram sum.
- **A reference routine** installs, and its typed item takes an answer that the API stores canonically.
- **Signing out other devices** ends those sessions immediately (the API returns 401).
- **A deep link** survives sign-in.
- **An off-site `next`** is ignored.

**Failures found while writing them.**
- 2 selector ambiguities in the new spec: substring label matches ("Amount (INR)" vs "Line amount (INR)"; "Devices" vs the Displays card). Fixed with exact matches.
- `display.spec.ts` expected `/login` without a query string. It was updated for the intended `?next=` behaviour; its security assertion (no staff shell on a display) is unchanged.

No test uses artificial sleeps. Traces and videos stay off, per the suite's secret-handling rules.

## 15. Test results

Final tree, all run after the last code change.

| Suite | Command | Result |
|---|---|---|
| API unit | `apps/api: npx vitest run` | **713 passed** (31 files); baseline before this task was 639 |
| API e2e | guarded runner (`migrate deploy` + seed + vitest e2e) on `samco_e2e` | **658 passed** (13 files); baseline 622 |
| Web unit | `apps/web: npx vitest run` | **415 passed** (30 files); baseline 354 |
| Browser | `apps/web: npx playwright test` | **37 passed** |
| API lint | `npm run lint` (oxlint src/ test/) | clean |
| Web lint | `npx eslint .` | clean |
| API typecheck | `tsc -p tsconfig.build.json --noEmit` | clean |
| Web typecheck | `tsc --noEmit` | clean |
| API build | `nest build` | success |
| Web build | `next build` | success (31 routes) |

**Tests added in this pass (highlights).**

API e2e:
- banquet BQ-1..13, plus BB-7 rewritten for the confirmed-edit rule;
- reports RP-55..61;
- tasks TY-1..6, plus the earlier own-visibility, ownership, comments, query-flag, deadline and concurrency blocks;
- queue QK-1..8;
- rbac S1-a..c;
- new suites `sessions.e2e-spec.ts` (SD-1..5) and `route-inventory.e2e-spec.ts` (RI-1..5).

API unit:
- layered pricing, payment stage and status;
- bookings service past-event, adjustment, verification and audit tests;
- checklist value validation; job lock; security headers;
- Indian date export formatting; report service and query parsing.

Web:
- banquet (detail pricing, verification, edit, cancel, calendar, bill / KOT, list filters);
- reports (en-IN, Run, drill-down, presets, All Branches);
- settings (devices, branches, audit);
- tasks (typed answers, library, compliance log);
- app context persistence; next-path; datetime formatting.

## 16. Database / migration results

New migrations, all additive, with backfills where needed:

| Migration | Contents |
|---|---|
| `20260915090000_tasks_ownership_comments` | Task creator / assigner / reassignment count; append-only `task_comments`; routine `due_time` with shape CHECKs |
| `20260915100000_queue_scheduled_and_skip` | Queue SCHEDULED status; SKIPPED / CHECKED_IN / ACTIVATED events; `skipped_at`, `skip_count` |
| `20260915110000_banquet_pricing_payments` | Adjustments and verifications, both append-only by trigger; hall slots; booking `hall_name` (backfilled), `extra_pax`, `gst_rate_bps`, `paid_minor` (backfilled from history), `cancellation_reason`; payment `kind`; branch `gstin` / `fssai_license` / `banquet_gst_rate_bps`; CHECKs including `paid_within_total`, GSTIN / FSSAI shape, slot window |
| `20260915120000_session_devices` | Session `user_agent`, `ip_address`, `last_used_at`, with length CHECKs |
| `20260915130000_typed_checklist_items` | `ChecklistItemKind`; item `kind` / `value`; CHECKs: no value on CHECK, answered-when-done, value length |

Checks:
- `prisma validate`: valid.
- `prisma generate`: success.
- `prisma migrate status` on `samco_e2e`: 17 migrations, "Database schema is up to date".
- Drift (`prisma migrate diff` from the migrated database to `schema.prisma`): empty migration.
- The browser suite applies the same migrations to `samco_browser_e2e` on every run.

## 17. Architecture decisions made

1. **Money.** Integer minor units only. GST is computed per half with half-up rounding, so CGST always equals SGST as printed on Indian invoices. The GST rate is a branch setting snapshotted per booking, never client input.
2. **Pricing lines are append-only; reversal instead of edit or delete.** The priced total is recomputed inside the booking's row lock, and stored so the database can enforce `paid ≤ total`. Payment history remains the source of truth for amounts paid; reports sum the history.
3. **Past-date control.** The reference system's "Super Admin only" is expressed as the grantable permission `banquet.booking.edit_past`. `is_superadmin` continues to bypass nothing.
4. **Hall slots are templates, not locks.** Double-booking protection stays the PostgreSQL exclusion constraint on absolute time ranges, which is stronger than a unique (hall, slot, date) key and correct for custom windows and DST.
5. **All Branches.** No company-wide permission; every branch is authorized individually and only honest aggregates (counts, per-currency money) are summed.
6. **One routine engine.** Typed answers are stored as canonical text (exact decimals, no floats). The reference routines are data (installable templates), not code paths.
7. **Scheduler exclusion.** A PostgreSQL transaction-scoped advisory lock, not Redis. Released automatically; idempotency still enforced by constraints.
8. **Signed-in devices.** An opaque session handle; revocation reuses the existing session check on every request.
9. **Branch selection.** Persisted per user on the device; always re-validated by `/auth/context`.
10. **Default deny** is asserted by a route-inventory test rather than by changing the guard's pass-through, which would have been a broad behavioural change without a migration path.
11. **Signed-in devices placement.** Reached from the header beside Sign out rather than the main navigation, so role navigation stays exactly role-scoped.

## 18. Deviations from the reference application's inferred behavior

| Reference behaviour | SAMCO | Why |
|---|---|---|
| ~60 per-user boolean feature flags | Granular role permissions | Auditable, role-based; instruction |
| Super Admin edits past bookings | `banquet.booking.edit_past` permission | Grantable, testable, no god-mode flag |
| Payment edit / delete (logged) | Append-only payments; verification is a separate record | Money history is never rewritten |
| Discount edits | Append-only lines with reversals | Leakage visible; old / new audited |
| Advance kept as voucher on cancellation | Payments remain recorded on the cancelled booking; no voucher | Finance semantics deferred to Finance |
| Unique hall + slot + date lock | Exclusion constraint on time ranges | Covers custom windows and edits |
| Drafts may occupy slots | Only CONFIRMED / COMPLETED hold a hall; drafts show as "tentative" | Enquiries do not block sales |
| Bulk queue data deletion | Not provided | Destructive; append-only history |
| Waiters create tables ad hoc | Not provided | Tables remain one source of truth |
| Firebase offline sync | Online only (offline deferred, scoped to routines) | Instruction; conflict rules undefined |
| Photo items | Not provided | No object storage; no fake upload |
| Eleven hard-coded routine screens | One engine; 8 reference definitions from named items only | Instruction; no invented standards |
| Access mode per routine (admin / staff) | `tasks.view` / `tasks.view_own` permissions | One authorization system |

## 19. Remaining technical debt

- **Placeholder staff screens.** Customers, Tables, Displays, Users and Roles still show "not available" pages although their APIs exist.
- **Web types are hand-mirrored** from the API views; a shared contract package or generated client would prevent drift.
- **Availability** is computed per request in application code. Fine for 62-day windows; revisit with measured load.
- **Performance NFR.** There is no load test for NFR-04.
- **SSE replay.** No Last-Event-ID replay; clients resync on reconnect.
- **Audit log filters.** Entity type is filtered by exact match only. The companies self-service creation policy needs a product decision (§10, S5).
- **Stored and derived paid amount.** `paid_minor` is stored (for the constraint and filters) while views sum the history. Rows written outside the service (seen in older tests) can lag the stored figure; the history remains authoritative.
- **Tracked build artifact.** `apps/api/tsconfig.build.tsbuildinfo` is a tracked file that builds rewrite (already modified before this task; not reverted, per instruction).
- **Line endings.** Git reports LF→CRLF conversion warnings on edited files (no whitespace errors).
- **Transposed log** rows are keyed by item label and kind; renaming an item between occurrences splits a row.
- **Playwright** runs one Desktop Chrome project with per-test tablet and phone contexts rather than separate device projects.

## 20. Recommended next implementation batch

1. **Admin screens.** Users, Roles, Customers, Tables and Displays on the existing APIs, replacing the placeholders (highest user-visible gap).
2. **Notifications foundation.** Transactional outbox, in-app centre over SSE, per-user preferences. Required before WhatsApp / push features.
3. **Object storage and photo checklist items.** Signed URLs, a media table with tenancy, thumbnail job; then the PHOTO item kind and photo-evidence routines.
4. **Multi-hall bookings.** A `banquet_booking_halls` child table carrying its own exclusion constraint, then the booking UI.
5. **Banquet completion.** Configurable bill terms, plate approval workflow, buffet booking type.
6. **Queue.** Waiter surface; QR self-join with rate limiting and signed tokens; dashboard queue matrix and daily chart.
7. **Offline routine answers.** Idempotency keys on checklist answers plus a service-worker queue, scoped strictly to routines.
8. **Operational hardening.** Load test against NFR-04; SSE Last-Event-ID replay; retention jobs; decision on self-service company creation.
