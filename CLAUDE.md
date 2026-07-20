# FAMMS — Factory Asset & Maintenance Management System
## Version 1.0 | Lightweight Equipment Maintenance Management

---

## Quick Start

```bash
npm install
npm run dev              # http://localhost:3000
npx tsc --noEmit        # Type check (should exit 0)
```

**Project Location**: `/home/user/project`

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) + TypeScript |
| Styling | Tailwind CSS v4 + shadcn/ui (@base-ui/react) |
| Database | Supabase (PostgreSQL + Auth + RLS) |
| Storage | Supabase Storage (photos, attachments) |
| AI | OpenAI `gpt-4o-mini` (future knowledge base) |
| Charts | Recharts (KPI dashboard) |
| Notifications | Telegram Bot API |
| Date Utils | date-fns |
| UI Components | Radix UI (via base-ui) + Lucide icons |

### ⚠️ CRITICAL: Base UI, NOT Radix UI

This project uses `@base-ui/react`, NOT `@radix-ui/react`. Key differences:

- **NO `asChild` prop** — use `className` directly instead
- **NO `<Link asChild>` pattern** — use `onClick={() => router.push(...)}`
- Apply styles directly to trigger elements

### 🌐 Language Convention: Bahasa Indonesia + English Tech Terms

Factories (SJA, DIN, Olentia) are in Indonesia. UI is presented in **Bahasa
Indonesia mixed with English technical terms**:

- **UI labels, buttons, status, messages** → Bahasa Indonesia
  (e.g. "Lapor Incident", "Sedang Perbaikan", "Menunggu Parts")
- **Parts / components / technical terms** → keep English
  (e.g. bearing, VFD, PLC, motor, gearbox, sensor, contactor, breaker)
- **Failure code names** → Bahasa Indonesia for the symptom, English for the
  component (e.g. `BEARING_001` = "Pelumasan Kurang (Lubrication)",
  `VFD_001` = "Overheat / Over Temperature")

All user-facing label maps live in `src/types/famms.ts` (INCIDENT_STATUS_LABELS,
ROLE_LABELS, ACTION_TYPE_LABELS, etc.). The fault tree seed
(`supabase/seed_fault_tree.sql`) follows the same convention.

---

## System Architecture

### Core Philosophy

**FAMMS is NOT a simple ticket system.** It's an equipment asset management system designed to:

1. **Track equipment lifecycle** — machine master, history, health score
2. **Manage incidents properly** — multi-action repair workflow, not one-step fixes
3. **Detect repeat failures** — via fault tree + incident relations
4. **Drive decision-making** — KPI dashboard, equipment health, cost analysis

### What Makes FAMMS Different

| Traditional CMMS | FAMMS |
|---|---|
| Report → Fix → Close | Incident → Multiple Actions → Observation → Close |
| Count total failures | Count independent failures vs. repeats |
| Manual fault classification | Standardized fault tree (100+ codes) |
| No relationship tracking | Incident relations (repeat, same cause, etc.) |
| No temp fix tracking | Temporary vs. permanent fix distinction |

---

## Data Model Overview

### 1. Organization & Auth
- **factories**: SJA, DIN, Olentia (multi-tenant)
- **areas**: Production, Packing, Warehouse, etc.
- **profiles**: Users with roles (technician, supervisor, manager, director, admin)

### 2. Equipment Master
- **machines**: Full equipment record (code, name, brand, model, serial, dates, owner, maintenance cycle, status)
- **machine_qr_codes**: QR code per machine for quick access (report issue, view history, etc.)

### 3. Failure Classification (Fault Tree)
- **failure_categories**: Hierarchical (Main → Sub → Leaf) — MECH, ELEC, UTILITY, PROCESS, OPERATION
- **failure_codes**: 100+ standardized codes (BEARING_001, VFD_005, SENSOR_003, etc.)

Key benefit: Machines like DIN-HMG-001 with "axle bearing fault" + "sensor fault" are NOT grouped as repeat failures because they have different failure codes.

### 4. Incident Management
- **incidents**: One reported issue per machine at a time
- **incident_actions**: Multiple repair steps (inspection, temporary fix, root cause analysis, part replacement, testing, observation, permanent fix)
- **incident_relations**: Track relationships (repeat_failure, same_root_cause, temporary_fix_followup, new_failure)
- **incident_comments**: Audit trail of discussions

### 5. Preventive Maintenance
- **pm_schedules**: Daily, weekly, monthly, quarterly, half-yearly, yearly PM plans
- **pm_records**: Actual PM execution with completion, delay reasons, findings, parts replaced, cost

### 6. Maintenance Costs
- **maintenance_costs**: Labor, parts, vendor costs per action
- Aggregated in KPI dashboard by equipment, factory, time period

### 7. Spare Parts
- **spare_parts**: Inventory master (code, name, price, stock, reorder level)
- **spare_part_transactions**: Track usage (used_in_repair, received, adjustment, scrapped)

### 8. Knowledge Base
- **knowledge_base**: Post-incident learning (problem, root cause, repair method, photos, lessons learned)
- Searchable by keywords, linked to incident for traceability

### 9. Equipment Health Score
- **equipment_health_scores**: Auto-calculated score (0-100)
  - 100: Excellent
  - 80: Warning
  - 60: Risk
  - 40: Critical (consider replacement)
- Based on: failure count, downtime hours, repeat failures, PM overdue

### 10. Notifications
- **telegram_users**, **telegram_groups**: User opt-in + group subscriptions
- **notification_logs**: Audit trail of all notifications sent

### 11. RCA (Root Cause Analysis)
- **rca_records**: Triggered when same machine + incident_type ≥3 times in 90 days (see RCA Trigger section below for why this isn't keyed on failure_code)
- Mandatory fields: root cause, corrective action, preventive action, responsible person, due date

---

## Incident Workflow (Critical Business Logic)

### Reported → Accepted → Analyzing → Repair → Observation → Closed

```text
Incident Created
  ↓ (status: reported)
Technician Inspects
  ↓ (action: inspection, status: analyzing)
Root Cause Identified
  ↓ (action: root_cause_analysis)
Parts Ordered? → Blocked (waiting_parts)
  ↓
Temporary/Permanent Fix Applied
  ↓ (action: temporary_fix or corrective_action)
  ↓ (completion_type: 'temporary_fix' or 'permanent_fix')
Testing & Verification
  ↓ (action: testing, status: testing)
Observation Period
  ↓ (status: observation, 3/7/30 days)
Machine Stable → Closed
  ↓ (status: closed, closed_at: timestamp)
Create Knowledge Base Entry
```

### Key: Completion Type Matters

**Temporary Fix** (high risk):
- Reposition bearing, re-torque bolts, temporary weld, bypass mode
- System will flag a repeat-failure candidate if the same machine + incident_type recurs within 30 days (see Repeat Failure Detection below)
- Must set observation_period

**Permanent Fix** (low risk):
- Replace bearing, replace VFD, update PLC firmware
- System still tracks for KPI, but won't auto-flag as repeat if similar fault later
- Helps distinguish "problem solved" from "kicked the can down the road"

---

## Repeat Failure Detection (No False Positives)

> **Note**: the 100+-code fault tree (`failure_code_id`) was never wired up
> by any report path — the report form only ever captures the coarse
> `incident_type` category (machine/pipe/electrical/facility/safety/
> cleanliness/other). This detection is keyed off `(machine_id, incident_type)`
> instead of the fault-tree code, trading some precision for actually firing.
> See `src/lib/repeat-failure.ts`.

System detects **potential repeat failures** ONLY when:

1. **Same Machine** (e.g., DIN-HMG-001) — `machine_id` must be non-null and match
2. **Same Incident Type** (e.g., `machine`, `electrical`) — the coarse category, not a fault-tree code
3. **Within 30 days** of the prior incident being reported
4. **Previous incident was closed as a Temporary Fix** OR **has no root cause on record** (root cause unresolved)

When detected (at report time — right after the new incident is created):
- The new incident's own detail page shows: "⚠️ Potential Repeat Failure" (only to a supervisor+ viewer)
- **Supervisor must confirm**: "Is this the same issue?" (yes/no)
  - If YES → `POST /api/incidents/[id]/relations` links it as `incident_relations` type 'repeat_failure' (`confirmed_by_id` / `confirmed_at` stamped)
  - If NO → nothing is written; the new incident stands on its own
- The same detection runs in the Telegram `/lapor` flow, notifying the factory's supervisors with a Ya/Bukan inline-button prompt

This avoids the false positive of DIN-HMG-001 with a `machine`-type failure and a `safety`-type report being marked as "repeat" — they're different `incident_type`s even on the same machine. It does NOT distinguish, say, a bearing fault from a sensor fault if both were logged as `incident_type: machine` — that finer-grained distinction would need the fault tree, which the app deliberately doesn't surface to reporters (see the UX rationale in "Why Fault Tree" below — reporting speed won over classification precision).

---

## RCA Trigger & Mandatory Flow

> **Note**: same caveat as above — keyed off `(machine_id, incident_type)`, not
> `failure_code_id`. See `checkRCARequirement()` in `src/lib/rca.ts`.

Automatic trigger:
```
Same machine_id + incident_type (e.g., DIN-HMG-001 + "machine")
Occurs ≥3 times
Within 90 days
→ System forces: Fill RCA or cannot close incident
```

Only applies when the incident has a `machine_id` — facility/electrical/etc.
incidents with no machine attached never trigger this (nothing to compare
across incidents against).

Mandatory RCA fields:
- Root cause (why?)
- Corrective action (how to fix?)
- Preventive action (how to prevent?)
- Responsible person (who?)
- Due date (when?)

After RCA completion:
- System may recommend design change, supplier quality audit, process change, etc.
- KPI dashboard shows RCA completion rate

---

## KPI Dashboard

### Real-Time Metrics

| KPI | Calculation | Business Value |
|---|---|---|
| **Response Time** | reported → accepted (minutes) | SLA compliance |
| **Diagnosis Time** | accepted → analyzing complete (hours) | Process efficiency |
| **Repair Time** | repairing → testing complete (hours) | Maintenance skill level |
| **Downtime** | machine stop → running (hours) | Production loss |
| **First Fix Rate** | permanent fixes / total repairs (%) | Engineering competency |
| **Repeat Failure Rate** | repeat failures / total failures (%) | Root cause effectiveness |
| **PM Compliance** | completed PM / scheduled PM (%) | Preventive discipline |

### Per-Equipment Insights

- **DIN-HMG-001**
  - Total failures (90d): 12
  - Independent failures: 6
  - Repeat failures: 3
  - Temporary fixes: 2 (high risk)
  - Permanent fixes: 4
  - Downtime (90d): 45.5 hours
  - Health score: 65 (Risk — consider replacement)

### Failure Distribution

- **By Machine**: Which equipment fails most?
- **By Failure Code**: Which specific problems dominate? (Bearing lubrication 18%, VFD overcurrent 12%, etc.)
- **By Root Cause**: Supplier quality? Maintenance skill? Design flaw?
- **By Downtime Impact**: A (factory stop) vs. B vs. C vs. D — which costs us most?

### Factory Comparison

SJA vs. DIN vs. Olentia:
- Response time (avg)
- Repair time (avg)
- First fix rate
- Downtime per capita
- PM compliance

---

## Failure Codes (Fault Tree)

See `FAMMS_FAULT_TREE.md` for complete list.

**Quick Reference:**

| Category | Examples |
|---|---|
| **MECH** | BEARING_*, CHAIN_*, MOTOR_*, GEAR_*, STRUCT_* |
| **ELEC** | VFD_*, PLC_*, SENSOR_*, CONTACTOR_*, BREAKER_*, WIRE_* |
| **UTILITY** | AIR_*, STEAM_*, COOL_*, EXHAUST_* |
| **PROCESS** | PARAM_*, QUALITY_* |
| **OPERATION** | OP_*, NEG_* |

All are dropdown selections — no manual input.

---

## File Map

```
src/
├── app/
│   ├── layout.tsx                    root layout (Sonner toaster, Inter font)
│   ├── page.tsx                      redirect → /dashboard
│   ├── login/page.tsx                auth (signup + login)
│   ├── api/
│   │   ├── incidents/route.ts        CRUD incidents
│   │   ├── incidents/[id]/actions/route.ts  create incident_action
│   │   ├── incidents/[id]/close/route.ts    close incident + RCA check
│   │   ├── machines/route.ts         CRUD machines
│   │   ├── machines/[id]/qr/route.ts generate QR code
│   │   ├── pm/route.ts               CRUD PM schedules & records
│   │   ├── notifications/telegram/route.ts  webhook for Telegram
│   │   └── health-score/route.ts     recalculate equipment health
│   └── (dashboard)/
│       ├── layout.tsx                navbar, auth guard
│       ├── dashboard/page.tsx        KPI overview, top failures, health scores
│       ├── incidents/page.tsx        incidents list (filter by status, machine, date range)
│       ├── incidents/[id]/page.tsx   incident detail + actions + comments + RCA
│       ├── machines/page.tsx         machine master list + QR generation
│       ├── machines/[id]/page.tsx    machine detail + history + health trend
│       ├── pm/page.tsx               PM schedules + execution records
│       ├── knowledge-base/page.tsx   searchable KB + full-text search
│       ├── settings/page.tsx         factory, areas, failure codes, users
│       └── profile/page.tsx          user profile (name, role, factory)
├── components/
│   ├── shared/
│   │   ├── Navbar.tsx                header with user avatar, logout
│   │   ├── StatusBadge.tsx           colored badge for incident status
│   │   ├── HealthScoreBadge.tsx      0-100 score visual (green/yellow/red/dark)
│   │   ├── ImageGallery.tsx          before/during/after photos (react-photo-view)
│   │   └── Breadcrumbs.tsx           navigation
│   ├── incidents/
│   │   ├── IncidentForm.tsx          new incident (machine, failure code, downtime impact)
│   │   ├── ActionForm.tsx            add action to incident
│   │   ├── ActionList.tsx            timeline of all actions
│   │   ├── CommentThread.tsx         incident comments (real-time via Supabase)
│   │   ├── BlockingForm.tsx          block action (reason + required action)
│   │   ├── RCAForm.tsx               RCA mandatory fields
│   │   └── RepeatFailureConfirm.tsx  confirm if repeat or new
│   ├── machines/
│   │   ├── MachineForm.tsx           create/edit machine
│   │   ├── QRDisplay.tsx             show + download QR code
│   │   └── MachineHistory.tsx        incident timeline
│   ├── pm/
│   │   ├── PMScheduleForm.tsx        create/edit PM schedule
│   │   ├── PMRecordForm.tsx          complete PM (findings, parts, cost)
│   │   └── PMCalendar.tsx            month view of PM tasks
│   ├── dashboard/
│   │   ├── KPICards.tsx              response time, repair time, downtime, etc.
│   │   ├── FailureChart.tsx          bar/pie chart of failure distribution
│   │   ├── TopFailureMachines.tsx    ranked list
│   │   ├── HealthScoreGrid.tsx       all machines with health color coding
│   │   └── FactoryComparison.tsx     SJA vs DIN vs Olentia
│   └── ui/                           shadcn components (button, input, card, dialog, etc.)
├── lib/
│   ├── utils.ts                      cn() helper
│   ├── constants.ts                  SLA times, colors, labels
│   ├── supabase/
│   │   ├── client.ts                 browser client
│   │   └── server.ts                 server client
│   └── api-helpers.ts                common API logic (auth checks, etc.)
├── types/
│   ├── index.ts                      FAMMS types (see below)
│   └── supabase.ts                   auto-generated Supabase types (optional)
└── middleware.ts                     auth guard (unauthenticated → /login)
```

---

## Environment Variables

`.env.local` at project root:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# OpenAI (for knowledge base AI summary)
OPENAI_API_KEY=sk-...

# Telegram Bot
TELEGRAM_BOT_TOKEN=123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij
TELEGRAM_WEBHOOK_SECRET=your_random_secret # required — the webhook rejects all calls without it (set the same value via setWebhook's secret_token)

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000 (or production URL)

# External integrations (server-to-server)
QC_API_SECRET=your_random_secret      # Bearer token for GET /api/external/machine-status (QC/FQMS pulls PM/health status)
GUDANG_SYNC_SECRET=your_random_secret # Bearer token for POST /api/external/parts-requests (Gudang One writes back status)
GUDANG_WEBHOOK_URL=https://<gudang-project>.supabase.co/functions/v1/famms-request # line ①: push new parts requests to Gudang
GUDANG_WEBHOOK_SECRET=same_secret_as_gudang_famms_request # sent as x-famms-secret header
```

---

## Setup Checklist

Before first run:

1. ✅ Create `.env.local` with Supabase + OpenAI + Telegram keys
2. ✅ Run `supabase/schema.sql` in Supabase SQL editor (creates tables + 3 factories + 5 level-1 failure categories)
3. ✅ Run `supabase/SYNC_SCHEMA_LATEST.sql` — **idempotent; run after every `git pull`**. Adds all columns/tables later features need (PM assignee, incident `assigned_user_ids`/`location_note`, vendors, audit/maintenance logs…). This is the single source of "the DB has everything the app expects"; skip it and features silently fail to save/show.
4. ✅ Run `supabase/seed_fault_tree.sql` (subcategories + 100+ failure codes, Bahasa Indonesia + English)
5. 🔒 **Mandatory, not optional** — lock the database down before it holds real data:
   - `supabase/migration_security_phase1_revoke_anon.sql` — revokes the public `anon` key's access to every table. Without this, anyone who opens devtools and reads `NEXT_PUBLIC_SUPABASE_ANON_KEY` can read/write/delete the entire database directly via the Supabase REST API, with no login and no app involved.
   - `supabase/migration_rls_1_helpers.sql` → `migration_rls_2_policies.sql` → `migration_rls_3_enable_STAGED.sql` (run its stages A→E one at a time, testing the live app after each — see the file's own instructions) → `migration_rls_4_assignee_access.sql` → `migration_rls_5_incident_field_guard.sql` → `migration_rls_6_pm_assignee_access.sql`. This is what actually confines a logged-in user to their own factory's data and enforces role (e.g. a technician can't self-approve an RCA, edit vendors, move a due date, or close an incident) at the database layer, not just in the UI. `migration_rls_5` in particular is what stops a technician from bypassing the UI via devtools to change due_date / close a case / edit incident details — those roles were previously only enforced in React components. `migration_rls_6` lets a cross-factory PM assignee actually see their scheduled task on the calendar (the same fix `migration_rls_4` gave incidents).
   - `supabase/migration_security_phase3_function_execute.sql` — revoking `anon`'s own grant (step above) isn't enough on its own: Postgres grants EXECUTE on every new function to the `PUBLIC` pseudo-role by default, and every role (including `anon`) is implicitly a member of `PUBLIC`. This closes that gap for every `SECURITY DEFINER` helper/trigger function while explicitly re-granting `authenticated` first, so RLS policies (which call these helpers in-policy) keep working.
   - Re-running `SYNC_SCHEMA_LATEST.sql` after this is safe: it no longer touches `anon` grants or RLS state, so it won't undo this step.
   - Two "quick fix" scripts that used to live in `supabase/` (`SETUP_RUN_ONCE.sql`, `fix_permissions_reset.sql`) did the opposite of all of the above — disabled RLS on every table and granted `anon` full access — and have been deleted. If you have either one saved locally from before, do not run it.
5b. Run once, any order, all idempotent:
   - `supabase/migration_delete_protection.sql` — converts the machine/area/factory delete cascades to RESTRICT so deleting one no longer silently wipes every incident/PM/cost record under it.
   - `supabase/migration_pm_records_unique.sql` — de-dupes and then uniquely constrains `pm_records(pm_schedule_id, scheduled_date)` so two people completing the same projected task at once can't create duplicate rows.
   - `supabase/migration_custom_roles.sql` — adds the `custom_roles` / `role_capabilities` tables + `profiles.custom_role_key` that power Settings → 角色管理 (admin-defined roles like QC, without a code change per role). Seeds the built-in QC role and migrates any `profiles.role = 'qc'` row to `role='technician', custom_role_key='qc'`.
6. ✅ Create Supabase storage buckets:
   - `incident-photos` (public, for before/during/after)
   - `attachments` (private, for PDFs/docs)
7. ✅ Set up Telegram bot (get token from @BotFather)
8. ✅ `npm install` (if node_modules missing)
9. ✅ `npm run dev`

---

## Project Status

- **TypeScript**: 0 errors (`npx tsc --noEmit` exits 0); production build passes
- **Data Model**: ✅ Complete (14 tables)
- **Fault Tree**: ✅ Standardized (100+ codes, 5 main categories) — `seed_fault_tree.sql`
- **Incident Logic**: ✅ Repeat failure detection (API), RCA trigger (planned)
- **Built (Phase 2)**: ✅ Incident list / report form (cascading fault tree) / detail + action timeline; `POST /api/incidents` (auto incident_no + repeat detection); `POST /api/incidents/[id]/actions`; Machines list; Indonesian UI throughout
- **Demo data**: `seed_demo.sql` (areas + 6 sample machines incl. DIN-HMG-001)
- **Not Yet Built**: PM module, Knowledge Base, KPI charts, RCA forms, photo upload, Telegram, health score, QR codes, machine CRUD

---

## Success Criteria (V1.0)

By end of V1, system should enable:

1. ✅ **Equipment Master** — All machines in SJA, DIN, Olentia catalogued with QR codes
2. ✅ **Incident Management** — Multi-action workflow, not one-step fixes
3. ✅ **Repeat Failure Detection** — Without false positives (via fault codes + relations)
4. ✅ **PM Compliance Tracking** — Daily to yearly schedules with completion rates
5. ✅ **Equipment Health Score** — Visual red/yellow/green for decision-making
6. ✅ **RCA Discipline** — Auto-triggered when same fault ≥3 times in 90 days
7. ✅ **Knowledge Base** — Post-incident capture (problem, fix, lessons learned)
8. ✅ **Cost Tracking** — Labor + parts + vendor per incident action
9. ✅ **KPI Dashboard** — Response time, repair time, downtime, first fix rate, repeat rate
10. ✅ **Telegram Notifications** — Incident alerts, SLA alerts, daily summaries
11. ✅ **Factory Comparison** — SJA vs. DIN vs. Olentia KPI benchmarking

---

## Critical Design Decisions

### Why Multi-Tenant (Factories)?

SJA, DIN, Olentia have different equipment, processes, and goals. System must allow:
- Independent failure code customization
- Separate PM schedules per factory
- Factory-level KPI comparisons
- User assignment to specific factory

### Why Fault Tree (100+ Codes)?

Without it:
- "Bearing fault" could be lubrication, installation, wear, seal — all different root causes
- System can't distinguish between true repeats and coincidences
- KPI becomes "count failures" not "solve root causes"

With it:
- BEARING_001 (lubrication) detected 7 times in 90 days → RCA triggered
- BEARING_003 (wear) detected once → no trigger
- System can recommend "improve lubrication schedule" not "design change"

### Why Incident Relations?

Without it:
- Incident 1 (2 weeks ago, temporary weld) → closed
- Incident 2 (today, same machine/fault) → treated as totally independent
- No way to track "we kicked the can down the road"

With it:
- Incident 2 links to Incident 1 as `temporary_fix_followup`
- System learns: "35% of temporary fixes fail within 30 days"
- KPI dashboard shows this risk, forcing better permanent solutions

### Why Completion Type?

Without it:
- Incident 1 (tightened bearing bolts) looks same as Incident 2 (replaced bearing)
- First fix rate = 50% (both counted as "fixed")
- But reality: temporary fix will re-fail, permanent fix will not

With it:
- Incident 1: temporary_fix (high risk)
- Incident 2: permanent_fix (low risk)
- First fix rate = 50%, but "true permanent fix rate" = 50% (reveals problem)

