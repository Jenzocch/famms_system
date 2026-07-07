# FAMMS × Gudang One 叫料串接設定

工單需要零件/物料時，在 FAMMS 事件詳情頁按「向倉庫叫料」→ 自動在
Gudang One 的 Permintaan 分頁建立一筆申請（pending）→ 倉管收到 Telegram 通知。

```
FAMMS incident 頁「📦 向倉庫叫料」
  → POST /api/gudang/request（FAMMS 伺服器端，瀏覽器看不到密鑰）
  → POST https://<gudang-project>.supabase.co/functions/v1/famms-request（驗 x-famms-secret）
  → 寫入 gudang 的 requests 表 + Telegram 通知
```

## 一次性設定

### 1. 產生共享密鑰（隨便一台電腦）
```bash
openssl rand -hex 32
```

### 2. Gudang One 端（gudang-app 專案）
```bash
supabase secrets set FAMMS_WEBHOOK_SECRET="<上面那串>"
supabase functions deploy famms-request
```
（Edge Function 原始碼在 gudang-app repo 的 `supabase/functions/famms-request/`）

### 3. FAMMS 端（本專案，Vercel 環境變數）
| 變數 | 值 |
|---|---|
| `GUDANG_WEBHOOK_URL` | `https://klswfuzuhlowzrbncreu.supabase.co/functions/v1/famms-request` |
| `GUDANG_WEBHOOK_SECRET` | 同一串密鑰 |

設定後 redeploy FAMMS。

## 廠區 → 倉庫對照（寫在 `src/app/api/gudang/request/route.ts`）
| FAMMS factory code | Gudang warehouse |
|---|---|
| DIN | DENIKIN |
| SJA | SJA |
| OLT | OLENTIA |

## 測試
1. FAMMS 開任一未關閉的 incident → 底部「📦 向倉庫叫料」
2. 填零件名＋數量 → 送出
3. Gudang One → Permintaan 分頁應出現該筆（含 WO 編號、機台、急迫度）；
   Telegram 群同時收到通知

## 安全說明
- 密鑰只存在 Vercel env 與 Supabase secrets，不進版控、不到瀏覽器
- Gudang 端驗證用常數時間比較；欄位白名單＋長度上限
- 未帶密鑰或帶錯 → 401；FAMMS 端未登入的人打 `/api/gudang/request` → 401
