# E2E Checklist — FAMMS V1.0

運行完整的端到端流程,驗證所有主要功能。

## 前置

1. **分支已是最新**
   ```bash
   git fetch && git checkout claude/brave-fermi-vubgj6
   ```

2. **`.env.local`** — 填入你的 Supabase 值:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://smthbomkbaywovzddnhj.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<your anon key>
   SUPABASE_SERVICE_ROLE_KEY=<your service-role key>
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   ```

3. **初始化 DB** — 在 Supabase SQL Editor 依序執行:
   - `supabase/schema.sql`
   - `supabase/seed_fault_tree.sql`
   - `supabase/seed_demo.sql`
   - `supabase/storage_setup.sql`

4. **啟動開發伺服器**
   ```bash
   npm install  # 若 node_modules 不存在
   npm run dev  # http://localhost:3000
   ```

---

## 檢查點

| # | 功能 | 操作 | 預期結果 | 若失敗 |
|---|---|---|---|---|
| 1 | **認證** | 到 `/login` → 註冊新帳號(任意信箱) | 成功建立、可登入 dashboard | 檢查 Supabase auth 有無啟用 |
| 2 | **設定 Profile** | `/profile` → 改 full_name、選 factory(例: DIN)、role(例: technician) | 存檔成功 | 檢查 profiles 表有無資料 |
| 3 | **看機器清單** | `/machines` | 看到 demo 機器(包括 DIN-HMG-001) | 檢查 machines + factories seed 有無跑 |
| 4 | **報修** | `/incidents/new` → 選機器(DIN-HMG-001)、故障樹(MECH → BEARING → BEARING_001)、downtime_impact(B) | incident_no 自動產生、跳到詳情頁 | 檢查 failure_categories / failure_codes 有無資料 |
| 5 | **第一步維修(接受)** | 詳情頁 → 加 action type=inspection、new_status=analyzing | 時間軸顯示此 action、狀態變 analyzing | 檢查 accepted_at 被蓋章(SELECT incidents WHERE id=... \G) |
| 6 | **第二步(臨時修復)** | 再加 action type=temporary_fix、completion_type=temporary_fix、duration=30、photos(可選) | completion_type 記入incident | 檢查 completion_type 值 |
| 7 | **重複故障 × 2** | 同機器 DIN-HMG-001、同故障碼 BEARING_001,報 2 次(可簡化，直接插 2 筆 dummy incident) | 建立 2 個新 incident | 檢查總共有 3 個同碼同機的 incident |
| 8 | **RCA gate** | 第 3 個 incident 詳情 → 按「關閉」 | 紅色 alert「需要填 RCA」擋住 | 檢查 checkRCARequirement() 邏輯 |
| 9 | **填 RCA** | 在 alert 裡填 5 個欄位(root_cause/corrective_action/preventive_action/responsible/due_date) | RCA saved、gate 解除 | 檢查 rca_records 表 |
| 10 | **關閉 incident** | 按「關閉」→ 選 root_cause + completion_type(permanent_fix) | incident status=closed、closed_at 被蓋章 | 檢查 incidents 表 |
| 11 | **Response Time KPI** | `/dashboard` → 看 KPI 卡 | 顯示實際分鐘數(例: 5 min),非假值 | 檢查 accepted_at 有無被用(看 calcResponseTime log) |
| 12 | **健康評分** | dashboard → 按「重算」 | 分數重新計算(DIN-HMG-001 應下降) | 檢查 equipment_health_scores 表 |
| 13 | **知識庫** | `/knowledge-base/new` → 填 problem/root_cause/repair_method | 新增成功、出現在清單 | 檢查 knowledge_base 表 |
| 14 | **PM** | `/pm` → 建 schedule(DIN-HMG-001, daily) → 執行一筆記錄 | schedule 建立、record status=completed | 檢查 pm_schedules / pm_records |
| 15 | **Telegram**(選用,需 TELEGRAM_BOT_TOKEN) | `/settings` → 設定 → 點「測試通知」 | 收到訊息或看「缺群組」提示 | 檢查 .env.local 有無 TOKEN |

---

## 特別檢查

### accepted_at 確實在用
在 SQL 查詢:
```sql
SELECT id, status, reported_at, accepted_at, created_at 
FROM incidents 
WHERE status = 'analyzing' OR status = 'closed'
LIMIT 1;
```

確認 `accepted_at` 不是 NULL 且 > `reported_at`。

### Repeat Failure Detection 無誤
查詢第 3 個 incident:
```sql
SELECT id, incident_no FROM incidents 
WHERE machine_id = (SELECT id FROM machines WHERE code='DIN-HMG-001')
  AND failure_code_id = (SELECT id FROM failure_codes WHERE code='BEARING_001')
ORDER BY created_at DESC
LIMIT 1;
```

取該 id,檢查:
```sql
SELECT * FROM incident_relations 
WHERE incident_id = '<第3個的id>' 
  OR related_incident_id = '<第3個的id>';
```

應該有 `relation_type='repeat_failure'` 的記錄指向前 2 個。

---

## 若出錯

1. **任何步驟失敗** → 記下:
   - 頁面 URL
   - 輸入值
   - 錯誤訊息(網頁 alert / 瀏覽器 console / terminal 日誌)
   
2. **貼給我**(包括上述3項),我直接修。

3. **DB 清空重來**:
   ```sql
   DROP SCHEMA public CASCADE;
   CREATE SCHEMA public;
   -- 再執行一遍 schema.sql 等
   ```

---

## Notes

- 步驟 7 的「報 2 次」可直接在 SQL insert 2 筆,省時間:
  ```sql
  INSERT INTO incidents (factory_id, machine_id, incident_no, failure_code_id, status, reported_at, reported_by_id)
  SELECT id, (SELECT id FROM machines WHERE code='DIN-HMG-001'), 'INC-999-002', 
         (SELECT id FROM failure_codes WHERE code='BEARING_001'),
         'closed', NOW(), (SELECT id FROM profiles LIMIT 1)
  FROM factories WHERE code='DIN';
  -- 再 insert 一次改編號為 003
  ```

- 所有時間戳已存入 DB,無需手動操作時間相關的複雜設定。

- 若要重複檢查,只需清空 incidents + actions + relations + rca_records,其他表保留(factories/machines/failure_* 等)。

---

完成此清單後,整個 FAMMS V1.0 驗收完畢。若所有 15 點都綠,代表系統準備好部署。
