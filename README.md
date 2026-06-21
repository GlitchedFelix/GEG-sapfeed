# GEG SAP Reports

Good Earth Group portal for uploading and searching SAP feed reports from CTM / Italtile: drag-and-drop import, search/filter, and a stats panel.

## What this is built around

- **SAP exports are MHTML, not real Excel.** The `.XLS` files SAP produces are actually multipart MIME (HTML table wrapped in email-style headers). `lib/sap-parser.ts` extracts and decodes that before parsing the table — this has been tested against real CTM and Italtile sample files end to end.
- **Dedupe key is a hash of the full row, not any single SAP field.** The 14-digit "Delivery" number was initially assumed unique but confirmed NOT to be — see the unique index on `row_hash` in `supabase/schema.sql`. Don't re-key off `delivery_number` alone without re-confirming uniqueness first.
- **Single uploader role, all authenticated users can view everything.** No per-store row security. Enforced both in the UI (import page/nav hidden) and server-side (API route + RLS policy) — the server-side check is the one that actually matters.
- **CTM and ITALTILE have slightly different column layouts.** CTM has an extra duplicated `Country` column; ITALTILE's weight fields come as formatted strings (`"1,064.500 KG"`) instead of plain numbers. The parser handles both by column name lookup, not fixed positions, so a future reordering fails loudly (throws) instead of silently misaligning data.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create your Supabase project

1. Go to [supabase.com](https://supabase.com) → New Project.
2. Once provisioned, go to **Project Settings → API** and copy the **Project URL** and **anon public** key.
3. Copy `.env.local.example` to `.env.local` and fill in those two values.

### 3. Run the schema

1. In the Supabase dashboard, go to **SQL Editor → New query**.
2. Paste the entire contents of `supabase/schema.sql` and run it.

### 4. Create your account and grant upload access

1. Run the app (`npm run dev`), go to `http://localhost:3000`, and sign up with your email/password.
2. Back in Supabase **SQL Editor**, run:
   ```sql
   update profiles set is_uploader = true where email = 'you@example.com';
   ```
   (Replace with the email you signed up with.)
3. Sign out and back in — you should now see an "Import" tab in the nav.

### 5. Run locally

```bash
npm run dev
```

Visit `http://localhost:3000`.

## Known limitations (not yet built, flagged on purpose)

- **Stats panel sums rows client-side** after fetching them — fine at current scale (50-100 rows/day), but will need a Postgres aggregate function (RPC) once you're a few years into accumulated data and the per-query row fetch gets large.
- **Role enforcement is a single boolean flag** (`is_uploader`), not granular RBAC. Fine for "one person uploads, everyone else views" — would need revisiting if upload responsibilities ever split by brand or store.
- **No edit/delete UI** for imported rows. If a bad import needs correcting, that's currently a direct SQL fix in Supabase, not an in-app action.
- **No retry/conflict log** for skipped duplicates beyond the count shown after each import — if you need to audit exactly *which* rows were skipped and why, that's not persisted anywhere right now.
