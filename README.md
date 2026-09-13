# Wed Preps

Shared wedding planning board for shopping, outfits, and family preps. One link, no logins: everyone who opens the site sees the same categories, items, costs, and photos.

## What you can do

- Track expected vs actual spend in PKR. **US buys** are entered in USD and converted to PKR with the US rate. **Pakistan buys** (PAK, Lahore, Khushab, etc.) are entered in PKR only so local prices are not treated as dollars.
- Organize work into default categories (Furniture, Dresses, Accessories, Makeup, Shoes, General Preps, Personal Things, Siblings Preps, Parents Preps) plus custom ones
- Assign items, mark status (Pending / In-Process / Complete), record where things were bought, and attach photos
- Filter the board by **who is doing** the work (Everyone, Unassigned, or a person)
- Use a table on laptops and a card view on phones

## Run locally

```bash
npm install
npm run dev -- --port 43127
```

Open [http://localhost:43127](http://localhost:43127). Local data is saved to `data/store.json` and also in the browser.

## Deploy on Vercel

On Vercel, the board is saved in the browser so refresh keeps your list. To share **one live list across phones**, connect a database to the project.

### Option A (recommended if you already created it): Neon `neon-champagne-flask`

1. Vercel project → **Storage**
2. Open **neon-champagne-flask** (Neon Postgres)
3. **Connect to Project** → choose **wed-preps** → **Production**
4. Confirm **Settings → Environment Variables** includes `POSTGRES_URL` or `DATABASE_URL`
5. **Deployments → ⋯ → Redeploy**

Wed Preps stores the shared family list in that database. Anyone with [https://wed-preps.vercel.app](https://wed-preps.vercel.app) sees the same items.

### Option B: Upstash Redis / Vercel KV

1. **Storage → Create Database → Upstash Redis**
2. Link it so `KV_REST_API_URL` and `KV_REST_API_TOKEN` exist
3. Redeploy

### Browser (recommended)

1. Log in at [vercel.com](https://vercel.com)
2. **Add New Project** → **Import Git Repository**
3. Select `samratryfigures/WedPreps` and click **Deploy**

### Terminal

```bash
npx vercel login
npx vercel --prod
```

Share the production URL (for example `https://wed-preps.vercel.app`) with family. Anyone with the link can view and edit the same board.
