# FAMMS V1.0 Implementation Roadmap
## Factory Asset & Maintenance Management System

---

## ✅ Completed

### Phase 1: Architecture & Data Model (✓ DONE)

1. **Fault Tree Standardization**
   - ✅ 5 main categories (MECH, ELEC, UTILITY, PROCESS, OPERATION)
   - ✅ 100+ specific failure codes (BEARING_001, VFD_005, SENSOR_003, etc.)
   - ✅ Hierarchical structure (main → sub → leaf)
   - ✅ See: `FAMMS_FAULT_TREE.md`

2. **Complete Data Model**
   - ✅ 14 core tables in `supabase/schema.sql`
   - ✅ Multi-tenant architecture (factories, areas, users)
   - ✅ Equipment master (machines, machine_qr_codes)
   - ✅ Incident management (incidents, incident_actions, incident_relations)
   - ✅ PM scheduling & tracking
   - ✅ Spare parts integration
   - ✅ Maintenance costs tracking
   - ✅ Equipment health scores
   - ✅ Knowledge base (searchable)
   - ✅ RCA (Root Cause Analysis)
   - ✅ Telegram notifications
   - ✅ Projects management

3. **Core Types**
   - ✅ `src/types/famms.ts` with complete type definitions
   - ✅ Incident status, action types, completion types
   - ✅ KPI helpers (colors, labels, health score badges)

4. **Clean Codebase**
   - ✅ Removed all PDP (procurement) business logic
   - ✅ Kept auth framework, UI components, Supabase integration
   - ✅ PDP retained in git history for reference

---

## 📋 Next Steps: Frontend Implementation

### Phase 2: Core Pages (Next)

**Priority 1: Incident Management**
- [ ] `/incidents` — incident list with filters (status, machine, date range)
- [ ] `/incidents/new` — create incident form (machine selector, failure code dropdown)
- [ ] `/incidents/[id]` — incident detail page
  - Display current status, downtime impact, failure code
  - Timeline of actions (inspection, temporary fix, testing, observation)
  - Comments thread (real-time via Supabase)
  - RCA form (if triggered by system)
  - Repeat failure confirmation (if detected)

**Priority 2: Equipment Master**
- [ ] `/machines` — machine list with health scores
- [ ] `/machines/new` — create machine
- [ ] `/machines/[id]` — machine detail, history, health trend

**Priority 3: PM Management**
- [ ] `/pm` — PM schedules & records
- [ ] PM calendar view (month view of tasks)
- [ ] PM execution form (findings, parts used, cost)

**Priority 4: Dashboard**
- [ ] KPI cards (response time, repair time, downtime, first fix rate, repeat failure rate, PM compliance)
- [ ] Failure distribution charts (by machine, by failure code, by root cause)
- [ ] Top failure machines (ranked list)
- [ ] Equipment health grid (color-coded: green/yellow/red/dark)
- [ ] Factory comparison (SJA vs DIN vs Olentia)

**Priority 5: Knowledge Base**
- [ ] `/knowledge-base` — searchable knowledge base
- [ ] Auto-populate from closed incidents

---

## 🔧 API Routes to Build

```
/api/incidents/              — CRUD incidents
/api/incidents/[id]/         — get incident detail
/api/incidents/[id]/actions  — create incident_action
/api/incidents/[id]/close    — close incident + RCA check
/api/incidents/[id]/comments — add comment

/api/machines/               — CRUD machines
/api/machines/[id]/qr        — generate QR code

/api/pm/                     — CRUD PM schedules & records
/api/pm/[id]/record          — complete PM record

/api/health-score/           — recalculate equipment health scores
/api/notifications/telegram  — webhook for Telegram messages

/api/knowledge-base/         — create/search knowledge base
```

---

## 🎯 Key Business Logic to Implement

### 1. Repeat Failure Detection (Critical)

```typescript
When new incident is created:
  1. Check: same machine + same failure_code + within 30 days + previous was temporary_fix
  2. If matched: flag "⚠️ Potential Repeat Failure"
  3. Show supervisor: "Is this the same issue or new incident?"
  4. If YES: create incident_relation type 'repeat_failure'
  5. If NO: create new incident
```

### 2. RCA Trigger (Critical)

```typescript
When incident is closed:
  1. Count: same failure_code occurrences in 90 days
  2. If count >= 3: system REQUIRES RCA fields
  3. Cannot close incident without RCA completion
  
  RCA fields:
    - root_cause (text)
    - corrective_action (text)
    - preventive_action (text)
    - responsible_person_id (user)
    - due_date (date)
    - status (open → in_progress → completed → closed)
```

### 3. Equipment Health Score (Important)

```typescript
Calculate every 6 hours for each machine:
  - failure_count_90d: number of incidents
  - downtime_hours_90d: sum of downtime hours (estimate from observation_period)
  - repeat_failure_count: from incident_relations
  - pm_overdue_count: overdue PM records
  
  Score = 100 - (
    failure_count * 2 +
    downtime_hours / 10 +
    repeat_failure_count * 5 +
    pm_overdue_count * 3
  )
  
  Capped at 0-100
  
  Badge:
    100+ = Excellent (green)
    80-99 = Warning (yellow)
    60-79 = Risk (orange)
    <60 = Critical (red)
```

### 4. Work Order Blocking (Important)

```typescript
When supervisor blocks an action:
  - block_reason: waiting_parts, waiting_vendor, waiting_approval, etc.
  - required_action: need_purchase, need_approval, etc.
  - System immediately notifies Telegram
  - Status in KPI dashboard: "Blocked (X)" shows count
```

---

## 📊 KPI Calculations

```typescript
Response Time = reported_at → accepted_at (minutes)
Diagnosis Time = accepted_at → analyzing_complete (hours)
Repair Time = repairing → testing_complete (hours)
Downtime = machine_stop → running (hours) — estimate from observation_period
First Fix Rate = permanent_fix / total_repairs (%)
Repeat Failure Rate = repeat_failures / total_failures (%)
PM Compliance = completed_pm / scheduled_pm (%)
```

All aggregated by:
- Time period (today, 7d, 30d, 90d)
- Machine
- Failure code
- Root cause
- Factory (SJA vs DIN vs Olentia)

---

## 🎨 UI Components to Build

**Shared**
- `StatusBadge.tsx` — incident status colors
- `HealthScoreBadge.tsx` — 0-100 health visual
- `ImageGallery.tsx` — before/during/after photos

**Incidents**
- `IncidentForm.tsx` — create incident
- `ActionForm.tsx` — add action to incident
- `ActionList.tsx` — timeline of actions
- `CommentThread.tsx` — real-time comments
- `BlockingForm.tsx` — block action + reason
- `RCAForm.tsx` — RCA mandatory fields
- `RepeatFailureConfirm.tsx` — confirm if repeat or new

**Machines**
- `MachineForm.tsx` — create/edit
- `QRDisplay.tsx` — show + download QR
- `MachineHistory.tsx` — incident timeline

**PM**
- `PMScheduleForm.tsx` — create/edit schedule
- `PMRecordForm.tsx` — complete PM
- `PMCalendar.tsx` — month view

**Dashboard**
- `KPICards.tsx` — response, repair, downtime, etc.
- `FailureChart.tsx` — bar/pie charts
- `TopFailureMachines.tsx` — ranked list
- `HealthScoreGrid.tsx` — all machines with colors
- `FactoryComparison.tsx` — SJA vs DIN vs Olentia

---

## 🚀 Deployment & Testing

### Before Production

1. **Database**
   - [ ] Run `supabase/schema.sql` in Supabase SQL editor
   - [ ] Verify all 14 tables created
   - [ ] Test RLS policies

2. **Environment**
   - [ ] `.env.local` with Supabase + OpenAI + Telegram keys
   - [ ] Supabase storage buckets:
     - `incident-photos` (public)
     - `attachments` (private)

3. **Initial Data**
   - [ ] Seed 3 factories (SJA, DIN, Olentia)
   - [ ] Seed areas per factory
   - [ ] Create sample machines (5-10 per factory)
   - [ ] Generate QR codes

4. **Testing**
   - [ ] E2E: Create incident → add actions → close → RCA → knowledge base
   - [ ] Repeat failure detection works correctly
   - [ ] Health score calculation
   - [ ] KPI dashboard aggregations
   - [ ] Telegram notifications

### Production Rollout

1. **Phase 1 (Week 1)**: SJA testing
   - [ ] Load all SJA machines
   - [ ] Power users test incident workflow
   - [ ] Collect feedback

2. **Phase 2 (Week 2)**: DIN + Olentia
   - [ ] Onboard DIN users
   - [ ] Onboard Olentia users
   - [ ] PM compliance tracking begins

3. **Phase 3 (Week 3)**: Analytics
   - [ ] Validate KPI calculations
   - [ ] Health scores accurate
   - [ ] Knowledge base maturation

---

## 📞 Support & Customization

### Factory-Specific Customization

**SJA Maintenance**: Food processing equipment
- Likely issues: bearing wear, motor overheating, sanitization effects

**DIN Maintenance**: Similar food processing
- Likely issues: wear, corrosion, electrical

**Olentia Maintenance**: Possibly different product
- Possible issues: may need custom failure codes

**Flexible Approach**:
- Failure codes defined in `failure_codes` table
- Can add codes per factory without code changes
- Supervisors can flag "new failure type" → admin adds code
- No downtime required

---

## 📈 Success Metrics (V1.0)

After 3 months:

1. ✅ **Equipment Visibility**: 100% of machines in system with QR codes
2. ✅ **Incident Tracking**: 100% of failures logged (even temporary fixes)
3. ✅ **Repeat Failure Detection**: No false positives, accurate flagging
4. ✅ **RCA Discipline**: ≥90% of incidents ≥3x get RCA filled
5. ✅ **PM Compliance**: Visible tracking, ≥80% completion
6. ✅ **Equipment Health**: Clear visual signals (red/orange/green) drive maintenance decisions
7. ✅ **Knowledge Base**: ≥100 entries, searchable, reduces repeat training
8. ✅ **Cost Visibility**: All maintenance costs tracked by machine
9. ✅ **Downtime Analysis**: Clear metrics on which machines cost the most
10. ✅ **Factory Comparison**: KPI benchmarking between SJA/DIN/Olentia

---

## 🔐 Security Considerations

1. **Auth**: Supabase Auth (email/password + TOTP optional)
2. **RLS**: Row-level security on machines, incidents, PM by factory
3. **Storage**: Supabase Storage with public (photos) + private (documents) buckets
4. **Secrets**: `.env.local` not in git, Telegram token secure
5. **Telegram**: Bot token protected, only process messages from registered groups

---

## 📚 Documentation

- `CLAUDE.md` — Project overview & architecture
- `FAMMS_FAULT_TREE.md` — Complete failure classification system
- `FAMMS_IMPLEMENTATION_ROADMAP.md` — This file (task tracking)
- Code comments: Explain WHY, not WHAT (assume readers know TypeScript)

---

## Git Workflow

```bash
# Create feature branch
git checkout -b feat/incident-management

# Make changes
# Test locally
# Commit to branch
git push -u origin feat/incident-management

# Pull request to claude/brave-fermi-vubgj6
# Review → merge
```

All work on: `claude/brave-fermi-vubgj6` branch

---

## Contact & Questions

For clarifications or blockers:
1. Check `CLAUDE.md` first
2. Check `FAMMS_FAULT_TREE.md` for business logic
3. Check schema.sql for table structure
4. Refer to type definitions in `src/types/famms.ts`

System designed to be:
- **Lightweight**: No over-engineering, minimal moving parts
- **User-focused**: Supervisors see what matters (health scores, downtime, repeat failures)
- **Data-driven**: Every decision backed by incident data + fault tree
- **Sustainable**: Patterns captured in knowledge base, reduces firefighting

---

## Summary

**Current State**: 
- ✅ Complete data model (schema.sql)
- ✅ Standardized fault tree (100+ codes)
- ✅ Core types (famms.ts)
- ✅ Clean codebase (PDP removed)
- ✅ Dashboard skeleton

**Next**: Build incident management pages + API routes

**Timeline**: Estimate 3-4 weeks for full V1.0 with testing & initial deployment
