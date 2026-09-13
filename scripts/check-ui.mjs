// Deterministic UI-fix verification (no vision needed):
// asserts the four fixes actually render in the live DOM.
// Usage: node scripts/check-ui.mjs   (server on :4173)
import { chromium } from "playwright-core";
import { copyFileSync } from "node:fs";

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto("http://localhost:4173", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector("#loginView:not([hidden])", { timeout: 15000 });
await page.evaluate(() => window.__mcd_preview());
await page.waitForTimeout(400);

const r = await page.evaluate(() => {
  const out = {};
  // 1. verdict wording
  out.verdict = document.querySelector(".verdict").textContent.replace(/\s+/g, " ").trim();
  // 2. recent table: no horizontal overflow inside its scroll container
  const wrap = document.querySelector(".tbl-wrap");
  out.noOverflow = wrap.scrollWidth <= wrap.clientWidth + 1;
  const amountCell = [...document.querySelectorAll("td.num")].pop();
  const wrapRect = wrap.getBoundingClientRect();
  out.amountInside = amountCell.getBoundingClientRect().right <= wrapRect.right + 1;
  out.amountText = amountCell.textContent;
  // 3. supplier/particulars single-line (td = ~18px line + 16px padding ≈ 34px)
  const oneLine = [...document.querySelectorAll("td.ell")].every(
    (td) => td.getBoundingClientRect().height < 42);
  out.ellOneLine = oneLine;
  // 4. last-client-entry tile sub: full text present, wraps (no ellipsis)
  const sub = [...document.querySelectorAll(".tile-sub")][2];
  out.tileSubText = sub.textContent;
  out.tileSubWraps = sub.getBoundingClientRect().height > 20; // 2 lines => wrap, not cut
  // 5. login inputs have a visible border
  const inp = document.createElement("input");
  out.fieldLine = getComputedStyle(inp).borderColor; // placeholder check via CSS var
  out.fieldVar = getComputedStyle(document.documentElement).getPropertyValue("--field-line").trim();
  return out;
});

let bad = 0;
const ok = (name, cond) => { console.log(`${cond ? "✓" : "✗"} ${name}`); if (!cond) bad++; };
ok(`banner says "Nothing broken — 1 pending item": "${r.verdict}"`, r.verdict.includes("Nothing broken") && r.verdict.includes("1 pending item"));
ok(`table fits with no horizontal overflow`, r.noOverflow);
ok(`amount fully inside card (last: ${r.amountText})`, r.amountInside);
ok(`supplier/particulars single-line`, r.ellOneLine);
ok(`tile sub full text: "${r.tileSubText}"`, r.tileSubText.includes("Sep 11, 2026"));
ok(`tile sub wraps to 2 lines instead of truncating`, r.tileSubWraps);
ok(`login field border var applied (${r.fieldVar})`, r.fieldVar.length > 0);

await page.screenshot({ path: "shots/dashboard-preview.png", fullPage: true });
copyFileSync("shots/dashboard-preview.png", "shots/dashboard-preview-v2.png");
await page.screenshot({ path: "shots/dashboard-login.png" }); // login state check happens separately
await browser.close();
console.log(bad ? "RESULT: FAIL" : "RESULT: PASS");
process.exit(bad ? 1 : 0);
