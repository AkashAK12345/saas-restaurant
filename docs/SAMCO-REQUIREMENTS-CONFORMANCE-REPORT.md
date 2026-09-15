# SAMCO — Requirements Conformance Report

Working tree on 2026-09-16, on top of checkpoint `21fa790`. **Nothing in this pass has been committed or pushed.**

The requirement-by-requirement traceability is in `docs/SAMCO-REQUIREMENTS-CONFORMANCE-MATRIX.md`. This report summarises it, records the decisions taken, and states plainly what is not done.

---

## 1. Executive summary

This pass closed the remaining applicable gaps left after the first conformance pass, on SAMCO's own architecture:
- NestJS, Prisma/PostgreSQL, Next.js;
- server-side authorization with company and branch tenancy;
- the existing audit log, SSE broker, scheduler and report registry.

No second authorization, realtime or scheduling system was added, and no Redis, object store, Firebase or client-side database access.

**Highest-priority fix.** Any signed-in user could create a company (`POST /companies`). Company creation now requires an ACTIVE platform administrator, checked server-side against the database on every request. `is_superadmin` still grants nothing inside any company.

**Placeholders replaced.** Customers, Tables, Displays, Users and Roles are now working screens over the existing APIs. Three small read endpoints were added where a screen could not otherwise be honest: customer search, the permission catalogue, and a user's branch-role assignments.

**Previously partial or deferred items now met.**
- Dashboard:
  - a custom period;
  - customers and no-shows today;
  - the queue overview matrix;
  - the daily queue chart.
- Queue: the waiter floor view.
- Audit: the per-record history panel.
- Banquet:
  - configurable bill terms;
  - the plate approval workflow.
- Routines: export of the compliance log.
- Foundation: company and branch administration.

**Outcome by requirement** (131 matrix rows):

| Status | Count |
|---|---|
| MET | 89 |
| PARTIAL | 11 |
| DEFERRED | 11 |
| FUTURE MODULE | 8 |
| NOT APPLICABLE | 3 |
| RECOMMENDATION | 9 |

**Verification.** Every check below was run after the last code change.

| Check | Result |
|---|---|
| API unit | 729/729 |
| API E2E | 690/690 |
| Web | 466/466 |
| Playwright | 51/51 |
| Lint | PASS |
| Typecheck | PASS |
| API build | PASS |
| Web build | PASS |
| Prisma validate | PASS |
| Migration status | PASS (19 migrations; "Database schema is up to date") |
| Drift | NONE (`prisma migrate diff` from `samco_e2e` to `schema.prisma` is an empty migration) |

**SAMCO is not fully conformant.** The PARTIAL and DEFERRED rows in §7 and §8 remain, and several need a decision before they can be built (§19).

## 2. Documents reviewed

- `SRS_Restaurant_Operations_Platform.md` and `Module_Logic_and_Infrastructure_Cost_Plan.md` (Part II). Both were read in full in the first pass. For this pass, the sections behind every PARTIAL or DEFERRED row were re-read:
  - dashboard §5.1;
  - waiter screen §5.2.4;
  - QR self-join §5.2.6;
  - buffet §5.3.4;
  - plate approval §5.3.5;
  - bill terms §5.3.7;
  - routines and item types §4.2–§4.3;
  - notifications §9.
- `docs/SAMCO-REQUIREMENTS-CONFORMANCE-MATRIX.md` and this report as committed in `21fa790`.

Claims in the previous report were checked against the code, not trusted:
- **Checked and confirmed:**
  - the route inventory;
  - `is_superadmin` bypassing nothing;
  - the banquet money rules;
  - the queue counter.
- **Found wrong:** the previous report classified `POST /companies` as acceptable self-service. It was an authorization gap and is now fixed (§10, S11).

## 3. Current SAMCO scope audited

| Area | What was audited |
|---|---|
| Foundation / administration | Company creation, companies, branches (lifecycle and settings), users, memberships, roles and the permission catalogue, audit, display devices, signed-in devices, localisation, responsive layouts |
| Authorization chain | Authenticated → active user → active membership → branch in company and active → role → permission; context headers as requests only; route inventory |
| Queue | Tokens, podium, register, tables and occupancy, displays, realtime |
| Banquet | Bookings, pricing and payments, bill and KOT, kitchen board, catalogue |
| Tasks & routines | Tasks, checklists, routines, compliance log |
| Reports & dashboard | Registry, widgets, All Branches, exports |
| Not built (per instruction) | Inventory, Procurement, Finance, POS, POS KDS, menu management, supplier workflow, financial ledger |

## 4. Requirements coverage summary

| Area | MET | PARTIAL | DEFERRED | FUTURE MODULE | NOT APPLICABLE | RECOMMENDATION |
|---|---|---|---|---|---|---|
| Cross-cutting platform and administration (34) | 24 | 3 | 4 | 1 | 1 | 1 |
| Dashboard (9) | 7 | 0 | 0 | 1 | 0 | 1 |
| Queue (19) | 14 | 1 | 1 | 1 | 0 | 2 |
| Banquet (26) | 20 | 2 | 2 | 1 | 0 | 1 |
| Tasks & routines (17) | 11 | 3 | 2 | 0 | 0 | 1 |
| Reports & exports (8) | 6 | 0 | 0 | 0 | 0 | 2 |
| Future modules (4) | 0 | 0 | 0 | 4 | 0 | 0 |
| Non-functional and platform (14) | 7 | 2 | 2 | 0 | 2 | 1 |
| **Total (131 rows)** | **89** | **11** | **11** | **8** | **3** | **9** |

These counts were produced mechanically from the matrix's Status column.

## 5. Requirements implemented in this pass

**Security and foundation.**
- **X-PLATFORM: company creation.**
  - `PlatformAdminGuard` admits an ACTIVE user whose `is_superadmin` flag is read fresh from the database on every request.
  - Company roles held anywhere, `X-Company-ID`, and a smuggled body flag are all irrelevant.
  - The route inventory has a PLATFORM class, and RI-6 proves the guard sits only on the listed route.
- **ADM-CUSTOMERS.**
  - Server-side search by name, or by phone digits, with LIKE wildcards escaped. Status filter and paging.
  - Phones are masked in the list and shown in full in the details panel.
  - Add, edit, mark inactive.
- **ADM-TABLES.**
  - Seats, zone, and in or out of service.
  - Live occupancy from the queue for `queue.view` holders.
  - Add and edit; the API's 409 for a seated table is shown.
- **ADM-DISPLAYS.**
  - The pairing code is shown once. It is held in memory only and forgotten on "Done" or on leaving the page.
  - Revoke requires a confirmation step. A revoked code cannot pair.
- **ADM-USERS.**
  - New `GET /users/:id/branch-roles`, company-scoped; 404 for anyone without an ACTIVE membership.
  - The Users screen covers:
    - members, including removed ones;
    - add user, with an initial password typed by the administrator;
    - rename;
    - remove or restore membership;
    - disable or enable sign-in;
    - assign and remove roles at the selected branch.
  - Nobody is offered controls over their own access.
- **ADM-ROLES.**
  - New `GET /roles/permissions`: the seeded catalogue, read-only.
  - The Roles screen covers create, rename and edit permissions, grouped by module.
  - Permissions the editor does not hold are disabled; the API still refuses them.
- **ADM-BRANCHES.**
  - Add a branch with an IANA time zone.
  - Rename a branch; activate or deactivate it after confirmation.
  - Rename the company.
  - The shell context reloads after each change.
- **FR-X3.b: per-record history.**
  - `RecordHistory` on banquet bookings and tasks.
  - Loaded only when opened, and only for `audit_logs.view`; filtered server-side by record type and id.

**Dashboard.**
- **FR-DB-01.a.** Custom period, checked against the server's 366-day limit before sending.
- **FR-DB-01.b.** `queue.today` adds Customers today and No-shows today.
- **FR-DB-01.c.**
  - A new `queue.overview` widget: walked in, seated, cancelled and no-shows for the period.
  - All Branches renders every widget as a matrix: an All-branches column, then one column per branch. Only counts and money are summed.
- **FR-DB-01.d.**
  - A new `queue.daily` series widget returns every date in the window, with zeroes included.
  - The chart is accessible: a figure selector, a branch selector on All Branches, a text summary and a data table.
  - Series are summed date by date across branches (`sumSeries`).

**Queue.**
- **Q-WAITER.** `/queue/tables`, needing `queue.seat`.
  - Every table is shown as free, occupied (today or from an earlier date) or out of service.
  - Staff can seat a called party, assign a table to a party already seated, or mark a table cleared.
  - It uses the existing queue operations and stream.
- **Q-SIGNAL (partial).** Seating and "Table cleared" reach the podium live over the stream.

**Banquet.**
- **BQ-TERMS.**
  - Branch `banquet_terms`, capped at 4,000 characters by a DB CHECK.
  - Edited in branch settings and printed at the foot of every bill and quotation.
  - The audit records that the terms changed and their length, never the text.
- **BQ-PLATE.**
  - New table `banquet_plate_requests`: REQUESTED → APPROVED → DISPATCHED, or REJECTED with a reason.
  - Permissions:
    - new `banquet.plate.request` to ask;
    - `banquet.kds.manage` to decide and dispatch.
  - Nobody decides their own request: enforced in the service and by a DB CHECK.
  - Status changes are conditional updates, audited, and published after commit with no customer or money data.
  - Booking page Plates panel; kitchen page request list.

**Routines.**
- **R-EXPORT.**
  - `GET /routines/:id/log/export?format=xlsx|pdf`.
  - Needs `tasks.reports.view` on the route, plus `reports.export`.
  - Rendered by the shared report exporter and audited.
  - PDF is refused beyond 14 date columns.
  - Export Excel / Export PDF buttons on the log page.

**Performance.**
- **NFR-04.** An opt-in load test (`SAMCO_PERF=1`) that seeds realistic volume and measures dashboard, report and export latency. Results are in §12.

## 6. Requirements already met before this pass

All rows that were MET after the first pass were re-verified by their tests, which still pass. The matrix keeps them as MET.

## 7. Requirements partially satisfied

| Requirement | What is met | What is missing, and why |
|---|---|---|
| FR-X1.c | Customer search spans every branch of the company | Cross-branch search of branch records. The SRS does not say which records or who may use it; each branch would have to be authorized individually. |
| FR-X6 | Localised XLSX/PDF; bill, KOT; routine log export | WhatsApp share: it sends business files to an external service and needs a sharing policy and provider. |
| FR-X7 | Per-device density and fullscreen | A tenant-wide typography scale needs a display settings model. |
| Q-SIGNAL | Table cleared and seating are live on the podium | Free-form waiter↔podium messages: the SRS does not define the signal vocabulary or recipients. |
| FR-BQ-02 | No double booking under any concurrency | Several halls in one booking. It needs a child table with its own exclusion constraint, a migration of every booking, and an approved pricing rule. It touches pricing, bill, KOT, calendar and kitchen board. |
| BQ-SETUP | Slots, rename, guarded deactivation | Hall images need object storage. Hall merge has undefined booking semantics. |
| T-TEMPLATES | Checklist templates and routines | One-off task templates. The SRS gives no fields beyond a checklist template's. |
| R-ITEMTYPES | Tick, number, text, rating, date | Photo and signature need object storage. |
| R-11 | 8 of 11 reference definitions | Kitchen, BM and Operational checklists are named without items. Inventing items would invent standards. |
| NFR-04 | Dashboard and reports within target with a wide margin at the seeded volume on this machine: p95 ≤ 106 ms sequentially, 481 ms with 20 concurrent dashboard requests (§12) | No measurement under production-like conditions: network round trips, a remote or shared database, multi-tenant load |
| P2-RT | Refetch on event; resync on reconnect | Last-Event-ID replay would add server-side event retention. |

## 8. Requirements intentionally deferred

Each item gives the reason it is not built now, and what would unblock it.

- **Notifications (FR-X4).**
  - *Why:* a whole module (outbox, preferences, unread state, delivery). Push needs an external provider (web-push keys or FCM), which is an infrastructure and cost decision. Fake notifications are forbidden.
  - *Unblock:* choose the channel. Then add a transactional outbox, and an in-app centre over the existing SSE broker.
- **Offline routine forms (FR-X5, R-OFFLINE, NFR-03).**
  - *Why:* needs idempotent answer keys, a service-worker queue and conflict rules. A fake offline mode is forbidden.
  - *Unblock:* approve a conflict rule (last answer wins, or refuse late answers). Scope it to checklist answers only.
- **Photo evidence (FR-X12, R-PHOTO).**
  - *Why:* there is no object store. Binary storage in PostgreSQL and fake uploads are forbidden.
  - *Unblock:* choose an S3-compatible store. Then add a media table with tenancy, signed URLs and a PHOTO item kind.
- **QR self-join (Q-PUBLIC) and public booking link (BQ-PUBLIC).**
  - *Why:* unauthenticated internet-facing write surfaces. They need an approved abuse and privacy model: signed expiring tokens, rate limits, phone verification, and what a customer may change.
  - *Unblock:* approve that design (§19).
- **Buffet booking type (BQ-BUFFET).**
  - *Why:* the SRS infers it from bundle labels only. "Deletable independently" conflicts with append-only money. A hall-less booking changes the exclusion constraint, pricing and kitchen board.
  - *Unblock:* specify and approve the rules.
- **Branch capability boundary (FR-X2.c).**
  - *Why:* needs a decision on which modules can be disabled per branch, and what happens to live records.
- **Retention (NFR-09).**
  - *Why:* retention periods are a legal and business decision; audit and money history are append-only by design.

## 9. Requirements belonging to future modules

Not built, per instruction:
- **Inventory and procurement.**
- **Finance:** expenses, petty cash, daily closing, UPI, and the banquet cancellation voucher (BQ-VOUCHER), which is a liability ledger.
- **POS:** menu, billing, POS KDS / KOT routing, table release on bill close.
- **AI assistant; cleaner and head consoles.**
- **Revenue and inventory dashboard widgets.**

No screen shows fabricated figures for any of them. Extension points are unchanged: reserved permission keys, the report and widget registries, the routine engine, and realtime channels.

## 10. Security findings

| # | Finding | Severity | Resolution | Test |
|---|---|---|---|---|
| S11 | Any authenticated user could create a company and become its first member (`POST /companies` had JwtAuthGuard only). The previous report had classified this as self-service. | High | `PlatformAdminGuard`: ACTIVE user with `is_superadmin`, read from the database on each request. The flag still confers no company- or branch-scoped authorization. Tests that created companies as ordinary users were changed to a platform user, and memberships are granted explicitly. | CC-1..9, RI-6, platform-admin.guard.spec |
| S12 | Customer search would have treated `%` and `_` in the search text as LIKE wildcards: Prisma `contains` does not escape them. Found by the new test before release. | Low | Search text is escaped. | CU-12 |
| S13 | A cook could approve plates they asked for themselves (portion-control bypass) | Medium (new feature) | Refused in the service (403), and by DB CHECK `banquet_plate_requests_not_self_decided` | PL-2 |
| S14 | Display pairing code on screen | Low (by design) | The code is shown once, from the creation response only. It is never persisted in the browser and is forgotten on "Done" or on leaving the page. The API stores only a hash. | admin "shows the pairing code once"; pw "pairing shows the code once" |
| S15 | Admin screens and direct URLs | — | Every screen checks its permission and requests nothing without it. The API refuses regardless. Workers opening each URL directly see a refusal with no data and no controls. | admin refusal tests; pw admin "a worker opening each screen directly" |
| S16 | Role and assignment escalation through the new screens | — | The UI never offers self-changes and disables permissions the editor lacks. The existing API rules are unchanged and still refuse. | rbac S1-a..c; admin "surfaces the escalation refusal" |
| S17 | Branch bill terms in the audit | Info | The audit records a changed flag and the length, not the text | companies 19b |
| S18 | Routine log export | — | Two keys (`tasks.reports.view` + `reports.export`). The export is audited without contents. The PDF column limit is enforced server-side. | TY-7 |

Earlier findings (S1–S10 in the first pass) remain resolved; their tests still pass.

Route protection review:
- **Route inventory.** Every controller route, including all new ones, is classified: PERMISSION, DEVICE, SELF, PLATFORM, TICKET or PUBLIC. RI-2 fails on any unclassified route.
- **Headers.** Context headers remain requests, never proof.
- **Existing controls.** "Assigned" is still not "authorized", and `is_superadmin` bypasses nothing company-scoped.

## 11. Concurrency findings

- **Plate requests.** Every move is `UPDATE … WHERE id AND status = <validated status>`. Two decisions at once give exactly one 200 and one 409 (PL-5).
- **Queue.** The floor view uses the existing conditional operations and one-seated-party-per-table index. A table taken in the meantime is refused and shown.
- **Banquet money.** Unchanged: row locks, `paid_within_total`, and the exclusion constraint.
- **Queue token allocation.** Unchanged (INSERT … ON CONFLICT counter).
- **Tests.** No artificial sleeps were added.

## 12. Performance findings

**Measured.** `apps/api/test/performance.e2e-spec.ts` is opt-in; run it with `SAMCO_PERF=1` through the guarded runner.

The seed was:
- 60,000 queue tokens: 120 days at 300 a day at the busy branch, and 100 a day at the two others;
- 6,000 tasks;
- 720 confirmed banquet bookings, each with a payment;
- 3 Asia/Kolkata branches.

Seeding took 18.4 s, followed by `ANALYZE`. Each endpoint was called 3 times to warm up, then timed over 20 sequential calls through the real HTTP stack: an in-process Nest app, supertest over loopback, and PostgreSQL on the same machine.

| Endpoint | p50 | p95 | max |
|---|---|---|---|
| `GET /dashboard` (default 30 days) | 50 ms | 101 ms | 101 ms |
| `GET /dashboard` (90 days) | 97 ms | 105 ms | 144 ms |
| `GET /dashboard/all-branches` (30 days) | 58 ms | 86 ms | 92 ms |
| `GET /reports/queue.summary/data` (90 days) | 98 ms | 106 ms | 116 ms |
| `GET /reports/queue.tokens/data` (90 days, first page) | 78 ms | 82 ms | 84 ms |
| `GET /reports/queue.tokens/data` (90 days, offset 20,000) | 95 ms | 105 ms | 124 ms |
| `GET /reports/banquet.outstanding/data` (90 days) | 33 ms | 41 ms | 41 ms |
| `GET /reports/tasks.completion/data` (90 days) | 40 ms | 45 ms | 49 ms |
| `GET /reports/queue.tokens/export` xlsx (14 days, 4,200 rows) | 2,924 ms | 3,263 ms | 3,421 ms |
| `GET /dashboard` × 20 concurrent, 5 rounds (100 samples) | 354 ms | 481 ms | 513 ms |

All dashboard and report p95 values are asserted under 3,000 ms, and all six tests passed.

**What this does and does not show.**
- **Shows:** at this volume, on this development machine, dashboard and report responses stay far inside the NFR-04 target, including under 20 concurrent requests. This is why rollups (FR-DB-03) and background export workers (RPT-ASYNC) are not adopted.
- **Does not show:**
  - behaviour on production hardware;
  - behaviour over a network, or with a remote or shared database;
  - behaviour under other tenants' load;
  - behaviour at volumes beyond the seed.

  NFR-04 therefore stays **PARTIAL**.
- **Near the limit:** Excel export. A 4,200-row workbook took about 3 s (p95 3,263 ms). Exports are not in the 3 s requirement, and the 5,000-row cap bounds them. They are the first thing to watch, and the first candidate for streaming generation if exports grow.

**Optimisations still in place from the first pass.**
- Permissions are resolved once per dashboard.
- Widgets and branches run concurrently.
- Report ranges and offsets are bounded.
- ORDER BY tie-breakers keep pages stable.

The two new queue widgets share one aggregate per service date, served by the existing `(branch_id, service_date, status)` index.

## 13. UI findings

| Screen | Finding | Resolution | Test |
|---|---|---|---|
| Customers, Tables, Displays, Users, Roles | "Not available in this version" placeholders | Working screens with loading, empty, error and refused states | admin.test; pw admin.spec |
| Branch settings | A failed save's error was erased by the reload that followed it | Separate action-error slot | settings "renames the company, and shows a refusal from the server" |
| Dashboard All Branches | Per-branch figures hidden in collapsed sections | A comparison matrix | RF-30c |
| Booking and task pages | No way to see who changed a record | History panel | floor.test "Record history" |

**No dead buttons.** Every new control calls a real endpoint and reconciles with the server. Each is permission-aware and re-validated by the API.

## 14. Browser acceptance results

Playwright runs real Chromium against production builds of the API and web app, on the `samco_browser_e2e` database. **51/51 passed.**

New in this pass: 14 browser tests.

**`e2e/admin.spec.ts`**
- **Customers:** search, details and add; the screen fits a phone.
- **Tables:** add, out of service and back, on a tablet.
- **Displays:** the pairing code is shown once, and a revoked code cannot pair.
- **Users:** add, assign and remove a role, disable sign-in; the API sign-in then fails.
- **Own access:** the manager is never offered controls over their own access, on a phone.
- **Roles:** create and grant a permission.
- **Refusal:** a worker opening each screen by URL is refused.

**`e2e/operations.spec.ts`**
- **Waiter floor:** seat and clear a table, on a tablet.
- **Plate approval across two sessions:** the manager asks; the chef approves and dispatches; the manager sees "Dispatched".
- **Dashboard:** a custom period and the daily chart on a phone; the All-branches matrix.
- **Booking history:** the panel shows who changed the booking.
- **Branch bill terms:** they reach the printed bill.

**Defect found by the final verification run.** The first final Playwright run failed in global setup, before any test ran. The browser database reset (`e2e/support/database.ts`) deleted banquet booking items while plate requests left by the previous run still referenced them, and the new foreign key refused the delete. The API e2e reset had been updated for the new table, but the browser one had not. The reset now removes plate requests first, and the suite was re-run in full.

## 15. Test results

Final tree, all run after the last code change.

| Suite | Command | Result |
|---|---|---|
| API unit | `apps/api: npx vitest run` | 729/729 |
| API E2E | guarded runner on `samco_e2e` (`migrate deploy` + seed + `vitest --config vitest.config.e2e.ts`) | 690/690 (the opt-in performance spec is skipped in this run; it was run separately, §12) |
| Web | `apps/web: npx vitest run` | 466/466 |
| Playwright | `apps/web: npx playwright test` | 51/51 |
| Lint | `apps/api: npm run lint` (oxlint) and `apps/web: npx eslint .` | PASS |
| Typecheck | `apps/api: tsc -p tsconfig.build.json --noEmit`; `apps/web: tsc --noEmit` | PASS |
| API build | `apps/api: npm run build` | PASS |
| Web build | `apps/web: npx next build` | PASS |

## 16. Database / migration results

New migrations. Both are additive, and no historical migration was edited.

| Migration | Contents |
|---|---|
| `20260916090000_branch_banquet_terms` | Nullable `branches.banquet_terms`, with CHECK `char_length ≤ 4000` |
| `20260916100000_banquet_plate_requests` | Enum `BanquetPlateRequestStatus`; table `banquet_plate_requests` with tenancy, booking and item foreign keys (all RESTRICT); indexes on `booking_id`, `item_id` and `(branch_id, status)`; CHECKs `plates_range`, `decision_stamps`, `rejection_reason`, `dispatch_stamps`, `not_self_decided`, `note_length`, `reason_length` |

The plate migration's DDL was generated by `prisma migrate diff` from the schema, and the CHECKs were appended.

- **New permission.** `banquet.plate.request` is in `SYSTEM_PERMISSIONS`, so the seed adds it to existing databases.
- **Validation.** Prisma validate: PASS.
- **Migration status:** PASS (19 migrations; "Database schema is up to date").
- **Drift:** NONE (`prisma migrate diff` from `samco_e2e` to `schema.prisma` is an empty migration).

## 17. Architecture decisions made

1. **Platform actor.** The smallest safe solution was to use the existing `is_superadmin` flag as the platform actor, for platform operations only (today: creating a company).
   - It is enforced by a dedicated guard, read from the database per request.
   - PermissionGuard and AuthorizationService still never consult it.
   - The flag cannot be set through any API.
2. **Admin reads.** Three endpoints were added instead of widening existing responses. Each carries the permission its screen already needs, and each is covered by the route inventory.
3. **Dashboard series.** The widget contract gained an optional `series`.
   - Series are counts only, so they add across branches honestly.
   - No figure that cannot be added (a "busiest day") is summed.
4. **Plate approval.**
   - A separate table and state machine, rather than overloading KDS item status.
   - Separation of duties is enforced by the database.
   - Realtime payloads carry ids and a status only.
5. **Routine log export.**
   - It reuses the report exporter: the export service moved into `ReportingCoreModule`.
   - One renderer, one provenance header, one row cap.
6. **Performance test.** Opt-in rather than part of the default e2e run, because it seeds 60,000+ rows and takes minutes. Its numbers are machine-specific and labelled as such.

## 18. Deviations and recommendations not adopted

Unchanged from the first pass, now marked RECOMMENDATION in the matrix:
- **Access control:** per-user feature flags; ad-hoc tables created by waiters.
- **Destructive or rewriting actions:** bulk queue deletion; editing or deleting payments.
- **Features:** a separate activity calendar; WhatsApp share.
- **Infrastructure:** background export workers and read replicas; Redis, workers and a CDN.
- **Rollups:** pre-computed rollups (FR-DB-03) are not adopted, because the live dashboard was measured within target at the seeded volume (§12).

## 19. Decisions requiring approval

1. **Company creation.** Only a platform administrator can create a company.
   - Setting `is_superadmin` is a database operation; there is no API or UI for it.
   - The creator becomes a member with no roles. A new company therefore still needs its first branch, role and administrator provisioned — today by an operator.
   - Approve this, or specify a self-service onboarding flow: billing gate, invite link, or automatic owner role.
2. **Multi-hall bookings (FR-BQ-02).** Approve a pricing rule (one rate for the event, or a rate per hall) before a `banquet_booking_halls` table and its migration are built.
3. **Buffet booking type (BQ-BUFFET).** Specify it:
   - the fields;
   - whether it holds a hall or a table;
   - whether "deletable" means cancellable, given that money history is append-only.
4. **Public surfaces (Q-PUBLIC, BQ-PUBLIC).** Approve the abuse and privacy model:
   - signed per-branch QR tokens or booking links;
   - rate limits;
   - phone verification;
   - what a customer may change.
5. **Notifications (FR-X4).** Choose the delivery channel (web push or FCM) and retention.
6. **Object storage (FR-X12, R-PHOTO, hall images).** Choose a provider and a data-residency region.
7. **Offline routines (FR-X5).** Approve a conflict rule for answers captured offline.
8. **Retention (NFR-09).** Approve retention periods for queue history, notifications and audit.
9. **Display pairing.** Confirm that showing the one-time pairing code on the staff screen, once, is the intended pairing method. It is how the API was designed; the code is never stored by the browser.

## 20. Remaining technical debt

- **Web types** are hand-mirrored from API views; a generated client would prevent drift.
- **Audit and booking history.** The per-record panel on a booking shows booking-level entries. Payments and adjustments are separate audit records, already listed permanently on the same page.
- **Users list.** `GET /users` returns `is_superadmin`. It is not a credential and the UI does not display it, but a narrower projection would be tidier.
- **Performance** is measured on one machine only (§12).
- **Test typecheck gap.** `tsc -p tsconfig.json` (which includes `test/`) reports 5 type errors in `banquet.e2e-spec.ts`, `queue.e2e-spec.ts` and `tasks.e2e-spec.ts`. They are in test code committed before this pass. The gated typecheck (`tsconfig.build.json`) and the suites themselves pass.
- **Tracked build artifact.** `apps/api/tsconfig.build.tsbuildinfo` is tracked and rewritten by builds; it was left as it was.
- **Line endings.** Git reports LF→CRLF warnings on edited files; there are no whitespace errors.

## 21. Files changed in this pass

**Database** (`packages/database/prisma`)
- `schema.prisma`: `Branch.banquet_terms`; `BanquetPlateRequest` and its enum and relations.
- New migrations: `migrations/20260916090000_branch_banquet_terms/`, `migrations/20260916100000_banquet_plate_requests/`.

**API** (`apps/api/src`)
- **Authorization.**
  - `common/authorization/`: `platform-admin.guard.ts` (new) and its spec (new).
  - `authorization.module.ts`, `permission-keys.ts` (`banquet.plate.request`).
- **Companies:** `modules/companies/companies.controller.ts`, `companies.service.ts`.
- **Customers:** `modules/customers/customers.controller.ts`, `customers.dto.ts`, `customers.service.ts`.
- **Users and roles:** `modules/users/users.controller.ts`, `users.service.ts`; `modules/roles/roles.controller.ts`, `roles.service.ts`.
- **Branches:** `modules/branches/branches.dto.ts`, `branches.service.ts`.
- **Banquet** (`modules/banquet/`):
  - new: `banquet-plates.service.ts` and `banquet-plates.spec.ts`;
  - changed: `banquet-bookings.service.ts`, `banquet-state-machine.ts`, `banquet-views.ts`, `banquet.controller.ts`, `banquet.dto.ts`, `banquet.module.ts`.
- **Queue:** `modules/queue-tokens/queue.report-provider.ts`, `queue-tokens.module.ts`.
- **Reports** (`modules/reports/`):
  - new: `dashboard.service.spec.ts`;
  - changed: `dashboard-contract.ts`, `dashboard.service.ts`, `reporting-core.module.ts`, `reports.module.ts`.
- **Tasks** (`modules/tasks/`):
  - new: `routine-log-export.ts` and `routine-log-export.spec.ts`;
  - changed: `routines.service.ts`, `tasks.controller.ts`, `tasks.dto.ts`.

**API tests** (`apps/api/test`)
- New: `admin-reads.e2e-spec.ts`, `banquet-plates.e2e-spec.ts`, `performance.e2e-spec.ts`.
- Changed: `audit-logs.e2e-spec.ts`, `banquet.e2e-spec.ts`, `companies.e2e-spec.ts`, `foundations.e2e-spec.ts`, `reports.e2e-spec.ts`, `route-inventory.e2e-spec.ts`, `tasks.e2e-spec.ts`, `utils/db.ts`.

**Web pages** (`apps/web/src/app/(staff)/(app)`)
- Replaced placeholders: `customers/page.tsx`, `tables/page.tsx`, `displays/page.tsx`, `settings/users/page.tsx`, `settings/roles/page.tsx`.
- New: `queue/tables/page.tsx`.
- Changed:
  - `queue/layout.tsx`;
  - `page.tsx` (dashboard);
  - `settings/branches/page.tsx`, `settings/audit/page.tsx`;
  - `banquet/[id]/page.tsx`, `banquet/[id]/bill/page.tsx`, `banquet/kitchen/page.tsx`;
  - `tasks/[id]/page.tsx`, `tasks/routines/[id]/log/page.tsx`.

**Web components and libraries** (`apps/web/src`)
- Components:
  - new: `components/admin/admin.module.css`, `components/audit/record-history.tsx`, `components/reports/series-chart.tsx`;
  - changed: `components/reports/widget-card.tsx`, `reports.module.css`.
- Libraries:
  - new: `lib/admin/api.ts`, `lib/settings/audit-format.ts`;
  - changed: `lib/settings/api.ts`, `lib/banquet/api.ts`, `lib/banquet/types.ts`, `lib/reports/types.ts`, `lib/tasks/api.ts`, `lib/auth/permissions.ts`.

**Web tests**
- Unit (`apps/web/src/app/`):
  - new: `admin.test.tsx`, `floor.test.tsx`;
  - changed: `banquet.test.tsx`, `reports.test.tsx`, `settings.test.tsx`, `tasks.test.tsx`.
- Playwright (`apps/web/e2e/`), new: `admin.spec.ts`, `operations.spec.ts`; changed: `support/database.ts` (the reset clears plate requests).

**Docs:** `docs/SAMCO-REQUIREMENTS-CONFORMANCE-MATRIX.md`, `docs/SAMCO-REQUIREMENTS-CONFORMANCE-REPORT.md`.

**Unrelated, left as found:** `apps/api/tsconfig.build.tsbuildinfo`, a tracked build cache that the build rewrites. It was already modified before this pass and was not reverted.

No future-module code was modified.

## 22. Git status

- **Branch:** `master`. The last commit is `21fa790` (the previous checkpoint). Nothing from this pass is committed or pushed; no reset, revert or discard was done.
- **Working tree:**
  - 67 tracked files modified: 66 in this pass, plus the pre-existing `apps/api/tsconfig.build.tsbuildinfo`;
  - 22 untracked entries: new source, tests, components, two migration folders and two Playwright specs, all listed in §21.
- **`git diff --check`:** clean. Git warns only about LF→CRLF line endings.
- **Build and test outputs:** none left untracked (`.next`, `dist` and Playwright results are ignored or cleaned).
