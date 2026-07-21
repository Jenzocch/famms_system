# Supabase SQL — 怎麼跑這些檔案

這個資料夾裡的 `.sql` 都是貼進 **Supabase → SQL Editor → New query → Run** 執行的。

> ⚠️ **最重要的一件事**：貼的是「**檔案打開後裡面的 SQL 文字**」，不是檔名／路徑。
>
> - ❌ 錯：`supabase/migration_pm_assignee.sql` ← 這是路徑，SQL Editor 會報 `syntax error`
> - ✅ 對：`ALTER TABLE pm_schedules ADD COLUMN ...` ← 打開檔案後真正的內容
>
> 幾乎所有檔案都用 `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` 寫成，**重複跑也不會壞**。不確定時再跑一次是安全的。

---

## 情境一：全新環境（新的 Supabase 專案）

照順序各跑**一次**，schema 就一次到位：

| 順序 | 檔案 | 做什麼 |
|---|---|---|
| 1 | `schema.sql` | 建立所有表 + 3 個工廠 + 5 大故障分類 |
| 2 | `seed_fault_tree.sql` | 100+ 標準故障代碼（中英對照） |
| 3 | `setup_all.sql` | 補齊所有後加的欄位、權限、storage bucket、incident types（**已含 PM 負責人欄位**） |
| 4（可選） | `seed_demo.sql` | 範例工作區 + 機台，方便測試 |
| 5（可選） | `seed_din_machines.sql`、`seed_sja_olt_machines.sql` | 各廠初始機台 |
| 6（可選） | `seed_demo_incidents.sql` | 跑過一輪流程的範例工單 |
| 7 🔒 **必做，不是可選** | 見下方「安全鎖定（RLS）」整組 | 沒跑這組之前，**anon key 可以直接讀寫整個資料庫**，跳過登入、跳過 app、跳過所有權限檢查 |

`setup_all.sql` 跑完最後會印出 ✅ 檢查結果，看到表名、admin、demo 工單就代表成功。**但這還不代表安全**——`setup_all.sql` 和 `schema.sql` 都不會啟用 RLS（這是刻意的，RLS 要在下面第 7 步分階段開，一次全開會直接把 app 卡死），第 7 步跑完才算真正完工。

---

## 安全鎖定（RLS）— 全部必做，順序不能錯

新環境跑完情境一的 1-6 步之後，**立刻**照順序跑完這一整組，中間不要跳過任何一個檔案：

| 順序 | 檔案 | 做什麼 |
|---|---|---|
| 1 | `migration_security_phase1_revoke_anon.sql` | 收回 `anon` 對所有表的權限——這是最關鍵的一步，做完這步 anon key 才不能直接打 API 讀寫資料 |
| 2 | `migration_rls_1_helpers.sql` | 建立 RLS 政策要用的輔助函式（`app_role()`、`app_is_admin()` 等） |
| 3 | `migration_rls_2_policies.sql` | 建立每張表的 RLS 政策 |
| 4 | `migration_rls_3_enable_STAGED.sql` | **分階段**（檔案內 A→E）逐步打開 RLS，每開一階段就上線測一次；一次全開很容易把某個查詢卡死，之後很難定位是哪張表出的問題 |
| 5 | `migration_rls_4_assignee_access.sql` | 讓被指派工單的技師（即使不是自己工廠）能看到自己的案件 |
| 6 | `migration_rls_5_incident_field_guard.sql` | 擋掉技師繞過畫面直接用 devtools 改 `due_date` / 結案 / 改工單內容 |
| 7 | `migration_rls_6_pm_assignee_access.sql` | PM 保養版的第 5 步，讓跨廠 PM 負責人看得到自己排定的任務 |
| 8 | `migration_security_phase3_function_execute.sql` | 收回 `PUBLIC` 對這些函式的執行權限——只收回 `anon` 不夠，Postgres 預設會把新函式的 EXECUTE 權限給 `PUBLIC`，而每個角色（包含 `anon`）都隱含是 `PUBLIC` 的成員，所以只 revoke `anon` 沒有真正關上這個洞 |
| 9 | `migration_rls_7_missing_tables.sql` | 補上三張晚於 RLS 佈署才建立的表（`telegram_report_drafts`／`vendors`／`parts_requests`）的 RLS 與政策，並移除一次性的 `rls_set()` 佈署工具函式——沒補之前，任何登入帳號都能跨廠直接讀寫這三張表 |

跑完這 8 步之後再跑 `SYNC_SCHEMA_LATEST.sql` 是安全的——它不會動 anon 權限或 RLS 狀態，不會把這一組鎖定復原。

⚠️ **不要**用「整個資料庫關掉 RLS + 全開權限」當作排除故障的手段（例如遇到「送出失敗」或「refresh 資料不見」）。那個症狀幾乎都是欄位缺失（跑 `SYNC_SCHEMA_LATEST.sql`）或 RLS 政策沒覆蓋到某個查詢（回頭檢查上面第 3-4 步），不是要整組安全鎖定砍掉重練。

---

## 情境二：現有環境，之後又加了新功能

每次新增功能我會給你一個 **新的 `migration_*.sql`**。你只要：

1. Supabase → **SQL Editor** → New query
2. 打開那個檔案，**整個內容**全選複製貼進去
3. 按 **Run**

需要的話我會把完整 SQL **直接貼在對話裡**，你連檔案都不用開，直接複製即可。

---

## 檔案速查

### 核心
- `schema.sql` — 完整資料表結構（從零建置用）
- `setup_all.sql` — 累積所有後續變更的「一次到位」腳本
- `storage_setup.sql` — 只建 storage buckets（incident-photos 等）
- `bootstrap_admin.sql` — 建立第一個 admin 帳號（註冊在 app 內關閉）

### 安全 / RLS（見上方「安全鎖定」整組，全部必做）
- `migration_security_phase1_revoke_anon.sql` — 收回 anon 對所有表的權限
- `migration_rls_1_helpers.sql` ~ `migration_rls_6_pm_assignee_access.sql` — RLS 政策 + 分階段開啟 + 指派者存取
- `migration_security_phase2_prevent_escalation.sql` — 擋掉使用者自己把 role 改成 admin
- `migration_security_phase3_function_execute.sql` — 收回 PUBLIC 對 SECURITY DEFINER 函式的執行權限

### Seed（範例 / 初始資料）
- `seed_fault_tree.sql` — 故障代碼樹
- `seed_demo.sql` — 範例工作區 + 機台
- `seed_din_machines.sql` / `seed_sja_olt_machines.sql` — 各廠初始機台
- `seed_demo_incidents.sql` — 範例工單（FIT-DEMO-*，可重跑）

### Migration（後加的 schema 變更，皆 idempotent）
- `migration_pm_assignee.sql` — PM 保養負責人（assigned_user_ids / assigned_to）
- `migration_multi_assignee.sql` — 工單多人指派 + 技師只看自己的案件
- `migration_incident_type_i18n.sql` — 問題類別多語（zh / en / id）
- `migration_nullable_factory.sql` — 允許跨廠帳號 / 工單
- `migration_nullable_machine.sql` — 允許沒有指定機台的工單
- `migration_accepted_at.sql` — incidents 加 accepted_at / accepted_by_id
- `migration_incident_location_note.sql` — 工單自由填寫地點
- `migration_missing_tables.sql` — 補 incident_updates / audit_logs / maintenance_logs

> 註：`migration_*` 的變更大多已併入 `setup_all.sql`，所以**全新環境只跑情境一即可**，
> 不必逐個 migration 再跑一遍。這些單檔保留是給「只想補某一項」的舊資料庫用。

### Fix（修特定問題）
- `fix_incident_types_dedupe.sql` — 修問題類別重複的舊資料

> 「送出失敗」或「refresh 資料不見」：先跑 `SYNC_SCHEMA_LATEST.sql`（欄位缺失最常見），
> 還是不行再回頭檢查「安全鎖定（RLS）」那組的第 3-4 步是否漏跑或漏了某張表。
> **不要**用整組關掉 RLS + 全開權限的方式排除故障——那等於把 P0 資安問題重新打開。
