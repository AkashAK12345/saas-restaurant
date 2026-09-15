# SAMCO — Requirements Conformance Matrix

Traceability from the two supplied documents to the SAMCO codebase, as of the working tree on 2026-09-16 (uncommitted; last checkpoint `21fa790`).

- **SRS**: `SRS_Restaurant_Operations_Platform.md`
- **P2**: `Module_Logic_and_Infrastructure_Cost_Plan.md` (Part II, Module Operating Logic)

**Classification.**
- **A**: applicable now.
- **B**: foundation now (extension point).
- **C**: future module (Inventory / Finance / POS and similar).
- **D**: non-functional / platform.
- **E**: recommendation in the source documents.

**Status.**
- **MET**: implemented and verified. For a user-facing requirement this means the screen works, not only the API.
- **PARTIAL**: some of the requirement is met; the missing part and the reason are stated in the row.
- **DEFERRED**: applicable but not built; the concrete reason and dependency are in the row and in the report, §8.
- **FUTURE MODULE**: belongs to Inventory, Finance, POS or another module outside this task.
- **NOT APPLICABLE**: not a requirement on this codebase.
- **RECOMMENDATION**: a recommendation or reference-system behaviour that SAMCO deliberately does not adopt, or adopts differently; the reason is in the row and the report, §18.

**Test references.**

| Prefix | Location |
|---|---|
| `api-e2e:` | `apps/api/test/*.e2e-spec.ts` |
| `api-unit:` | `apps/api/src/**/*.spec.ts` |
| `web:` | `apps/web/src/**/*.test.ts(x)` |
| `pw:` | Playwright, `apps/web/e2e/*.spec.ts` |

Totals are in the report, §4. Rows changed in this pass are marked **(this pass)** in the Implementation column.

---

## 1. Cross-cutting platform and administration

| Requirement | Source | Module | Classification | Current State | Gap | Implementation | Test | Status |
|---|---|---|---|---|---|---|---|---|
| FR-X1 Every operational record branch-scoped; All Branches is an aggregate only | SRS §4.1, P2 §1.1 | Foundation | A | Company + branch scoping proved by PermissionGuard / AuthorizationService | — | `GET /dashboard/all-branches`: every ACTIVE branch proved individually; counts and per-currency money summed; rates and durations never summed | api-e2e: reports RP-55..57, RP-65; web: RF-30c; pw: conformance "All branches", operations "branch matrix" | MET |
| FR-X1.a Operational screens require a specific branch | SRS §1.2 | Foundation | A | Layouts ask for a branch first | — | Tables, Displays and the waiter floor view also ask for a branch **(this pass)** | web: banquet "asks for a branch first", admin "asks for a branch first" | MET |
| FR-X1.b Branch selection persists across reload and deep links | SRS §4.1, §8.3.2 | Foundation | E→A | localStorage per user; `/login?next=` | — | — | web: app-context-provider, next-path.test; pw: conformance "deep link survives", "off-site next ignored" | MET |
| FR-X1.c Inter-branch search toggle | SRS §4.1 | Foundation | A | Customers are company-scoped, so customer search already spans branches **(this pass: server-side search)** | Cross-branch search of branch records (queue, bookings, tasks) | The SRS names the toggle but not which records it covers or who may use it; a cross-branch search must be authorized branch by branch like All Branches. Not guessed. | api-e2e: CU-12 | PARTIAL |
| FR-X2 Per-user feature flags (~60) | SRS §4.3 | Foundation | E | Granular RBAC permissions | — | Not copied: named, auditable role permissions instead of per-user booleans | api-e2e: rbac | RECOMMENDATION |
| FR-X2.a Named permission sets instead of per-user flags | SRS §4.3, §8.3.1 | Foundation | E | Company roles are named permission sets | — | Roles screen shows each role's permissions from the seeded catalogue **(this pass)** | api-e2e: rbac, AR-1..3; web: admin "Roles"; pw: admin "creates a role and grants it a permission" | MET |
| FR-X2.b Access modes: own vs all records | SRS §4.2, P2 §1.2 | Tasks | A | `tasks.view` and `tasks.view_own` | — | — | api-e2e: tasks "Own-task visibility" | MET |
| FR-X2.c Branch capability boundary (module disabled per branch) | P2 §1.1 | Foundation | D | Not present | Per-branch module switches | Needs a product decision on which modules can be switched off and what happens to live data (a disabled banquet with confirmed events). Would be one more check in PermissionGuard. | — | DEFERRED |
| FR-X3 Audit every significant mutation (actor, company, branch, time, action, target, summary, redaction, immutable) | SRS §4.4, P2 §1.4 | Audit | A | Append-only `audit_logs`; in-transaction writes; `systemEvent` | — | New plate requests, branch terms and routine-log exports audited **(this pass)** | api-unit: audit-logs.service.spec; api-e2e: BU-1/2, TU-2, TY-4, PL-1, 19b, TY-7 | MET |
| FR-X3.a Old/new values for financial and settings changes | P2 §1.4, FR-BQ-05 | Audit / Banquet | A | `changes: {field: {from, to}}` | — | Bill terms record changed + length, never a second copy of the text **(this pass)** | api-e2e: BQ-2, BQ-5, BQ-10, companies 19b | MET |
| FR-X3.b Activity-log viewer; per-record audit information | SRS §4.4 | Audit | A | `/settings/audit` viewer | Per-record panel | `RecordHistory` panel on banquet bookings and tasks, loaded on open, only for `audit_logs.view`, filtered server-side by record type and id **(this pass)** | web: floor.test "Record history", settings "Audit log"; pw: operations "a booking's history shows who changed it" | MET |
| FR-X4 Notifications (push, tiers, centre, unread, broadcast) | SRS §4.5, P2 §9 | Notifications | B | Not built | Entire module | A whole module: outbox, preferences, unread state, delivery channel. Push needs an external provider (web push keys or FCM), which is an infrastructure and cost decision. No fake notifications. | — | DEFERRED |
| FR-X5 Offline tolerance for routine forms | SRS §4.6 | Routines | A/B | Online only | Local queue + sync | Needs idempotent answer keys, a service-worker queue and conflict rules. A fake offline mode is forbidden. | — | DEFERRED |
| FR-X6 Excel/PDF exports, printable KOT and bill, WhatsApp share | SRS §4.7, P2 §1.6 | Exports | A | Localised XLSX/PDF; bill and KOT | WhatsApp share | Routine compliance log export added **(this pass)**. WhatsApp share sends files to an external service; it needs a sharing policy and a provider. | api-unit: export spec, routine-log-export.spec; api-e2e: TY-7; web: banquet "bill and KOT", tasks "exports the shown window" | PARTIAL |
| FR-X7 Tenant typography scale for wall displays | SRS §4.8 | Displays | A | Per-device density and fullscreen | Tenant-wide scale | A tenant-wide setting needs a settings model for displays; the per-device control already solves legibility per screen. | web: display-controls.test | PARTIAL |
| FR-X8 Logged devices and remote logout | SRS §4.8 | Auth | A | Session list with opaque handles; remote sign-out | — | — | api-e2e: SD-1..5; pw: conformance "signing out another device" | MET |
| FR-X9 Per-routine submission deadlines | SRS §4.8, P2 §1.8 | Routines | A | `due_time` | — | — | api-e2e: tasks "Routine deadlines" | MET |
| FR-X10 Daily closing | SRS §4.8 | Finance | C | — | — | — | — | FUTURE MODULE |
| FR-X11 Only a Super Admin may delete a Super Admin | SRS §3 | Users | A | No user-deletion path exists; a company admin cannot change a platform administrator's account | — | — | api-e2e: USR-k | NOT APPLICABLE |
| FR-X12 Photo evidence per item (object storage) | P2 §1.5, §17 | Media | B | No object storage | Storage, upload, thumbnails | Needs an object store (S3-compatible), signed URLs and a media table — an infrastructure choice. Binary storage in PostgreSQL and fake uploads are forbidden. | — | DEFERRED |
| X-AUTHZ Server-side authorization; context headers never proof; default deny | Task §9, NFR-05 | Foundation | A | Route inventory proves every route's guard | — | New PLATFORM class; RI-6 proves the platform guard sits only on listed routes **(this pass)** | api-e2e: route-inventory RI-1..6 | MET |
| X-PLATFORM Company creation is not open to any signed-in user | Task §3 | Foundation | A | `POST /companies` accepted any authenticated user | Server-side restriction | `PlatformAdminGuard`: an ACTIVE user with `is_superadmin`, read fresh from the database; the flag still grants nothing company-scoped **(this pass)** | api-unit: platform-admin.guard.spec; api-e2e: CC-1..9, RI-6 | MET |
| X-ESC Role assignment and role editing cannot escalate privileges | Task §9 | Users | A | 403 on self-assignment and on permissions the actor lacks | — | Roles screen disables permissions the editor does not hold; Users screen never offers changes to one's own access; the API remains the control **(this pass)** | api-e2e: rbac S1-a/b/c; web: admin "cannot tick a permission the editor does not hold", "never offers changes to your own access"; pw: admin "the manager never sees controls over their own access" | MET |
| X-RT Realtime publish after commit only | Task §9 | Realtime | A | EventBroker publish after commit | — | Plate requests publish after commit **(this pass)** | api-unit: bookings "publishes … AFTER"; api-e2e: BR-1..5, PL-1 | MET |
| X-L10N en-IN, ₹, dd/MM/yyyy, branch-local dates, CGST/SGST | NFR-07, Task | All | D | Consistent formatting | — | — | web: format/datetime.test, reports RF-5; api-unit: export spec | MET |
| X-HDR Response hardening, proxy trust | Task §15 | Platform | D | Security headers; `TRUST_PROXY` | — | — | api-unit: security-headers.spec | MET |
| X-SCHED Scheduled jobs across replicas | P2 §13 | Scheduler | D | PostgreSQL advisory lock | — | — | api-unit: job-registry | MET |
| ADM-CUSTOMERS Customer list, search, details, add, edit | Task §4 | Customers | A | Screen was a placeholder; no server search | Screen; search | `/customers`: server search by name or phone digits (LIKE wildcards escaped), status filter, paging, masked phone in the list and full number in the details, add, edit, mark inactive **(this pass)** | api-e2e: CU-12; web: admin "Customers"; pw: admin "customers: search …", "customers fit a phone" | MET |
| ADM-TABLES Table list, capacity, zone, status, occupancy, add, edit | Task §4 | Tables | A | Screen was a placeholder | Screen | `/tables`: seats, zone, in/out of service, live occupancy from the queue for `queue.view` holders, add, edit; the API's refusal for a seated table is shown **(this pass)** | web: admin "Tables"; pw: admin "tables: add one, take it out of service and back, on a tablet" | MET |
| ADM-DISPLAYS Display devices: list, kind, status, pair, revoke | Task §4 | Displays | A | Screen was a placeholder | Screen | `/displays`: pairing code shown once, never stored in the page, forgotten on "Done"; revoke only after confirmation; the revoked code cannot pair **(this pass)** | web: admin "Displays"; pw: admin "pairing shows the code once; a revoked screen's code can never pair" | MET |
| ADM-USERS Users, memberships, roles per branch, sign-in status | Task §4 | Users | A | Screen was a placeholder; no read of a user's assignments | Screen; assignments read | `GET /users/:id/branch-roles`; `/settings/users`: members including removed ones, add user, rename, remove or restore membership, disable or enable sign-in, assign and remove roles at the selected branch **(this pass)** | api-e2e: AR-4..7; web: admin "Users"; pw: admin "adds a user, gives and removes a role …" | MET |
| ADM-ROLES Roles, permission visibility, create, rename, edit permissions | Task §4 | Roles | A | Screen was a placeholder; no permission catalogue read | Screen; catalogue | `GET /roles/permissions`; `/settings/roles` grouped by module **(this pass)** | api-e2e: AR-1..3; web: admin "Roles"; pw: admin "creates a role …" | MET |
| ADM-BRANCHES Company and branch administration: add, rename, activate/deactivate, company rename | Task §6 | Foundation | A | Branch tax settings only | Branch lifecycle and company name | `/settings/branches`: add branch with an IANA time zone, rename, deactivate or activate after confirmation, rename company; the shell context reloads after each change **(this pass)** | web: settings "Company and branch management"; api-e2e: companies 10–20 | MET |
| ADM-REFUSED Admin screens refuse without permission, with no data | Task §4, §11 | Web | A | — | — | Each screen checks its permission, asks the API for nothing without it, and the API refuses regardless **(this pass)** | web: admin "refuses without …"; pw: admin "a worker opening each screen directly gets a refusal …" | MET |

## 2. Dashboard

| Requirement | Source | Module | Classification | Current State | Gap | Implementation | Test | Status |
|---|---|---|---|---|---|---|---|---|
| FR-DB-01 KPIs for a date range and branch scope, incl. All Branches | SRS §5.1 | Dashboard | A | Periods; All Branches; concurrent widgets | — | — | api-e2e: RP-44..48, RP-55..57; web: RF-24..30c | MET |
| FR-DB-01.a Presets Today / This Week / This Month / Custom | SRS §5.1 | Dashboard | A | Today, 7 days, 30 days, this month | Custom range | Custom period with From / To, checked against the server's 366-day limit before sending **(this pass)** | web: RF-30b, RF-30d; pw: operations "a custom period draws the daily queue chart on a phone" | MET |
| FR-DB-01.b Queue KPI cards (Total, Waiting, Seated, No-shows) | SRS §5.1 | Dashboard | A | Waiting, called, adults, kids, seated, longest wait | Total and no-shows | `queue.today` adds Customers today and No-shows today **(this pass)** | api-e2e: RP-62 | MET |
| FR-DB-01.c Queue overview matrix per branch | SRS §5.1 | Dashboard | A | Per-branch breakdown | Seated / Cancelled / Total matrix | `queue.overview` widget (walked in, seated, cancelled, no-shows for the period); All Branches renders every widget as a matrix: All branches + one column per branch **(this pass)** | api-e2e: RP-63, RP-65; web: RF-30c; pw: operations "All branches compares the queue overview" | MET |
| FR-DB-01.d Daily queue chart (this month) | SRS §5.1 | Dashboard | A | None | Chart | `queue.daily` series widget (every date in the window, zeroes included); accessible bar chart with a figure selector, a branch selector on All Branches and a data table **(this pass)** | api-unit: dashboard.service.spec (sumSeries); api-e2e: RP-64, RP-65; web: RF-30e; pw: operations "daily queue chart" | MET |
| FR-DB-01.e Task statistics | SRS §5.1 | Dashboard | A | `tasks.open` widget | — | — | api-e2e: RP-46 | MET |
| FR-DB-01.f Revenue / inventory widgets | SRS §5.1 | Finance / Inventory | C | — | — | Not fabricated | — | FUTURE MODULE |
| FR-DB-02 Widgets depend on permissions | SRS §5.1 | Dashboard | A | Server drops widgets without the domain permission | — | New queue widgets follow the same rule **(this pass)** | api-e2e: RP-45, RP-56 | MET |
| FR-DB-03 Pre-computed rollups | SRS §5.1, P2 §14.2 | Dashboard | E | Live aggregate queries | Rollup tables | Not adopted: the measured dashboard stays within target at the seeded volume (NFR-04), so rollups would add a second source of truth without a measured need | api-e2e: performance PF-1..3, PF-6 (opt-in) | RECOMMENDATION |

## 3. Queue (Phase 7)

| Requirement | Source | Module | Classification | Current State | Gap | Implementation | Test | Status |
|---|---|---|---|---|---|---|---|---|
| FR-Q-01 Sequential daily tokens, atomic allocation | SRS §5.2.1, P2 §2.7 | Queue | A | INSERT … ON CONFLICT counter per branch/day | — | Unchanged | api-e2e: queue concurrency | MET |
| FR-Q-02 Realtime on all queue screens | SRS §5.2.1 | Queue | A | SSE broker; public projections for displays | — | The waiter floor view uses the same stream **(this pass)** | api-e2e: queue realtime; pw: display live tests | MET |
| FR-Q-03 Live wait time from join timestamp | SRS, P2 §2.7 | Queue | A | `useNow` timers | — | — | web: queue-podium | MET |
| FR-Q-04 Seating by table or capacity | SRS | Queue | A | Seat with table; one seated party per table | — | Floor view warns when a party exceeds a table's seats **(this pass)** | api-e2e: queue QK; web: floor.test | MET |
| FR-Q-05 Call stamps time; phone and WhatsApp contact | SRS | Queue | A | Audited on-demand contact | — | — | api-e2e: QK contact | MET |
| FR-Q-06 Advance bookings held as scheduled | SRS, P2 §2.4 | Queue | A | SCHEDULED + activation job | — | — | api-e2e: QK | MET |
| Q-STAT Statuses incl. scheduled and skipped | SRS §5.2.7, P2 §2.2 | Queue | A | Implemented | — | — | api-unit: queue-state-machine.spec | MET |
| Q-PODIUM Next card, register, available tables, waiting list with elapsed time | SRS §5.2.1 | Queue | A | Podium | — | — | web: queue-podium | MET |
| Q-KIOSK Registration surface | SRS §5.2.2 | Queue | A | Staff register page | — | — | web: queue register | MET |
| Q-ADMIN Admin display tiles (waiting, adults, kids) | SRS §5.2.3 | Displays | A | Totals tiles | — | — | web: display-boards.test | MET |
| Q-WAITER Waiter screen | SRS §5.2.4 | Queue | A | None | Surface | `/queue/tables` (queue.seat): every table free, occupied (today or an earlier date) or out of service; seat a called party or assign a seated one; "Table cleared" **(this pass)** | web: floor.test "Tables — the waiter floor view"; pw: operations "seats a called party at a free table and clears it, on a tablet" | MET |
| Q-WAITER-ADHOC Waiters create tables ad hoc | SRS §5.2.4 | Queue | E | — | — | Not adopted: tables stay one source of truth, managed on the Tables screen | — | RECOMMENDATION |
| Q-SIGNAL Waiter↔podium signalling | SRS §5.2.4, P2 §2.5 | Queue | A/B | None | Signals | "Table cleared" and every seat publish on the branch queue stream, so the podium sees tables free up without a refresh **(this pass)**. Free-form messages ("send the next party", "need help") are not built: the SRS does not define the signal vocabulary or who receives it. | web: floor.test, queue-podium; api-e2e: queue realtime | PARTIAL |
| Q-DISPLAY NOW SERVING / WAITING, density, fullscreen | SRS §5.2.5 | Displays | A | Boards, controls | — | — | web: display tests | MET |
| Q-PUBLIC QR self-join | SRS §5.2.6, P2 §2.1 | Queue | B/E | None | Public surface | An unauthenticated write surface on the internet. Needs an approved abuse model: signed per-branch QR tokens, rate limits per IP and per phone, and a decision on phone verification (CAPTCHA-style bot checks are out of scope for automation). Decision required before building. | — | DEFERRED |
| Q-REPORTS Queue report, log, export | SRS §5.2.8 | Reports | A | queue.summary, queue.tokens | — | — | api-e2e: RP-29, RP-34 | MET |
| Q-PURGE Bulk queue deletion | SRS §5.2.8 | Queue | E | — | — | Not adopted: destructive; append-only history | — | RECOMMENDATION |
| Q-TABLES One source of truth for tables | SRS §8.3.3 | Tables | A | Single tables module; occupied tables cannot be deactivated | — | Tables admin screen over the same API **(this pass)** | api-e2e: QK tables; pw: admin tables | MET |
| Q-POS-TABLE Release table on POS bill close | P2 §2.3 | POS | C | — | — | — | — | FUTURE MODULE |

## 4. Banquet (Phase 8)

| Requirement | Source | Module | Classification | Current State | Gap | Implementation | Test | Status |
|---|---|---|---|---|---|---|---|---|
| FR-BQ-01 Availability per hall × slot × date | SRS §5.3.3 | Banquet | A | Slots and availability | — | — | api-e2e: BQ-9; pw: calendar on phone | MET |
| FR-BQ-02 Several hall+slot combinations per booking; no double booking | SRS §5.3.3 | Banquet | A | One hall window per booking; exclusion constraint | Multi-hall bookings | Double booking is impossible, including on edits and hall moves. Several halls in ONE booking is not built: it needs a `banquet_booking_halls` child table carrying its own exclusion constraint, a migration of every existing booking into it, and a pricing decision (does each hall carry its own rate?). Pricing, the bill, the KOT, the calendar and the kitchen board all assume one hall today, so doing it safely touches the financial core. Approval of the pricing rule is required. | api-e2e: BC-1..10, BX-1, BQ-9 | PARTIAL |
| FR-BQ-03 Past bookings editable only by an authorised role | SRS §5.3.3 | Banquet | A | `banquet.booking.edit_past` | — | — | api-e2e: BQ-5 | MET |
| FR-BQ-04 Snapshot menu, hall and price | SRS §5.3.3, P2 §3.10 | Banquet | A | Snapshots | — | — | api-e2e: BB-2, BQ-1, BQ-10 | MET |
| FR-BQ-05 Financial changes audited with old and new values | SRS §5.3.3 | Banquet | A | Old → new values | — | — | api-e2e: BQ-2 | MET |
| BQ-CAL Month and week availability calendar | SRS §5.3.1 | Banquet | A | Calendar | — | — | web: calendar tests; pw: conformance | MET |
| BQ-LIST Tabs, filters, search, payment date ranges | SRS App. B | Banquet | A | Implemented | — | — | api-e2e: BQ-8 | MET |
| BQ-SETUP Halls add/rename/remove, slots, merge, images | SRS §5.3.2 | Banquet | A | Slots; rename; guarded deactivation | Merge; images | Images need object storage (FR-X12). Merging halls rewrites which hall past bookings and the exclusion constraint refer to; the SRS does not say what happens to bookings of the merged hall. | api-e2e: BQ-9, BQ-10 | PARTIAL |
| BQ-LIFE Draft → confirmed → completed / cancelled | SRS, P2 §3.3 | Banquet | A | State machine with conditional updates | — | — | api-unit: state-machine spec; api-e2e: BL-1..6 | MET |
| BQ-PRICE Layered pricing; GST as CGST+SGST; no-GST mode; GSTIN / FSSAI | SRS, P2 §3.4 | Banquet | A | `priceBooking()` in integer minor units | — | — | api-unit: banquet-money; api-e2e: BQ-1..4, BQ-13 | MET |
| BQ-PAY Stages, verification, status, history | SRS, P2 §3.5 | Banquet | A | Append-only payments and verifications; `paid ≤ total` CHECK | — | — | api-e2e: BQ-6, BQ-7, BX-3, BM-1..7 | MET |
| BQ-PAY-EDIT Edit or delete payments (logged) | SRS | Banquet | E | Append-only (DB triggers) | — | Not adopted: money history is never rewritten | api-e2e: BM-5, BM-6 | RECOMMENDATION |
| BQ-VOUCHER Advance held as voucher on cancellation | SRS, P2 §3.5 | Finance | C | Payments stay recorded on the cancelled booking | Voucher ledger | A voucher is a liability that must be issued, balanced and redeemed across bookings — a finance ledger. It belongs in the Finance module; building a ledger here is out of scope. | api-e2e: BQ-11 | FUTURE MODULE |
| BQ-BUFFET Dine-in buffet booking type | SRS §5.3.4 | Banquet | A/B | None | Booking type | The SRS marks this "[Bundle]" (inferred from labels only): a booking with a table/location instead of a hall, "deletable independently". Deleting conflicts with the append-only money rules, and a hall-less booking changes the exclusion constraint, pricing and the kitchen board. The rules must be specified and approved before it is built. | — | DEFERRED |
| BQ-KDS Chef display and realtime KDS | SRS §5.3.5 | Banquet | A | Chef display, staff board, item lifecycle | — | — | api-e2e: BQ-12, BD-1..7; pw: display chef tests | MET |
| BQ-PLATE Plate approval workflow | SRS §5.3.5, P2 §3.6 | Banquet | A | None | Workflow | `banquet_plate_requests`: REQUESTED → APPROVED → DISPATCHED, or REJECTED with a reason. `banquet.plate.request` asks; `banquet.kds.manage` decides and dispatches. Nobody decides their own request (service and DB CHECK). Conditional updates; audited; published after commit with no customer data. Booking page Plates panel; kitchen page queue **(this pass)** | api-unit: banquet-plates.spec; api-e2e: PL-1..9; web: banquet "Plate requests on a booking", kitchen plate tests; pw: operations "the manager asks, the chef approves and dispatches" | MET |
| BQ-KOT Printable KOT "NOT A BILL - KITCHEN ONLY" | SRS §5.3.5 | Banquet | A | KOT page | — | — | pw: conformance KOT | MET |
| BQ-FIN Banquet finance overview | SRS §5.3.6 | Banquet | A | Outstanding report, drill-down | — | — | api-e2e: RP-59 | MET |
| BQ-TERMS Printable bill with configurable T&Cs | SRS §5.3.7 | Banquet | A | Bill page | Configurable T&Cs | Branch `banquet_terms` (≤4000, DB CHECK), edited in branch settings, printed at the foot of every bill and quotation; audit records the change and length only **(this pass)** | api-e2e: companies 19b, BQ-13; web: settings "saves the bill terms", banquet "prints the branch terms"; pw: operations "branch bill terms reach the printed bill" | MET |
| BQ-PUBLIC Public booking link and customer edit requests | SRS §5.3.7, P2 §3.8 | Banquet | E | None | Public surface | An unauthenticated surface that exposes and changes a customer's booking. Needs an approved design: signed expiring links, what a customer may change, and staff approval of change requests. | — | DEFERRED |
| BQ-REPORTS Booking and revenue reports | SRS §5.3.7 | Reports | A | Reports with drill-down | — | — | api-e2e: RP-30, RP-31, RP-58 | MET |
| BQ-CHECKLIST Banquet opening checklist | SRS §5.4.2 | Routines | A | Reference library | — | — | api-e2e: TY-5 | MET |
| BQ-MONEY Integer minor units, no floating point | Task §7 | Banquet | A | Integer minor units | — | — | api-unit: banquet-money | MET |
| BQ-OVERPAY Concurrent payments never overshoot | Task §7 | Banquet | A | Row lock + `paid_within_total` CHECK | — | — | api-e2e: BX-3, BQ-4 | MET |
| BQ-DOUBLE No concurrent double booking | Task §7 | Banquet | A | Exclusion constraint | — | — | api-e2e: BC-9, BX-1 | MET |
| BQ-CANCEL Cancellation behaviour | Task §7 | Banquet | A | Reason; payments retained | — | — | api-e2e: BQ-11 | MET |

## 5. Tasks & routines (Phase 9)

| Requirement | Source | Module | Classification | Current State | Gap | Implementation | Test | Status |
|---|---|---|---|---|---|---|---|---|
| T-FIELDS Title, priority, assignee, due date/time, comments | SRS §5.4.1, P2 §4.1 | Tasks | A | Implemented | — | Task page history panel **(this pass)** | api-e2e: "Edits and comments"; web: floor.test "Record history" | MET |
| T-PERMS Create / submit / edit-assigned / reassign / view-own / view-staff | SRS, P2 §4.1 | Tasks | A | Permissions | — | — | api-e2e: tasks Authorization | MET |
| T-REASSIGN Reassignment tracked | SRS | Tasks | A | Tracked | — | — | api-e2e: "Ownership and reassignment" | MET |
| T-LIST Scope and status filters | SRS | Tasks | A | Board with filters | — | — | api-e2e: "Query flags" | MET |
| T-TEMPLATES Task templates | SRS, P2 §4.1 | Tasks | A | Checklist templates plus routines | One-off task templates | A reusable "task template" (title, priority, checklist) differs from a checklist template only by title and priority; the SRS gives no further fields. Routines and checklist templates cover the recurring case. | — | PARTIAL |
| T-DASH Task dashboard statistics | SRS | Tasks | A | Summary page and widget | — | — | api-e2e: "Dashboard and completion reporting" | MET |
| T-CAL Activity calendar generating assignments | SRS, P2 §4.1 | Tasks | E | None | Calendar | Not adopted now: routines already generate assignments on schedules; a separate calendar would be a second scheduler | — | RECOMMENDATION |
| R-ENGINE One configurable routine engine | SRS §8.2.1, P2 §4.2 | Routines | A | One engine with typed items | — | — | api-e2e: Routines, TY-1..6 | MET |
| R-ITEMTYPES Boolean, rating, number, text, photo, date, signature | P2 §4.3 | Routines | A | CHECK / NUMBER / TEXT / RATING / DATE | Photo, signature | Photo and signature are binary evidence and need object storage (FR-X12). | api-e2e: TY-1..4 | PARTIAL |
| R-ONE-PER-DAY One occurrence per routine per branch-local day | P2 §4.5 | Routines | A | Unique constraint | — | — | api-e2e: Scheduler integration | MET |
| R-VIEW Supervisor view, submissions list, transposed log | SRS §5.4.2 | Routines | A | Transposed log | — | — | api-e2e: TY-6 | MET |
| R-DEADLINE Deadlines and missed-deadline reporting | SRS, P2 §1.8 | Routines | A | on_time / late | — | — | api-e2e: RP-60 | MET |
| R-EXPORT Excel/PDF of submissions | SRS | Routines | A | Adherence report exportable | Transposed log export | `GET /routines/:id/log/export` (tasks.reports.view + reports.export), rendered by the shared exporter, audited, PDF refused beyond 14 date columns; Export Excel / PDF on the log page **(this pass)** | api-unit: routine-log-export.spec; api-e2e: TY-7; web: tasks "exports the shown window …" | MET |
| R-MODE Admin / staff access per routine | SRS | Routines | A | view vs view_own permissions | — | Permission-based | — | MET |
| R-OFFLINE Offline capture and deferred sync | SRS, P2 §1.7 | Routines | A/B | Online only | Offline | See FR-X5 | — | DEFERRED |
| R-PHOTO Item-level photo evidence | SRS, P2 §1.5 | Routines | B | None | Object storage | See FR-X12 | — | DEFERRED |
| R-11 The eleven reference routines as definitions | SRS §5.4.2, P2 §4.2 | Routines | A | 8 installable definitions | 3 definitions | Kitchen, BM and Operational checklists are named in the source without their items; inventing items would invent operating standards. | api-e2e: TY-5 | PARTIAL |

## 6. Reports & exports (Phase 10)

| Requirement | Source | Module | Classification | Current State | Gap | Implementation | Test | Status |
|---|---|---|---|---|---|---|---|---|
| RPT-FILTER Branch + date range, role-scoped | SRS §5.8, P2 §8 | Reports | A | Two-key authorization; ranges ≤366 days | — | — | api-e2e: RP-1..28 | MET |
| RPT-DRILL Drill-down to the source record | SRS §5.8 | Reports | A | `definition.drilldown` | — | — | api-e2e: RP-58 | MET |
| RPT-EXPORT Excel + PDF | SRS §5.8 | Reports | A | Localised exports | — | Export renderer now shared with the routine log **(this pass)** | api-e2e: RP-37..43, TY-7 | MET |
| RPT-SHARE WhatsApp share | SRS §5.8 | Reports | E | None | Share | Not adopted now: sharing a file sends business data to an external service; needs a data-sharing policy | — | RECOMMENDATION |
| RPT-LIST Queue, task, activity, banquet, routine-compliance reports | SRS §5.8 | Reports | A | 8 reports + audit viewer | — | — | api-e2e: RP-7, RP-59, RP-60 | MET |
| RPT-ASYNC Job-queue exports, read replica | P2 §18 | Reports | E | Synchronous, capped at 5,000 rows | — | Not adopted: a 14-day, 4,200-row export was measured (PF-5); no background workers or Redis without a measured need | api-e2e: performance PF-5 (opt-in) | RECOMMENDATION |
| RPT-PAGE Stable pagination, bounded offsets | Task §15 | Reports | D | Tie-breakers; offset ≤100,000 | — | — | api-e2e: RP-61 | MET |
| RPT-RUN No dead controls | Task §16 | Reports | A | Run nonce | — | — | web: RF-13b | MET |

## 7. Future modules (not built — separated per instruction)

| Requirement | Source | Module | Classification | Current State | Gap | Implementation | Test | Status |
|---|---|---|---|---|---|---|---|---|
| Inventory & procurement (stock ledger, suppliers, POs, transfers) | SRS §5.5, P2 §5 | Inventory | C | Permission keys reserved only | Module | None; routine answers capture figures without posting | — | FUTURE MODULE |
| Finance (expenses, petty cash, daily closing, UPI, vouchers) | SRS §5.6, P2 §6 | Finance | C | Permission keys reserved only | Module | None; no fabricated values | — | FUTURE MODULE |
| POS incl. menu, billing, POS KDS / KOT routing | SRS §5.7, P2 §7 | POS | C | Permission keys reserved only | Module | None | — | FUTURE MODULE |
| AI assistant; cleaner / head consoles | SRS §5.10–5.11, P2 §11 | Other | C | — | — | None | — | FUTURE MODULE |

## 8. Non-functional and platform

| Requirement | Source | Module | Classification | Current State | Gap | Implementation | Test | Status |
|---|---|---|---|---|---|---|---|---|
| NFR-01 Realtime about 1 s | SRS §7 | Realtime | D | SSE push; displays with a safety poll | — | — | pw: display "live, without a reload" (≤10 s bound), operations plate approval across two sessions | MET |
| NFR-02 Responsive desktop / tablet / phone; wall display | SRS §7 | Web | D | Responsive shell | New screens | New screens checked at phone and tablet sizes with no sideways page scroll **(this pass)** | pw: admin phone/tablet, operations tablet/phone, conformance, roles | MET |
| NFR-03 Offline tolerance for routine forms | SRS §7 | Routines | D | — | Offline | See FR-X5 | — | DEFERRED |
| NFR-04 Dashboard and report under 3 s | SRS §7 | Reports | D | Measured on this development machine, with 60,000 queue tokens, 6,000 tasks and 720 bookings over 120 days at 3 branches. p95: dashboard 101 ms (30 days) and 105 ms (90 days); All Branches 86 ms; reports 41–106 ms, including a page at offset 20,000; 20 concurrent dashboard requests 481 ms. | Evidence under production-like conditions | Opt-in load test **(this pass)**. Not measured: production hardware, network round trips, a remote or shared database, other tenants' load. A 14-day, 4,200-row Excel export took p95 3,263 ms; exports are outside this target but close to it. | api-e2e: performance PF-1..6 (opt-in, `SAMCO_PERF=1`) | PARTIAL |
| NFR-05 Server-side authorization | SRS §7 | Foundation | D | PermissionGuard; route inventory | — | See X-AUTHZ, X-PLATFORM | api-e2e: route-inventory, CC-1..9 | MET |
| NFR-06 Immutable audit for money and bookings | SRS §7 | Audit | D | Append-only by trigger | — | — | api-e2e: BQ-3 | MET |
| NFR-07 en_IN, ₹, dd/MM/yyyy, CGST/SGST | SRS §7 | All | D | Consistent | — | See X-L10N | web / api-unit | MET |
| NFR-08 Accessible DOM customer screens | SRS §7 | Displays | D | DOM boards with roles and labels | — | New screens use labelled controls, live regions for status and errors, and the chart has a text summary and data table **(this pass)** | web: display tests, admin, floor, reports RF-30e | MET |
| NFR-09 Retention (notifications, queue history, audit) | SRS §7 | Platform | D | Retained indefinitely | Policy and jobs | Retention periods are a legal and business decision (audit and money history are append-only by design); needs an approved policy before any archiving job. | — | DEFERRED |
| NFR-10 Multi-tenancy designed in | SRS §7 | Foundation | D | Company + branch scoping everywhere | — | Platform-only company creation **(this pass)** | api-e2e: isolation tests across suites, CC-1..9 | MET |
| P2-OPS Environments, CI, backups / PITR, monitoring, residency | P2 §20 | Ops | D | Outside the repository | — | — | — | NOT APPLICABLE |
| P2-RT Resume tokens, deltas, optimistic UI | P2 §19 | Realtime | D | Refetch-on-event; resync on reconnect | Last-Event-ID replay | Screens reconcile from REST after every event and on reconnect, which is correct but not delta-based; replay would add server-side event retention. | web: use-queue-board "resyncs when the stream reopens" | PARTIAL |
| P2-INFRA Redis, read replica, workers, object storage, CDN | P2 §13 | Platform | E | PostgreSQL + in-process broker / scheduler | — | Not adopted without measured need (see NFR-04) | — | RECOMMENDATION |
| P2-COST Budget / TCO | P2 §15–22 | — | — | — | — | — | — | NOT APPLICABLE |
