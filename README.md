# Material Control — Developer Health Dashboard

A private status page for **you** (the developer), separate from the client's
app. Open it any time to confirm the client's Material Control system is
healthy before they use it: database up, ledger intact, client active,
nothing broken.

Plain HTML/CSS/JS — **no build step, no install**. It talks straight to the
same Supabase project as the app.

## Security model

- The Supabase URL + anon key in `app.js` are public by design (the app ships
  the same values) — they alone reveal **nothing**.
- Every data query is protected by **row-level security**: signed out, all
  queries return zero rows and the page shows only a login box.
- Sign in with the same account you use in the app (the owner account).
  The session is remembered by the browser; Sign out clears it.

## Run locally

```
node serve.mjs          # → http://localhost:4173
```

(or any static server — `npx serve`, etc. Opening index.html directly from
disk also works, but a real URL is tidier.)

## Checks it runs

| Check | Meaning |
|---|---|
| Auth service / Database | Supabase is up, with response time |
| Ledger readable | RLS works and your account sees the rows |
| Ledger totals | line count, grand total, newest purchase date |
| Client activity | when the client last encoded something (warns after 21 quiet days) |
| Display migration | whether `migration_002_display.sql` has been applied yet |
| Owner account | someone can still manage users/roles |
| Accounts | role breakdown, deactivated accounts |
| Data scans | zero-price lines, unlinked lines, flagged receipts, duplicate lines, auto-filled amounts |
| Last import | filename, line count, when |

Verdict banner: **green** all good · **amber** operational but pending items ·
**red** issues to fix before the client opens the app. Auto-refreshes every
5 minutes; Refresh re-runs everything now.

## Deploy (put it online)

Any static host works. With the `gh` CLI logged in, GitHub Pages is:

```
git init
git add -A
git commit -m "Dev dashboard"
gh repo create Material-Control-Dashboard --public --source=. --push
gh api repos/chris-rizu/Material-Control-Dashboard/pages -X POST -f "source[branch]=main" -f "source[path]=/"
```

The repo/page being public is fine — the data stays locked behind your login.

## Files

```
index.html      page skeleton (login + dashboard)
styles.css      design tokens — same family as the app (navy, sharp, flat)
app.js          all logic: auth, checks, rendering; CONFIG at the top
serve.mjs       tiny local static server
scripts/check.mjs     headless verification (live schema probe + screenshots)
scripts/check-ui.mjs  headless UI regression checks (DOM assertions)
```

## Verification (no login needed)

```
node serve.mjs            # window 1
node scripts/check.mjs    # window 2 — validates every query shape against
                          # the live schema and screenshots the UI
```
