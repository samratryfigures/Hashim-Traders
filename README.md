# Wed Preps

Shared wedding planning board for shopping, outfits, and family preps. One link, no logins: everyone who opens the site sees the same categories, items, costs, and photos.

## What you can do

- Track expected vs actual spend in PKR (USD converts with a static rate, default **1 USD = 278 PKR**)
- Organize work into default categories (Furniture, Dresses, Accessories, Makeup, Shoes, General Preps, Personal Things, Siblings Preps, Parents Preps) plus custom ones
- Assign items, mark status (Pending / In-Process / Complete), record where things were bought, and attach photos
- Use a table on laptops and a card view on phones

## Run locally

```bash
npm install
npm run dev -- --port 43127
```

Open [http://localhost:43127](http://localhost:43127). Local data is saved to `data/store.json`.

## Deploy on Vercel (so the family shares one live list)

Without KV, a Vercel deploy cannot keep a single shared list (serverless storage is temporary). Connect Vercel KV / Upstash Redis:

1. In Vercel: **Storage → Create Database → KV / Upstash Redis**
2. Link it to this project so these env vars exist:
   - `KV_REST_API_URL` (or `UPSTASH_REDIS_REST_URL`)
   - `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_TOKEN`)
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
