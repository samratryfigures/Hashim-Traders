# HASHMI TRADERS — Business Manager

Vanilla HTML/CSS/JS shop system for HASHMI TRADERS (Pakistan, Rs, en-PK). Data lives in the browser as a fast cache and is synced to a Google Sheet owned by **tradershashmi053@gmail.com**.

Stock and party balances are **never stored**. They are computed from opening stock, invoices, purchases, returns, and payments so edit/delete stays safe.

## What you get

- Multi-item **invoices** (`INV-0001`) and **purchases** (`PUR-0001`)
- Cash / Bank / Credit (udhaar) / Advance, plus standalone Receive / Make Payment
- Sales and purchase **returns** (credit notes)
- Customer and supplier **khata** (ledgers) with print statement
- Dashboard and Reports time filter (Today → Custom) with Chart.js
- Edit / Delete everywhere, archive instead of hard-delete when a record has history
- Optional login password, live sync, Export / Import Backup JSON
- Print A4 invoice or 80mm receipt

## Run locally

```bash
cp .env.example .env.local
# Leave APP_PASSWORD empty for an open shop. Set it only if you want a login screen.
node dev-server.js
```

Open [http://127.0.0.1:43127](http://127.0.0.1:43127). Without `APPS_SCRIPT_URL`, the API stores the database in `data/cloud.json` (gitignored).

With Vercel CLI:

```bash
npx vercel login
npx vercel env pull .env.local
npx vercel dev --listen 43127
```

```bash
npm test
```

## 1. Export your old books first

The new website is a **different domain**. Old `localStorage` key `hashmi_traders_v1` will **not** appear automatically.

1. Open the **old** HASHMI TRADERS `index.html` on the computer that already has the data.
2. Open **Reports**.
3. Click **Export Backup JSON**.
4. Keep that file (for example on Google Drive).
5. After the new site is live and you can log in: **Reports → Import Backup JSON** and choose that file.  
   Import accepts both the old format and the new invoice format. Each old sale becomes a one-item invoice. Product stock after import matches the old stock numbers.

## 2. Google Sheet + Apps Script (account tradershashmi053@gmail.com)

Do this while logged in as **tradershashmi053@gmail.com**.

1. Open [https://sheets.google.com](https://sheets.google.com).
2. Click **Blank spreadsheet**.
3. Click the title and name it **HASHMI TRADERS Data**.
4. Menu **Extensions → Apps Script**.
5. Delete any placeholder code in `Code.gs`.
6. Open this repo file `apps-script/Code.gs`, select all, copy, paste into the Apps Script editor.
7. Click the disk **Save** icon. Project name can be `HASHMI TRADERS Script`.
8. Left sidebar **Project Settings** (gear).
9. Scroll to **Script Properties → Add script property**.
   - Property: `SECRET`
   - Value: a long random string (password manager). This is the **same** value you will put in Vercel as `APPS_SCRIPT_TOKEN`. Never put it in the website JavaScript.
10. Click **Save script properties**.
11. Open the **Editor** (code) again. In the function dropdown at the top, choose **`setup`**.
12. Click **Run**.
13. **Review permissions → Advanced → Go to HASHMI TRADERS Script (unsafe) → Allow**. Approve Sheets and Drive access (needed for the daily backup folder).
14. Confirm `setup` finishes without errors (Executions log). This creates the tabs (Products, Customers, Invoices, `_JSON`, …) and a **daily 02:00** backup trigger.
15. Top right **Deploy → New deployment**.
16. Click the gear next to **Select type → Web app**.
17. Description: `HASHMI TRADERS API`.
18. **Execute as:** Me (tradershashmi053@gmail.com).
19. **Who has access:** Anyone.
20. Click **Deploy**.
21. Copy the **Web app URL** that ends with `/exec`. This is `APPS_SCRIPT_URL`.

If you later change `Code.gs`, use **Deploy → Manage deployments → Edit (pencil) → New version → Deploy**.

Daily backups: Drive folder **HASHMI TRADERS Backups**, one copy per day, last **30** kept.

## 3. GitHub + Vercel

Repo: [https://github.com/samratryfigures/Hashim-Traders](https://github.com/samratryfigures/Hashim-Traders)

This project is static files plus `/api` Node functions. **No build command.** Login is **off** unless you set `APP_PASSWORD`.

### Vercel (browser)

1. Log in at [https://vercel.com](https://vercel.com) with the GitHub account `samratryfigures`.
2. **Add New → Project → Import** `Hashim-Traders`.
3. **Framework Preset:** Other.
4. **Build Command:** leave empty. **Output Directory:** leave empty / `.`
5. **Root Directory:** `.`
6. **Environment Variables** (optional until the Google Sheet is connected):

| Name | Value |
| --- | --- |
| `APP_PASSWORD` | Leave empty for no login |
| `SESSION_SECRET` | Only needed if you later add a password |
| `APPS_SCRIPT_URL` | The `/exec` URL from step 2 |
| `APPS_SCRIPT_TOKEN` | **Exactly** the Script Property `SECRET` |

7. Click **Deploy**.
8. Open the production URL — the shop opens with no password.
9. Every later `git push` to `main` auto-deploys.

### Vercel CLI alternative

```bash
npx vercel login
npx vercel link
npx vercel env add APPS_SCRIPT_URL
npx vercel env add APPS_SCRIPT_TOKEN
npx vercel --prod
```

## 4. Change the password / restore a backup

**Change the login password**

1. Vercel → Project → **Settings → Environment Variables**.
2. Edit `APP_PASSWORD` to the new password.
3. **Deployments → ⋯ on the latest → Redeploy** (env changes apply on a new deployment).
4. All devices must log in again.

**Restore from a Drive backup copy**

1. Google Drive → folder **HASHMI TRADERS Backups**.
2. Open the dated copy (a full spreadsheet).
3. Copy the `_JSON` tab cells (all chunk rows) into the live **HASHMI TRADERS Data** file’s `_JSON` tab, **or** File → Make a copy and point Apps Script at that file (re-deploy if it is a new spreadsheet).
4. In the live app click **Sync now** or **Reload cloud** if you see a conflict. Clearing the browser cache is not required; use the conflict dialog **Reload cloud**.

**Restore from JSON**

1. Reports → **Import Backup JSON**.
2. Wait for **Saved ✓** so the Sheet updates.
3. If another phone shows old data, refresh it (or Reload cloud).

## Keyboard

- `N` new invoice / purchase / product (when not typing)
- `Ctrl+S` save the open modal
- `Esc` close modal

## Architecture

Browser → `/api/data` (Vercel, cookie auth) → Google Apps Script `/exec` → Sheet tabs + `_JSON` (source of truth, chunks under 50,000 characters). `localStorage` key `hashmi_traders_v2` is the cache. Payload warning at ~3 MB (Vercel body limit 4.5 MB).
