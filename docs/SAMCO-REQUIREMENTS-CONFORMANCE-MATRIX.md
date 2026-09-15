# SAMCO — Requirements Conformance Matrix

Traceability from the two supplied documents to the SAMCO codebase, as of the working tree on 2026-09-15 (uncommitted).

- **SRS**: `SRS_Restaurant_Operations_Platform.md`
- **P2**: `Module_Logic_and_Infrastructure_Cost_Plan.md` (Part II, Module Operating Logic)

**Classification.**
- **A**: applicable now.
- **B**: foundation now (extension point).
- **C**: future module (Inventory / Finance / POS and similar).
- **D**: non-functional / platform.
- **E**: recommendation.

**Status.**
- **Implemented**: built in this conformance pass.
- **Satisfied**: already met before this pass, re-verified.
- **Partial**: some of the requirement is met; the gap is stated.
- **Deferred**: not built now; the reason and dependency are in the report, §8.
- **Future**: belongs to a module outside this task.
- **Rejected**: deliberately not copied; the reason is in the report, §18.
- **N/A**: not applicable to code.

**Test references.**

| Prefix | Location |
|---|---|
| `api-e2e:` | `apps/api/test/*.e2e-spec.ts` |
| `api-unit:` | `apps/api/src/**/*.spec.ts` |
| `web:` | `apps/web/src/**/*.test.ts(x)` |
| `pw:` | Playwright, `apps/web/e2e/*.spec.ts` |

Totals are in the report, §4.

---

## 1. Cross-cutting platform

| Requirement | Source | Module | Classification | Current State | Gap | Implementation | Test | Status |
|---|---|---|---|---|---|---|---|---|
| FR-X1 Every operational record branch-scoped; All Branches is an aggregate only | SRS §4.1, P2 §1.1 | Foundation | A | All data is company+branch scoped, proved by PermissionGuard / AuthorizationService. There was no All Branches view. | All Branches aggregate | `GET /dashboard/all-branches`: every ACTIVE branch is proved individually, then counts and per-currency money are summed. Rates and durations are never summed. | api-e2e: reports RP-55..57; web: reports RF-30c; pw: conformance "All branches" | Implemented |
| FR-X1.a Operational screens require a specific branch | SRS §1.2 | Foundation | A | Layouts show "Select a branch" before any branch surface | — | — | web: banquet "asks for a branch first", queue sub-navigation | Satisfied |
| FR-X1.b Branch selection persists across reload and deep links | SRS §4.1, §8.3.2 | Foundation | E→A | Kept in per-tab sessionStorage only. Signed-out deep links were sent to `/login` and lost. | Persistence; deep links | localStorage keyed per user (one-time carry-over from sessionStorage). `/login?next=` with same-origin validation. | web: app-context-provider (reload, shared device, carry-over); next-path.test; pw: conformance "deep link survives", "off-site next ignored" | Implemented |
| FR-X1.c Inter-branch search toggle | SRS §4.1 | Foundation | A | Not present | Cross-branch search | — | — | Deferred |
| FR-X2 Per-user feature flags (~60) | SRS §4.3 | Foundation | E | Granular RBAC permissions | — | Not copied (instruction) | — | Rejected |
| FR-X2.a Named permission sets instead of per-user flags | SRS §4.3, §8.3.1 | Foundation | E | Company roles are named permission sets | — | — | api-e2e: rbac | Satisfied |
| FR-X2.b Access modes: own vs all records | SRS §4.2, P2 §1.2 | Tasks | A | Only `tasks.view` (all) existed | Own-only mode | `tasks.view_own` (additive). The service narrows results to assignee or creator. Any-of guard support added. | api-e2e: tasks "Own-task visibility (tasks.view_own)" | Implemented |
| FR-X2.c Branch capability boundary (module disabled per branch) | P2 §1.1 | Foundation | D | Not present | Per-branch module switches | — | — | Deferred |
| FR-X3 Audit every significant mutation (actor, company, branch, time, action, target, summary, redaction, immutable) | SRS §4.4, P2 §1.4 | Audit | A | Append-only `audit_logs`; strict in-transaction writes | System (scheduler) events had no representation | `systemEvent` flag: a company event with no actor, validated | api-unit: audit-logs.service.spec; api-e2e: BU-1/2, TU-2, TY-4 | Satisfied |
| FR-X3.a Old/new values for financial and settings changes | P2 §1.4, FR-BQ-05 | Audit / Banquet | A | Only `changed_fields` lists | Old → new values | `changes: {field: {from, to}}` on booking edits, pricing lines, payments (paid_minor), halls, packages, branch tax settings | api-unit: bookings spec "audits old and new values"; api-e2e: BQ-2, BQ-5, BQ-10 | Implemented |
| FR-X3.b Activity-log viewer; per-record audit information | SRS §4.4 | Audit | A | API `GET /audit-logs` only; the UI page was a "not available" placeholder | Viewer; per-record panel | `/settings/audit`: server-filtered and paged table with who / where / when / what (old → new). No per-record panel yet. | web: settings.test "Audit log"; pw: conformance "tax details … audit log" | Partial |
| FR-X4 Notifications (push, tiers, centre, unread, broadcast) | SRS §4.5, P2 §9 | Notifications | B | Not built | Entire module | None — no fake notifications (instruction) | — | Deferred |
| FR-X5 Offline tolerance for routine forms | SRS §4.6 | Routines | A/B | Online only | Local queue + sync | — | — | Deferred |
| FR-X6 Excel/PDF exports, printable KOT and bill, WhatsApp share | SRS §4.7, P2 §1.6 | Exports | A | Report XLSX/PDF existed with ISO dates and UTC | en-IN / branch time; KOT; bill; share | Exports use dd/MM/yyyy, the en-IN clock, branch wall clock and branch name. Print pages for bill and KOT. No WhatsApp share. | api-unit: report-export.service.spec; web: banquet "bill and KOT"; pw: conformance KOT/bill | Partial |
| FR-X7 Tenant typography scale for wall displays | SRS §4.8 | Displays | A | None | Scale control | Per-device density and fullscreen controls (presentation only). No tenant-wide scale. | web: display-controls.test, display.test | Partial |
| FR-X8 Logged devices and remote logout | SRS §4.8 | Auth | A | Sessions revocable internally; no list | Device list; remote sign-out | `user_agent` / `ip_address` / `last_used_at` on sessions. `GET /auth/sessions` returns an opaque handle, never the session id. `DELETE /auth/sessions/:handle`. `/settings/devices` page linked from the header. | api-e2e: sessions SD-1..5; web: settings "Signed-in devices", app-shell; pw: conformance "signing out another device" | Implemented |
| FR-X9 Per-routine submission deadlines | SRS §4.8, P2 §1.8 | Routines | A | Due at `time_of_day` only | Separate deadline | `TaskRoutine.due_time` (≥ `time_of_day`), used for `due_at` | api-e2e: tasks "Routine deadlines" | Implemented |
| FR-X10 Daily closing | SRS §4.8 | Finance | C | — | — | — | — | Future |
| FR-X11 Only a Super Admin may delete a Super Admin | SRS §3 | Users | A | No user-deletion path exists; `is_superadmin` bypasses nothing | — | — | api-unit: permission.guard.spec | N/A |
| FR-X12 Photo evidence per item (object storage) | P2 §1.5, §17 | Media | B | No object storage | Storage, upload, thumbnails | None — no fake upload (instruction) | — | Deferred |
| X-AUTHZ Server-side authorization; context headers are never proof; default deny | Task §9, NFR-05 | Foundation | A | PermissionGuard on routes; a route without metadata passes through | No proof that every route is guarded | Route-inventory test classifies every route as PERMISSION / DEVICE / SELF / TICKET / PUBLIC, with allow-lists and reasons | api-e2e: route-inventory RI-1..5 | Implemented |
| X-ESC Role assignment cannot escalate privileges | Task §9 | Users | A | A user could assign a role carrying permissions they did not hold, including to themselves | Escalation | 403 on self-assignment; 403 when the role carries any permission the actor lacks | api-e2e: rbac S1-a/b/c | Implemented |
| X-RT Realtime publish after commit only | Task §9 | Realtime | A | EventBroker publish after the transaction returns | — | New `banquet.booking.updated` follows the same rule | api-unit: bookings "publishes … AFTER"; api-e2e: BR-1..5 | Satisfied |
| X-L10N en-IN, ₹, dd/MM/yyyy, branch-local dates, CGST/SGST | NFR-07, Task | All | D | Viewer locale; device timezone on banquet forms; ISO dates in reports | Consistent en-IN, branch timezone | `lib/format/datetime.ts`; branch-timezone datetime inputs on banquet; report formatting; exports | web: format/datetime.test, reports RF-5/5b/13, banquet "branch timezone"; api-unit: export spec | Implemented |
| X-HDR Response hardening, proxy trust | Task §15 | Platform | D | None | Headers | API: nosniff / DENY / no-referrer / CORP / CSP / Permissions-Policy, HSTS in production, `TRUST_PROXY`. Web: Next headers and `poweredByHeader: false`. | api-unit: security-headers.spec | Implemented |
| X-SCHED Scheduled jobs across replicas | P2 §13 | Scheduler | D | Per-process timers; the duplicate-run risk was documented | Cross-process exclusion | PostgreSQL transaction-scoped advisory lock (`JOB_LOCK`); `skippedLocked` counter. No Redis. | api-unit: job-registry "with a cross-process lock" | Implemented |

## 2. Dashboard

| Requirement | Source | Module | Classification | Current State | Gap | Implementation | Test | Status |
|---|---|---|---|---|---|---|---|---|
| FR-DB-01 KPIs for a date range and branch scope, incl. All Branches | SRS §5.1 | Dashboard | A | Branch dashboard, fixed 30-day default; widgets run sequentially | Range selection; All Branches | Period presets; All Branches aggregate; permissions resolved once; widgets run concurrently | api-e2e: RP-44..48, RP-55..57; web: RF-24..30c | Implemented |
| FR-DB-01.a Presets Today / This Week / This Month / Custom | SRS §5.1 | Dashboard | A | None | Presets | Today, Last 7 days, Last 30 days, This month. Custom ranges only on report pages. | web: RF-30b; pw: conformance "dashboard periods" | Partial |
| FR-DB-01.b Queue KPI cards (Total, Waiting, Seated, No-shows) | SRS §5.1 | Dashboard | A | `queue.today`: waiting, called, adults, kids, seated, longest wait | Total walked in, no-shows on the tile | — (no-shows are in the queue.summary report) | api-e2e: RP-44 | Partial |
| FR-DB-01.c Queue overview matrix per branch | SRS §5.1 | Dashboard | A | None | Matrix | All Branches gives a per-branch breakdown for each tile. No dedicated Seated/Cancelled/Total matrix. | web: RF-30c | Partial |
| FR-DB-01.d Daily queue chart (this month) | SRS §5.1 | Dashboard | A | None | Chart | — | — | Deferred |
| FR-DB-01.e Task statistics | SRS §5.1 | Dashboard | A | `tasks.open` widget | — | — | api-e2e: RP-46 | Satisfied |
| FR-DB-01.f Revenue / inventory widgets | SRS §5.1 | Finance / Inventory | C | — | — | Not fabricated (instruction) | — | Future |
| FR-DB-02 Widgets depend on permissions | SRS §5.1 | Dashboard | A | Server drops widgets whose domain permission is missing | — | Same rule applied per branch for All Branches | api-e2e: RP-45, RP-56 | Satisfied |
| FR-DB-03 Pre-computed rollups | SRS §5.1, P2 §14.2 | Dashboard | E | Live aggregate queries | Rollup tables | — | — | Deferred |

## 3. Queue (Phase 7)

| Requirement | Source | Module | Classification | Current State | Gap | Implementation | Test | Status |
|---|---|---|---|---|---|---|---|---|
| FR-Q-01 Sequential daily tokens, atomic allocation | SRS §5.2.1, P2 §2.7 | Queue | A | INSERT … ON CONFLICT counter per branch/day | — | — | api-e2e: queue concurrency | Satisfied |
| FR-Q-02 Realtime on all queue screens | SRS §5.2.1 | Queue | A | SSE broker; public projections for displays | — | New SKIPPED / CHECKED_IN / ACTIVATED events | api-e2e: queue realtime; pw: display live tests | Satisfied |
| FR-Q-03 Live wait time from join timestamp, client side | SRS, P2 §2.7 | Queue | A | Static times | Live timer | `useNow` + `minutesSince` on cards | web: queue-podium | Implemented |
| FR-Q-04 Seating by table or capacity | SRS | Queue | A | Seat with table; one seated party per table (partial unique index) | — | Table availability endpoint for the podium | api-e2e: queue QK | Satisfied |
| FR-Q-05 Call stamps time; phone and WhatsApp contact | SRS | Queue | A | Call stamps time; no contact | Contact | `GET queue-tokens/:id/contact`: needs queue.call + customers.view; audited SECURITY; WhatsApp link only for E.164 numbers; never on boards | api-e2e: QK contact; web: queue-podium | Implemented |
| FR-Q-06 Advance bookings held as scheduled, surface at booked time | SRS, P2 §2.4 | Queue | A | None | SCHEDULED state | SCHEDULED status, same service day. Scheduler `queue.scheduled.activate` (idempotent batches); manual check-in. | api-unit: queue-tokens spec; api-e2e: QK | Implemented |
| Q-STAT Statuses incl. scheduled and skipped | SRS §5.2.7, P2 §2.2 | Queue | A | waiting / called / seated / no-show / cancelled | scheduled, skipped | Skip is CALLED→WAITING with `skipped_at` / `skip_count` ordering | api-unit: queue-state-machine.spec | Implemented |
| Q-PODIUM Next card, register, available tables, waiting list with elapsed time | SRS §5.2.1 | Queue | A | Podium existed | Tables, totals, scheduled section | Table availability, adults/kids totals, scheduled list, contact | web: queue-podium | Implemented |
| Q-KIOSK Registration surface | SRS §5.2.2 | Queue | A | Staff register page | — | Same-day scheduling check in branch timezone | web: queue register | Satisfied |
| Q-ADMIN Admin display tiles (waiting, adults, kids) | SRS §5.2.3 | Displays | A | Counts only | Tiles | Totals tiles on the admin board | web: display-boards.test | Implemented |
| Q-WAITER Waiter screen | SRS §5.2.4 | Queue | A | None | Surface | — | — | Deferred |
| Q-WAITER-ADHOC Waiters create tables ad hoc | SRS §5.2.4 | Queue | E | — | — | Rejected: tables stay one source of truth | — | Rejected |
| Q-SIGNAL Waiter↔podium signalling | SRS §5.2.4, P2 §2.5 | Queue | A/B | None | Signals | — | — | Deferred |
| Q-DISPLAY NOW SERVING / WAITING, density, fullscreen | SRS §5.2.5 | Displays | A | Boards existed | Density, fullscreen, waiting tokens | DisplayControls (per device); waiting token list | web: display-controls.test, display.test | Implemented |
| Q-PUBLIC QR self-join | SRS §5.2.6, P2 §2.1 | Queue | B/E | None | Public surface | — | — | Deferred |
| Q-REPORTS Queue report, log, export | SRS §5.2.8 | Reports | A | queue.summary, queue.tokens (+ export) | — | SCHEDULED in the status filter | api-e2e: RP-29, RP-34 | Satisfied |
| Q-PURGE Bulk queue deletion | SRS §5.2.8 | Queue | E | — | — | Rejected: destructive; append-only history | — | Rejected |
| Q-TABLES One source of truth for tables | SRS §8.3.3 | Tables | A | Single tables module | An occupied table could be deactivated | 409 when deactivating a table with a SEATED party | api-e2e: QK tables | Implemented |
| Q-POS-TABLE Release table on POS bill close | P2 §2.3 | POS | C | — | — | — | — | Future |

## 4. Banquet (Phase 8)

| Requirement | Source | Module | Classification | Current State | Gap | Implementation | Test | Status |
|---|---|---|---|---|---|---|---|---|
| FR-BQ-01 Availability per hall × slot × date (Available / Partial / Full) | SRS §5.3.3 | Banquet | A | None | Slots; availability | `banquet_hall_slots` (branch-local HH:mm, overnight aware). `GET /banquet/availability` (≤62 days): slot states available / tentative / booked; day states available / partial / full. | api-e2e: BQ-9; web: banquet "availability calendar"; pw: calendar on phone | Implemented |
| FR-BQ-02 Several hall+slot combinations per booking; no double booking | SRS §5.3.3 | Banquet | A | One hall window per booking. PostgreSQL exclusion constraint on (hall, tstzrange) for CONFIRMED/COMPLETED. | Multi-hall bookings | Double booking impossible, including on edits and hall moves. Multi-hall events are separate bookings. | api-e2e: BC-1..10, BX-1, BQ-9 | Partial |
| FR-BQ-03 Past bookings editable only by Super Admin | SRS §5.3.3 | Banquet | A | Only drafts were editable | Past-date control | `banquet.booking.edit_past` checked in the service for edits and pricing lines once `starts_at` has passed | api-unit: bookings "past events"; api-e2e: BQ-5; web: "keeps a started event read-only" | Implemented |
| FR-BQ-04 Snapshot menu, hall and price onto the booking | SRS §5.3.3, P2 §3.10 | Banquet | A | Package name, price and items snapshotted | Hall name | `banquet_bookings.hall_name` (backfilled); GST rate snapshot | api-e2e: BB-2, BQ-1, BQ-10 | Implemented |
| FR-BQ-05 Financial changes audited with old and new values | SRS §5.3.3 | Banquet | A | Actions only | Values | See FR-X3.a | api-e2e: BQ-2 | Implemented |
| BQ-CAL Month and week availability calendar | SRS §5.3.1 | Banquet | A | None | Calendar | `/banquet/calendar`: week/month, previous/today/next, hall filter, links to bookings | web: banquet calendar tests; pw: conformance | Implemented |
| BQ-LIST Drafts/Upcoming tabs, pending filter, hall filter, search, date range by event/advance/final date | SRS App. B | Banquet | A | Status filter only | Tabs, filters, search, payment dates | `tab`, `payment` (pending / paid / unverified), `q`, `hall_id`, `date_field` (event / advance / final); stable ordering | api-e2e: BQ-8; web: "filters by tab, payment state and search" | Implemented |
| BQ-SETUP Halls add/rename/remove, slots, merge, images | SRS §5.3.2 | Banquet | A | Create, activate/deactivate halls | Slots; rename; guard; merge; images | Slots CRUD; rename keeps booking snapshots; deactivation refused while upcoming confirmed events exist. No hall merge or images. | api-e2e: BQ-9, BQ-10; web: "adds a slot to a hall" | Partial |
| BQ-LIFE Draft → confirmed → completed / cancelled | SRS, P2 §3.3 | Banquet | A | State machine with conditional updates | — | Confirmed bookings are now editable | api-unit: state-machine spec; api-e2e: BL-1..6, BB-7 | Satisfied |
| BQ-PRICE Rate × guaranteed pax + extra pax + extra charges − line / per-head / admin discounts; GST 5% as CGST+SGST; no-GST mode; GSTIN / FSSAI on branch | SRS, P2 §3.4 | Banquet | A | price × guests only | Whole layered bill | `priceBooking()` in integer minor units, half-up per-half GST. Append-only `banquet_booking_adjustments` with reversals. Three separately permissioned kinds. Branch `banquet_gst_rate_bps`, `gstin`, `fssai_license`. `apply_gst`. | api-unit: banquet-money "layered pricing"; api-e2e: BQ-1..4, BQ-13; web: GST / discount tests; pw: charge re-prices | Implemented |
| BQ-PAY Advance / interim / final stages, mode, split payments, verification, pending / partial / paid, history | SRS, P2 §3.5 | Banquet | A | Append-only payments, derived balance | Stages; verification; status | Server-decided `kind`. Append-only `banquet_payment_verifications` (a second person, once). `payment_status`. Stored `paid_minor` with the DB CHECK `paid_minor ≤ total`. | api-unit: payments/verification; api-e2e: BQ-6, BQ-7, BX-3, BM-1..7; web: verify tests; pw: "only a second person may verify" | Implemented |
| BQ-PAY-EDIT Edit or delete payments (logged) | SRS | Banquet | E | Append-only (DB triggers) | — | Rejected: history is never rewritten | api-e2e: BM-5, BM-6 | Rejected |
| BQ-VOUCHER Advance held as voucher on cancellation | SRS, P2 §3.5 | Finance | E | Payments stay recorded on the cancelled booking | Voucher ledger | — (finance semantics) | api-e2e: BQ-11 | Deferred |
| BQ-BUFFET Dine-in buffet booking type | SRS §5.3.4 | Banquet | A/B | None | Booking type | — | — | Deferred |
| BQ-KDS Chef display and realtime KDS | SRS §5.3.5 | Banquet | A | Chef display, staff board, item lifecycle | Customer names shown to kitchen-only roles | `customer_name` filled only for callers who also hold banquet.view. Chef plates = guaranteed + extra pax. | api-e2e: BQ-12, BD-1..7; pw: display chef tests | Implemented |
| BQ-PLATE Plate approval workflow | SRS §5.3.5, P2 §3.6 | Banquet | A | None | Workflow | — | — | Deferred |
| BQ-KOT Printable KOT "NOT A BILL - KITCHEN ONLY" | SRS §5.3.5 | Banquet | A | None | KOT | `/banquet/[id]/kot`: confirmed and completed only; no money or customer | web: "the KOT says it is not a bill"; pw: conformance KOT | Implemented |
| BQ-FIN Banquet finance overview: outstanding, received, balance due | SRS §5.3.6 | Banquet | A | Overview widget, bookings / payments reports | Outstanding list | `banquet.outstanding` report from payment history, per currency, with drill-down | api-e2e: RP-59; pw: outstanding drill-down | Implemented |
| BQ-TERMS Printable bill with configurable T&Cs | SRS §5.3.7 | Banquet | A | None | Bill; T&Cs | `/banquet/[id]/bill`: branch identity, GSTIN, FSSAI, layered lines, CGST/SGST, payments; a draft prints as a quotation. No configurable T&Cs. | web: bill tests; api-e2e: BQ-13; pw: conformance bill | Partial |
| BQ-PUBLIC Public booking link and customer edit requests | SRS §5.3.7, P2 §3.8 | Banquet | E | None | Public surface | — | — | Deferred |
| BQ-REPORTS Booking and revenue reports | SRS §5.3.7 | Reports | A | banquet.bookings, banquet.payments | Stable ordering; drill-down | id tie-breakers; `booking_id` drill-down; outstanding report | api-e2e: RP-30, RP-31, RP-58 | Implemented |
| BQ-CHECKLIST Banquet opening checklist | SRS §5.4.2 | Routines | A | Generic checklists | Definition | Reference library "Banquet Opening Checklist" | api-e2e: TY-5 | Implemented |
| BQ-MONEY Integer minor units, no floating point | Task §7 | Banquet | A | Integer minor units throughout | — | GST rounding in integers | api-unit: banquet-money | Satisfied |
| BQ-OVERPAY Concurrent payments never overshoot | Task §7 | Banquet | A | Row lock + history sum | Not enforced by the database | `paid_within_total` CHECK; every booking mutation takes the row lock | api-e2e: BX-3, BQ-4 | Implemented |
| BQ-DOUBLE No concurrent double booking (DB constraint) | Task §7 | Banquet | A | Exclusion constraint | — | — | api-e2e: BC-9, BX-1 | Satisfied |
| BQ-CANCEL Cancellation behaviour | Task §7 | Banquet | A | Cancel releases the hall | Reason; money treatment | `cancellation_reason` (audit records only its presence); payments retained; no silent refund | api-e2e: BQ-11; web: "cancels with the reason" | Implemented |

## 5. Tasks & routines (Phase 9)

| Requirement | Source | Module | Classification | Current State | Gap | Implementation | Test | Status |
|---|---|---|---|---|---|---|---|---|
| T-FIELDS Title, priority, assignee, due date/time, comments | SRS §5.4.1, P2 §4.1 | Tasks | A | No comments; no editing | Comments; edits | Append-only `task_comments`; edit with change diff | api-e2e: "Edits and comments" | Implemented |
| T-PERMS Create / submit / edit-assigned / reassign / view-own / view-staff | SRS, P2 §4.1 | Tasks | A | view / create / update / assign / start / complete / cancel | view-own | `tasks.view_own`; assignment is responsibility, never authorization | api-e2e: tasks Authorization, "Own-task visibility" | Implemented |
| T-REASSIGN Reassignment tracked | SRS | Tasks | A | Not tracked | Count and actor | `assigned_by`, `assigned_at`, `reassignment_count` | api-e2e: "Ownership and reassignment" | Implemented |
| T-LIST Scope and status filters, cards with assignor→assignee | SRS | Tasks | A | Board with filters | — | `unassigned` / `overdue` boolean query parsing fixed | api-e2e: "Query flags" | Satisfied |
| T-TEMPLATES Task templates | SRS, P2 §4.1 | Tasks | A | Checklist templates plus routines | One-off task templates | Covered by checklist templates and routines | — | Partial |
| T-DASH Task dashboard statistics | SRS | Tasks | A | Summary page and tasks.open widget | — | — | api-e2e: "Dashboard and completion reporting" | Satisfied |
| T-CAL Activity calendar generating assignments | SRS, P2 §4.1 | Tasks | E | None | Calendar | — | — | Deferred |
| R-ENGINE One configurable routine engine, definitions as data | SRS §8.2.1, P2 §4.2 | Routines | A | Routines + checklist templates + idempotent materialization | Typed items | Same engine extended; no per-routine implementations | api-e2e: Routines, TY-1..6 | Implemented |
| R-ITEMTYPES Boolean, rating, number, text, photo, date, signature | P2 §4.3 | Routines | A | Tick only | Types | `ChecklistItemKind` CHECK / NUMBER / TEXT / RATING / DATE; canonical text values; DB CHECKs. No photo or signature. | api-unit: checklist-values.spec; api-e2e: TY-1..4; web: typed answer tests; pw: typed answers | Partial |
| R-ONE-PER-DAY One occurrence per routine per branch-local day | P2 §4.5 | Routines | A | Unique (routine_id, occurrence_date) | — | — | api-e2e: Scheduler integration | Satisfied |
| R-VIEW Supervisor view, submissions list, transposed log | SRS §5.4.2 | Routines | A | Task board | Transposed log | `GET /routines/:id/log` (≤62 days) and `/tasks/routines/[id]/log`: items × dates, answers, misses, late marks | api-e2e: TY-6; web: "Routine compliance log" | Implemented |
| R-DEADLINE Deadlines and missed-deadline reporting | SRS, P2 §1.8 | Routines | A | Missed counts | Late vs on time | tasks.routines report: `on_time`, `late`, `on_time_rate` | api-e2e: RP-60, "Routine deadlines" | Implemented |
| R-EXPORT Excel/PDF of submissions | SRS | Routines | A | Adherence report exportable | Transposed log export | — | api-e2e: RP-37 (engine) | Partial |
| R-MODE Admin / staff access per routine | SRS | Routines | A | Permissions (view vs view_own) | Per-routine mode | Permission-based (deviation, report §18) | — | Satisfied |
| R-OFFLINE Offline capture and deferred sync | SRS, P2 §1.7 | Routines | A/B | Online only | Offline | — | — | Deferred |
| R-PHOTO Item-level photo evidence | SRS, P2 §1.5 | Routines | B | None | Object storage | — | — | Deferred |
| R-11 The eleven reference routines as definitions | SRS §5.4.2, P2 §4.2 | Routines | A | None | Definitions | Reference library of 8 installable definitions built only from items the source names. Kitchen, BM and Operational checklists are not offered (no items named). | api-e2e: TY-5; web: library tests; pw: install EOD | Partial |

## 6. Reports & exports (Phase 10)

| Requirement | Source | Module | Classification | Current State | Gap | Implementation | Test | Status |
|---|---|---|---|---|---|---|---|---|
| RPT-FILTER Branch + date range, role-scoped | SRS §5.8, P2 §8 | Reports | A | Two-key authorization; branch-local ranges ≤366 days | — | Catalogue permissions resolved once | api-e2e: RP-1..28 | Satisfied |
| RPT-DRILL Drill-down to the source record | SRS §5.8 | Reports | A | None | Links | `definition.drilldown`; validated link in the first cell | api-e2e: RP-58; web: RF-13c; pw: outstanding drill-down | Implemented |
| RPT-EXPORT Excel + PDF | SRS §5.8 | Reports | A | XLSX/PDF, ISO/UTC formatting | Localisation | Branch name, dd/MM/yyyy, en-IN numbers, branch wall clock in cells | api-unit: export spec; api-e2e: RP-37..43 | Implemented |
| RPT-SHARE WhatsApp share | SRS §5.8 | Reports | E | None | Share | — | — | Deferred |
| RPT-LIST Queue, task, activity, banquet, routine-compliance reports | SRS §5.8 | Reports | A | 7 reports | Outstanding; compliance | + banquet.outstanding; routine on-time/late; audit viewer | api-e2e: RP-7, RP-59, RP-60 | Implemented |
| RPT-ASYNC Job-queue exports, read replica | P2 §18 | Reports | E | Synchronous, capped at 5,000 rows | — | Rejected for now (instruction: no background / Redis architecture without load) | api-unit: export bounds | Rejected |
| RPT-PAGE Stable pagination, bounded offsets | Task §15 | Reports | D | ORDER BY without tie-breakers; unbounded offset | Stability; bound | id tie-breakers; offset ≤100,000 | api-unit: reports.dto.spec; api-e2e: RP-61 | Implemented |
| RPT-RUN No dead controls | Task §16 | Reports | A | "Run" did nothing when nothing had changed | Dead button | Run nonce re-queries | web: RF-13b | Implemented |

## 7. Future modules (not built — separated per instruction)

| Requirement | Source | Module | Classification | Current State | Gap | Implementation | Test | Status |
|---|---|---|---|---|---|---|---|---|
| Inventory & procurement (stock ledger, suppliers, POs, transfers) | SRS §5.5, P2 §5 | Inventory | C | Permission keys reserved only | Module | None. Kitchen balance / wastage / indent routines capture figures as answers, with no posting. | — | Future |
| Finance (expenses, petty cash, daily closing, UPI) | SRS §5.6, P2 §6 | Finance | C | Permission keys reserved only | Module | None; no fabricated dashboard values | — | Future |
| POS incl. menu, billing, POS KDS / KOT routing | SRS §5.7, P2 §7 | POS | C | Permission keys reserved only | Module | None | — | Future |
| AI assistant; cleaner / head consoles | SRS §5.10–5.11, P2 §11 | Other | C | — | — | None | — | Future |

## 8. Non-functional and platform

| Requirement | Source | Module | Classification | Current State | Gap | Implementation | Test | Status |
|---|---|---|---|---|---|---|---|---|
| NFR-01 Realtime about 1 s | SRS §7 | Realtime | D | SSE push; displays with a safety poll | — | — | pw: display "live, without a reload" (≤10 s bound) | Satisfied |
| NFR-02 Responsive desktop / tablet / phone; wall display | SRS §7 | Web | D | Responsive shell; phone checks | New screens | Calendar, log and audit tables scroll inside their own wrappers; forms wrap | pw: conformance phone and tablet, roles "works on a phone" | Satisfied |
| NFR-03 Offline tolerance for routine forms | SRS §7 | Routines | D | — | Offline | — | — | Deferred |
| NFR-04 Dashboard and report under 3 s | SRS §7 | Reports | D | Sequential permission checks | Proof under load | Single permission resolution; concurrent widgets; bounded ranges and offsets. Not load-tested. | — | Partial |
| NFR-05 Server-side authorization | SRS §7 | Foundation | D | PermissionGuard | Default deny not proved | See X-AUTHZ | api-e2e: route-inventory | Implemented |
| NFR-06 Immutable audit for money and bookings | SRS §7 | Audit | D | audit_logs, banquet_payments append-only | New money rows | Adjustments and verifications append-only by trigger | api-e2e: BQ-3 | Implemented |
| NFR-07 en_IN, ₹, dd/MM/yyyy, CGST/SGST | SRS §7 | All | D | Partial | Consistency | See X-L10N and BQ-PRICE | web / api-unit as above | Implemented |
| NFR-08 Accessible DOM customer screens | SRS §7 | Displays | D | DOM boards with roles and labels | — | — | web: display tests | Satisfied |
| NFR-09 Retention (notifications, queue history, audit) | SRS §7 | Platform | D | Retained indefinitely | Policy and jobs | — | — | Deferred |
| NFR-10 Multi-tenancy designed in | SRS §7 | Foundation | D | Company + branch scoping everywhere | — | — | api-e2e: isolation tests across suites | Satisfied |
| P2-OPS Environments, CI, backups / PITR, monitoring, residency | P2 §20 | Ops | D | Outside the repository | Ops work | — | — | Deferred |
| P2-RT Resume tokens, deltas, optimistic UI | P2 §19 | Realtime | D | Refetch-on-event; resync on reconnect | Last-Event-ID replay | — | web: use-queue-board "resyncs when the stream reopens" | Partial |
| P2-INFRA Redis, read replica, workers, object storage, CDN | P2 §13 | Platform | E | PostgreSQL + in-process broker / scheduler | — | Not introduced (instruction); the job lock uses PostgreSQL | — | Rejected |
| P2-COST Budget / TCO | P2 §15–22 | — | — | — | — | — | — | N/A |
