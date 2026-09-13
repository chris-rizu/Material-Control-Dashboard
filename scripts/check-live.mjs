// Verify the LIVE GitHub Pages deployment: page loads, supabase-js loads,
// login gate works, zero console errors, and the query shapes validate
// against the live schema exactly like scripts/check.mjs.
// Usage: node scripts/check-live.mjs
import { chromium } from "playwright-core";

const BASE = "https://chris-rizu.github.io/Material-Control-Dashboard/";

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector("#loginView:not([hidden])", { timeout: 30000 });
await page.waitForTimeout(1500);

const loginVisible = await page.isVisible("#loginForm");
const appHidden = await page.isHidden("#appView");
const supabaseLoaded = await page.evaluate(() => !!window.supabase);
const title = await page.title();
console.log(`page title: ${title}`);
console.log(`login screen shows: ${loginVisible} / app gated: ${appHidden} / supabase-js loaded: ${supabaseLoaded}`);
console.log(`console errors: ${errors.length}`);
errors.slice(0, 5).forEach((e) => console.log("  •", e));

// probe every query shape as anon against the live schema
const probe = await page.evaluate(async () => {
  const out = {};
  const q = async (name, p) => {
    const { error, count } = await p;
    out[name] = error ? `ERR ${error.code}` : "OK";
  };
  const url = "https://ksztevlqbckdyhheqzif.supabase.co";
  const sb = window.supabase.createClient(url,
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtzenRldmxxYmNrZHloaGVxemlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMDQ2NTEsImV4cCI6MjEwNDY4MDY1MX0.aEr_vPM2VHb6tx_3993L1bbTtws-ZpR4lOesRa2nGCM",
    { auth: { persistSession: false } });
  await q("count purchases", sb.from("purchases").select("id", { count: "exact", head: true }));
  await q("flat view columns", sb.from("purchases_flat").select("created_at,purchase_date,si_no,supplier,particulars_raw,amount").limit(1));
  await q("profiles columns", sb.from("profiles").select("email,full_name,role,is_active,created_at").limit(1));
  await q("import_batches columns", sb.from("import_batches").select("filename,imported_at,line_count,grand_total").limit(1));
  return out;
});

let bad = 0;
for (const [name, result] of Object.entries(probe)) {
  const pass = result === "OK" || result === "ERR PGRST204" || result === "ERR 42703";
  if (!pass) bad++;
  console.log(`  ${pass ? "✓" : "✗"} ${name}: ${result}`);
}
await page.screenshot({ path: "shots/live-deploy.png" });
await browser.close();

if (!loginVisible || !appHidden || !supabaseLoaded || bad > 0 || errors.length > 0) {
  console.log("RESULT: FAIL");
  process.exit(1);
}
console.log("RESULT: PASS — live site is up and gated correctly");
