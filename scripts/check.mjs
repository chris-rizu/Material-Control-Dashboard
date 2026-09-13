// Verification for the dev dashboard (no login needed):
//   1. page loads with zero console errors, login screen shows
//   2. every query shape used by app.js is valid against the LIVE schema
//      (RLS returns empty rows for anon — but a wrong table/column name
//      returns a PostgREST error, which is exactly what we're checking)
//   3. screenshots: login screen + sample-data preview of the dashboard
// Usage: node scripts/check.mjs   (server must be running on :4173)
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const BASE = "http://localhost:4173";
mkdirSync("shots", { recursive: true });

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector("#loginView:not([hidden])", { timeout: 15000 });
await page.waitForTimeout(800);

const loginVisible = await page.isVisible("#loginForm");
const appHidden = await page.isHidden("#appView");
console.log(`login screen shows: ${loginVisible} / app gated: ${appHidden}`);

// --- console errors from plain page load (before any probe fetches) --------
const loadErrors = errors.splice(0, errors.length);
console.log(`console errors on load: ${loadErrors.length}`);
loadErrors.slice(0, 5).forEach((e) => console.log("  •", e));

// --- validate every query shape against the live schema (as anon) ----------
const probe = await page.evaluate(async () => {
  const CONFIG = {
    url: "https://ksztevlqbckdyhheqzif.supabase.co",
    key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtzenRldmxxYmNrZHloaGVxemlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMDQ2NTEsImV4cCI6MjEwNDY4MDY1MX0.aEr_vPM2VHb6tx_3993L1bbTtws-ZpR4lOesRa2nGCM",
  };
  const sb = window.supabase.createClient(CONFIG.url, CONFIG.key, { auth: { persistSession: false } });
  const out = {};
  const q = async (name, p) => {
    const { error, count } = await p;
    out[name] = error ? `ERR ${error.code}: ${error.message}` : (count != null ? `OK (count=${count})` : "OK");
  };
  await q("count purchases", sb.from("purchases").select("id", { count: "exact", head: true }));
  await q("ledger columns", sb.from("purchases").select(
    "id,purchase_date,si_no,particulars_raw,unit_price,quantity,amount,amount_source,material_id,supplier_id,receipt_quality,created_at").limit(1));
  await q("flat view columns", sb.from("purchases_flat").select(
    "created_at,purchase_date,si_no,supplier,particulars_raw,amount").limit(1));
  await q("migration_002 probe (material_brand)", sb.from("purchases_flat").select("id,material_brand").limit(1));
  await q("profiles columns", sb.from("profiles").select("email,full_name,role,is_active,created_at").limit(1));
  await q("import_batches columns", sb.from("import_batches").select("filename,imported_at,line_count,grand_total").limit(1));
  await q("count aliases", sb.from("material_aliases").select("id", { count: "exact", head: true }));
  await q("count materials", sb.from("materials").select("id", { count: "exact", head: true }));
  await q("count suppliers", sb.from("suppliers").select("id", { count: "exact", head: true }));
  return out;
});

let bad = 0;
for (const [name, result] of Object.entries(probe)) {
  const isMigrationProbe = name.startsWith("migration_002");
  // the migration probe is EXPECTED to fail while migration_002 isn't applied
  // (42703 = postgres "column does not exist" through the view; PGRST204 =
  // PostgREST schema cache variant of the same thing)
  const expectedFailure = isMigrationProbe && (result.includes("PGRST204") || result.includes("42703"));
  if (result.startsWith("ERR") && !expectedFailure) bad++;
  console.log(`  ${result.startsWith("ERR") ? (expectedFailure ? "✓" : "✗") : "✓"} ${name}: ${result}`);
}
console.log(`migration state: ${probe["migration_002 probe (material_brand)"].startsWith("ERR") ? "002 NOT applied (expected until user runs it)" : "002 applied"}`);

// --- screenshots: login, then sample preview --------------------------------
await page.screenshot({ path: "shots/dashboard-login.png" });

await page.evaluate(() => window.__mcd_preview());
await page.waitForTimeout(400);
await page.screenshot({ path: "shots/dashboard-preview.png", fullPage: true });
console.log("screenshots: shots/dashboard-login.png, shots/dashboard-preview.png");

await browser.close();
if (!loginVisible || !appHidden || bad > 0 || loadErrors.length > 0) {
  console.log("RESULT: FAIL");
  process.exit(1);
}
console.log("RESULT: PASS");
