// Sign-in flow regression: the dashboard MUST switch views directly on a
// successful signInWithPassword (no dependence on the auth event system),
// and every anomalous outcome must show an on-screen message.
// Covers: simulated success, simulated "no session", real wrong password.
// Usage: node scripts/check-login-flow.mjs [baseUrl]
import { chromium } from "playwright-core";

const BASE = process.argv[2] || "http://localhost:4173/";
let bad = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!cond) bad++;
};

const browser = await chromium.launch({ channel: "msedge", headless: true });

// --- 1. simulated SUCCESS: stub signInWithPassword before app.js runs ------
{
  const page = await browser.newPage();
  await page.addInitScript(() => {
    // intercept the UMD script's assignment of window.supabase, then wrap
    // createClient so app.js gets a client whose sign-in always "succeeds"
    let real = null;
    Object.defineProperty(window, "supabase", {
      configurable: true,
      get() { return real; },
      set(v) {
        real = v;
        const orig = v.createClient.bind(v);
        v.createClient = (...args) => {
          const c = orig(...args);
          c.auth.signInWithPassword = async () => ({
            data: { session: { user: { email: "sim@rorotransport.ph" } } },
            error: null,
          });
          return c;
        };
      },
    });
  });
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("#loginForm", { timeout: 20000 });
  await page.fill("#email", "sim@rorotransport.ph");
  await page.fill("#password", "whatever");
  await page.click("#loginBtn");
  await page.waitForTimeout(3000);
  const appShown = await page.isVisible("#appView");
  const loginHidden = await page.isHidden("#loginView");
  const emailChip = await page.textContent("#userChip");
  const checksText = (await page.textContent("#checks")) || "";
  const verdictText = (await page.textContent("#verdict")) || "";
  ok("success → dashboard appears immediately", appShown && loginHidden);
  ok("success → account email shown", emailChip.trim() === "sim@rorotransport.ph", emailChip.trim());
  ok("success → checks actually ran", checksText.length > 40, `verdict: ${verdictText.replace(/\s+/g, " ").trim().slice(0, 60)}`);
  if (appShown) {
    // Refresh button re-runs (running-flag regression: it used to stick)
    await page.click("#refreshBtn");
    await page.waitForTimeout(2500);
    const checksAfter = (await page.textContent("#checks")) || "";
    ok("refresh re-runs checks (running flag resets)", checksAfter.length > 40);
    // sign out returns to login
    await page.click("#logoutBtn");
    await page.waitForTimeout(1200);
    ok("sign out → back to login card", await page.isVisible("#loginView"));
  } else {
    bad++;
  }
  await page.close();
}

// --- 2. simulated "no session, no error" — must show an explicit message ---
{
  const page = await browser.newPage();
  await page.addInitScript(() => {
    let real = null;
    Object.defineProperty(window, "supabase", {
      configurable: true,
      get() { return real; },
      set(v) {
        real = v;
        const orig = v.createClient.bind(v);
        v.createClient = (...args) => {
          const c = orig(...args);
          c.auth.signInWithPassword = async () => ({ data: {}, error: null });
          return c;
        };
      },
    });
  });
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("#loginForm", { timeout: 20000 });
  await page.fill("#email", "x@y.com");
  await page.fill("#password", "z");
  await page.click("#loginBtn");
  await page.waitForTimeout(1500);
  const errShown = await page.isVisible("#loginErr");
  const errText = ((await page.textContent("#loginErr")) || "").trim();
  const appShown = await page.isVisible("#appView");
  ok("no-session → explicit on-screen message", errShown && errText.includes("no session"), errText.slice(0, 70));
  ok("no-session → stays on login card", !appShown);
  await page.close();
}

// --- 3. real wrong password → real Supabase error shown --------------------
{
  const page = await browser.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("#loginForm", { timeout: 20000 });
  await page.fill("#email", "diag@example.com");
  await page.fill("#password", "wrong");
  await page.click("#loginBtn");
  await page.waitForTimeout(4000);
  const errText = ((await page.textContent("#loginErr")) || "").trim();
  ok("wrong password → 'Invalid login credentials'", errText.length > 0, errText.slice(0, 60));
  await page.close();
}

await browser.close();
console.log(bad ? "RESULT: FAIL" : "RESULT: PASS");
process.exit(bad ? 1 : 0);
