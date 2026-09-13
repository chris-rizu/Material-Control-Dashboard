// Login-flow diagnostic for the LIVE site. Uses a deliberately WRONG
// password: the expected outcome is the red error box saying invalid
// credentials — which proves the whole flow (form -> supabase -> error UI).
// Usage: node scripts/diag-login.mjs [email] ["password"]
import { chromium } from "playwright-core";

const BASE = process.argv[2] || "https://chris-rizu.github.io/Material-Control-Dashboard/";
const EMAIL = process.argv[3] || "diag@example.com";
const PASS = process.argv[4] || "definitely-not-the-password";

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));

const calls = [];
page.on("response", (r) => {
  if (r.url().includes("supabase")) calls.push(`${r.status()} ${r.request().method()} ${r.url().replace("https://ksztevlqbckdyhheqzif.supabase.co", "")}`);
});

console.log(`target: ${BASE}`);
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector("#loginForm", { timeout: 30000 });
await page.waitForTimeout(1000);

await page.fill("#email", EMAIL);
await page.fill("#password", PASS);
await page.click("#loginBtn");

// watch what happens for up to 15 s
let btnText = "", errText = "", errShown = false, appShown = false;
for (let i = 0; i < 15; i++) {
  await page.waitForTimeout(1000);
  btnText = await page.textContent("#loginBtn");
  errShown = await page.isVisible("#loginErr");
  errText = errShown ? await page.textContent("#loginErr") : "";
  appShown = await page.isVisible("#appView");
  console.log(`t+${i + 1}s  btn="${btnText.trim()}"  errShown=${errShown}${errText ? ` err="${errText.trim()}"` : ""}  appView=${appShown}`);
  if (errShown || appShown) break;
}

console.log("\nsupabase network calls:");
calls.forEach((c) => console.log("  " + c));
if (!calls.length) console.log("  (none — request never left the page!)");
console.log(`console errors: ${errors.length}`);
errors.slice(0, 8).forEach((e) => console.log("  •", e));

// storage sanity: does this origin allow localStorage?
const ls = await page.evaluate(() => {
  try { localStorage.setItem("__probe", "1"); localStorage.removeItem("__probe"); return "localStorage OK"; }
  catch (e) { return "localStorage BLOCKED: " + e.message; }
});
console.log(ls);

await browser.close();
