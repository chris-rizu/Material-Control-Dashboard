/* ==========================================================================
   Material Control — Developer Health Dashboard (static, no build step)
   Talks directly to Supabase with the public anon key. EVERYTHING sensitive
   is protected by row-level security: without signing in with a real account
   every query returns zero rows, and the UI shows only the login box.
   ========================================================================== */

const CONFIG = {
  SUPABASE_URL: "https://ksztevlqbckdyhheqzif.supabase.co",
  SUPABASE_ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtzenRldmxxYmNrZHloaGVxemlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMDQ2NTEsImV4cCI6MjEwNDY4MDY1MX0.aEr_vPM2VHb6tx_3993L1bbTtws-ZpR4lOesRa2nGCM",
  PROJECT_REF: "ksztevlqbckdyhheqzif",
  AUTO_REFRESH_MS: 5 * 60 * 1000,
  ACTIVITY_WARN_DAYS: 21,
};

/* ---------- guards & helpers -------------------------------------------- */

if (!window.supabase) {
  document.body.innerHTML =
    '<div class="login-wrap"><div class="login-card"><h1>No internet</h1>' +
    '<p class="sub">This dashboard needs an internet connection to reach Supabase.</p></div></div>';
  throw new Error("supabase-js failed to load (offline?)");
}

const sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, storageKey: "mcd-auth" },
});

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const peso = (n) =>
  "₱" + Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (d) => {
  if (!d) return "—";
  const dt = new Date(String(d).length === 10 ? d + "T00:00:00" : d);
  return isNaN(dt) ? "—" : dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

const rel = (iso) => {
  if (!iso) return "never";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!(s >= 0)) return "—";
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  if (d < 31) return `${d}d ago`;
  return fmtDate(iso);
};

/* ---------- theme (remembered per browser) ------------------------------ */

const THEME_KEY = "mcd-theme";
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(THEME_KEY, t); } catch {}
  const sun = '<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M19.4 4.6l-1.8 1.8M6.4 17.6l-1.8 1.8"/>';
  const moon = '<path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"/>';
  $("themeIcon").innerHTML = t === "light" ? moon : sun;
  $("themeBtn").title = t === "light" ? "Switch to dark mode" : "Switch to light mode";
}
(function initTheme() {
  let t = null;
  try { t = localStorage.getItem(THEME_KEY); } catch {}
  applyTheme(t === "light" ? "light" : "dark");
})();
$("themeBtn").addEventListener("click", () =>
  applyTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light"));

/* ---------- state -------------------------------------------------------- */

let signedIn = false;
let currentEmail = "";
let autoTimer = null;
let running = false;

// Single source of truth for entering/leaving the dashboard. Called both
// directly from the sign-in handler (no event-system dependency — a lost
// auth event must never leave the user stuck on the login card) and from
// onAuthStateChange for restored sessions / token refresh / sign-out.
function enterDashboard(email) {
  if (signedIn) return;
  signedIn = true;
  currentEmail = email || "";
  $("loginView").hidden = true;
  $("appView").hidden = false;
  $("userChip").textContent = currentEmail;
  $("userChip").title = currentEmail;
  if (!autoTimer) autoTimer = setInterval(() => runAll(), CONFIG.AUTO_REFRESH_MS);
  runAll();
}
function leaveDashboard() {
  signedIn = false;
  currentEmail = "";
  $("loginView").hidden = false;
  $("appView").hidden = true;
  if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
}

const CHECKS = []; // {status: ok|info|warn|fail, label, detail}
const add = (status, label, detail) => CHECKS.push({ status, label, detail });

/* ---------- auth UI ------------------------------------------------------ */

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("loginBtn"), err = $("loginErr");
  err.hidden = true;
  btn.disabled = true; btn.textContent = "Signing in…";
  // if Supabase never answers (ad-blocker / extension / network dropping
  // the request) the button would spin forever — surface that instead
  const slowTimer = setTimeout(() => {
    err.textContent =
      "Supabase is not answering. If the button stays like this for another " +
      "few seconds, an ad-blocker, extension, or your network is blocking " +
      "the request — try another browser or turn off blockers for this page.";
    err.hidden = false;
  }, 15000);
  const { data, error } = await sb.auth.signInWithPassword({
    email: $("email").value.trim(),
    password: $("password").value,
  });
  clearTimeout(slowTimer);
  btn.disabled = false; btn.textContent = "Sign in";
  if (error) { err.textContent = error.message; err.hidden = false; return; }
  if (!data?.session) {
    err.textContent =
      "Supabase accepted the sign-in but returned no session — this usually " +
      "means the email hasn't been confirmed yet. Check your inbox for the " +
      "confirmation email, or resend it from the Supabase dashboard " +
      "(Authentication → Users).";
    err.hidden = false;
    return;
  }
  // success — switch immediately, don't wait for the auth event
  enterDashboard(data.session.user?.email ?? "");
});

$("forgotBtn").addEventListener("click", async () => {
  const note = $("resetNote");
  const email = $("email").value.trim();
  note.hidden = true;
  if (!email) {
    note.textContent = "Type your email above first, then click Forgot password.";
    note.hidden = false;
    return;
  }
  const btn = $("forgotBtn");
  btn.disabled = true;
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: location.origin + location.pathname,
  });
  btn.disabled = false;
  note.textContent = error
    ? error.message
    : "Reset email sent — check your inbox (and spam). Opening the link from this browser lands you back here to set a new password.";
  note.hidden = false;
});

$("logoutBtn").addEventListener("click", () => sb.auth.signOut());
$("refreshBtn").addEventListener("click", () => runAll());

sb.auth.onAuthStateChange((_event, session) => {
  session ? enterDashboard(session.user?.email ?? "") : leaveDashboard();
});

/* ---------- data helpers ------------------------------------------------- */

async function countRows(table) {
  const { count, error } = await sb.from(table).select("id", { count: "exact", head: true });
  if (error) throw new Error(`${table}: ${error.message}`);
  return count;
}

async function fetchLedger() {
  const rows = [];
  for (let from = 0; from < 10000; from += 2000) {
    const { data, error } = await sb.from("purchases")
      .select("id,purchase_date,si_no,particulars_raw,unit_price,quantity,amount,amount_source," +
              "material_id,supplier_id,receipt_quality,created_at")
      .order("id")
      .range(from, from + 1999);
    if (error) throw new Error("purchases: " + error.message);
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < 2000) break;
  }
  return rows;
}

async function fetchMaterialDegrees() {
  const map = new Map(); // material_id → degrees (0 = not an angled item)
  for (let from = 0; from < 10000; from += 2000) {
    const { data, error } = await sb.from("materials")
      .select("id,degrees").order("id").range(from, from + 1999);
    if (error) throw new Error("materials: " + error.message);
    for (const m of data ?? []) map.set(m.id, Number(m.degrees || 0));
    if ((data?.length ?? 0) < 2000) break;
  }
  return map;
}

function analyzeLedger(rows) {
  const now = new Date(), yk = now.getFullYear(), mk = now.getMonth();
  let grand = 0, monthSum = 0, monthCount = 0, latestDate = null, lastCreated = null;
  let zeroPrice = 0, noMaterial = 0, noSupplier = 0, flagged = 0, filled = 0;
  const dupMap = new Map();
  for (const r of rows) {
    grand += Number(r.amount || 0);
    const d = new Date(r.purchase_date + "T00:00:00");
    if (!isNaN(d) && d.getFullYear() === yk && d.getMonth() === mk) {
      monthSum += Number(r.amount || 0); monthCount++;
    }
    if (!latestDate || r.purchase_date > latestDate) latestDate = r.purchase_date;
    if (r.created_at && (!lastCreated || r.created_at > lastCreated)) lastCreated = r.created_at;
    if (Number(r.unit_price) === 0) zeroPrice++;
    if (r.material_id == null) noMaterial++;
    if (r.supplier_id == null) noSupplier++;
    if (r.receipt_quality && r.receipt_quality !== "ok") flagged++;
    if (r.amount_source === "import_missing_filled") filled++;
    const key = [r.purchase_date, r.si_no, r.particulars_raw, r.unit_price, r.quantity].join("|");
    dupMap.set(key, (dupMap.get(key) || 0) + 1);
  }
  const dupPairs = [...dupMap.values()].filter((n) => n > 1);
  return { grand, monthSum, monthCount, latestDate, lastCreated,
           zeroPrice, noMaterial, noSupplier, flagged, filled,
           dupPairs: dupPairs.length,
           dupExtra: dupPairs.reduce((a, n) => a + n - 1, 0) };
}

// Angled lines (ELBOW/BEND with "3X90"-style sizes in the receipt text) must
// link to a catalog material carrying the SAME degrees — search_name omits
// degrees, so text matching alone can confuse 45° and 90° twins.
function analyzeAngles(rows, degById) {
  const ANGLE = /X\s*(22\.5|45|90)/;
  let total = 0, bad = 0;
  const examples = [];
  for (const r of rows) {
    const raw = String(r.particulars_raw || "").toUpperCase().match(ANGLE);
    const rawDeg = raw ? Number(raw[1]) : 0;
    const matDeg = r.material_id == null ? null : degById.get(r.material_id);
    if (rawDeg === 0 && (matDeg ?? 0) === 0) continue;
    total++;
    if (rawDeg > 0 && matDeg !== rawDeg) {
      bad++;
      if (examples.length < 3)
        examples.push(`#${r.id} "${String(r.particulars_raw || "").trim()}" → ` +
          (matDeg == null ? "unlinked" : `${matDeg}°`));
    }
  }
  return { total, bad, examples };
}

/* ---------- checks -------------------------------------------------------- */

async function checkConnectivity() {
  try {
    const t0 = performance.now();
    const r = await fetch(`${CONFIG.SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: CONFIG.SUPABASE_ANON_KEY },
    });
    const ms = Math.round(performance.now() - t0);
    r.ok ? add("ok", "Auth service", `up · ${ms} ms`)
         : add("fail", "Auth service", `HTTP ${r.status} — logins will fail`);
  } catch (e) {
    add("fail", "Auth service", String(e));
  }
  try {
    const t0 = performance.now();
    const { error } = await sb.from("categories").select("id", { count: "exact", head: true });
    const ms = Math.round(performance.now() - t0);
    error ? add("fail", "Database (REST)", error.message)
          : add("ok", "Database (REST)", `reachable · ${ms} ms`);
  } catch (e) {
    add("fail", "Database (REST)", String(e));
  }
}

async function runAll() {
  if (!signedIn || running) return;
  running = true;
  $("refreshBtn").disabled = true;
  CHECKS.length = 0;
  renderChecks();
  renderVerdict("checking");

  try {
    await checkConnectivity();

    const [pCount, mCount, sCount, aCount, cCount, ledger, profRes, migRes, impRes, recentRes, degById] =
      await Promise.all([
        countRows("purchases").catch((e) => { add("fail", "Ledger readable", e.message); return null; }),
        countRows("materials").catch(() => null),
        countRows("suppliers").catch(() => null),
        countRows("material_aliases").catch(() => null),
        countRows("categories").catch(() => null),
        fetchLedger().catch((e) => { add("fail", "Ledger readable", e.message); return null; }),
        sb.from("profiles").select("email,full_name,role,is_active,created_at").order("created_at"),
        sb.from("purchases_flat").select("id,material_brand").limit(1),
        sb.from("import_batches")
          .select("filename,imported_at,line_count,grand_total")
          .order("imported_at", { ascending: false }).limit(3),
        sb.from("purchases_flat")
          .select("created_at,purchase_date,si_no,supplier,particulars_raw,amount")
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(8),
        fetchMaterialDegrees().catch(() => null),
      ]);

    /* ledger + totals */
    let stats = null;
    if (ledger) {
      stats = analyzeLedger(ledger);
      add("ok", "Ledger readable (RLS working)",
          `${ledger.length.toLocaleString()} line${ledger.length === 1 ? "" : "s"} visible for your account`);
    }
    if (stats && pCount != null) {
      add("info", "Ledger totals",
          `${pCount.toLocaleString()} lines · ${peso(stats.grand)} grand total · newest purchase ${fmtDate(stats.latestDate)}`);
    }

    /* migration 002 — clean "ELBOW 6 - 90°" display */
    if (migRes.error) {
      add("warn", "migration_002_display.sql not applied yet",
          "The client still sees raw particulars text. Paste supabase/migration_002_display.sql in the Supabase SQL editor to switch on the clean display (nothing else changes).");
    } else {
      add("ok", "Display migration applied", "purchases_flat serves the structured brand/type/size/degrees columns.");
    }

    /* accounts & owner */
    const profs = profRes.error ? null : (profRes.data ?? []);
    if (profs === null) {
      add("fail", "User accounts readable", profRes.error.message);
    } else {
      const owner = profs.find((p) => p.role === "owner" && p.is_active);
      if (owner) add("ok", "Owner account present", `${owner.email || "(email hidden)"} · owner`);
      else add("fail", "No active owner account!", "Nobody can manage users or roles. Check profiles.is_active in Supabase.");
      const by = { owner: 0, encoder: 0, viewer: 0 };
      let inactive = 0;
      for (const p of profs) { if (p.is_active) by[p.role] = (by[p.role] || 0) + 1; else inactive++; }
      add("info", "Accounts", `${profs.length} total — owner ${by.owner} · encoder ${by.encoder} · viewer ${by.viewer}` +
          (inactive ? ` · ${inactive} deactivated` : ""));
    }

    /* client activity */
    if (stats) {
      if (!stats.lastCreated) {
        add("info", "Client activity", "No entries recorded yet.");
      } else {
        const days = (Date.now() - new Date(stats.lastCreated).getTime()) / 86400000;
        if (days > CONFIG.ACTIVITY_WARN_DAYS) {
          add("warn", "Quiet for a while",
              `Last entry was ${rel(stats.lastCreated)} (${Math.floor(days)} days). Maybe check in with your client.`);
        } else {
          add("ok", "Client activity", `Last entry ${rel(stats.lastCreated)} — the system is being used.`);
        }
      }
      if (stats.zeroPrice > 0)
        add("info", "Zero-price lines", `${stats.zeroPrice} line(s) with UNIT PRICE 0 — fine if they're genuine freebies.`);
      if (stats.noMaterial > 0)
        add("info", "Lines outside the memory",
            `${stats.noMaterial} line(s) not linked to catalog memory (their text won't feed the predictive search).`);
      if (stats.noSupplier > 0)
        add("info", "Lines without supplier", `${stats.noSupplier} line(s) — the known no-invoice / unreadable receipt rows.`);
      if (stats.flagged > 0)
        add("info", "Flagged receipt lines", `${stats.flagged} flagged (unreadable / no-invoice) — kept deliberately during import.`);
      if (stats.filled > 0)
        add("info", "Amounts auto-filled at import", `${stats.filled} line(s) had blank amounts in Excel; the import filled price × qty.`);
      if (stats.dupPairs > 0)
        add("info", "Repeated lines", `${stats.dupPairs} repeated line pair(s) (${stats.dupExtra} extra row(s)) — known from the import, kept as-is.`);
    }

    /* angled links — elbows/bends must carry the same degrees as their material */
    if (ledger && degById) {
      const ang = analyzeAngles(ledger, degById);
      if (ang.total === 0) {
        add("info", "Angled links", "No angled (elbow/bend) lines in the ledger yet.");
      } else if (ang.bad === 0) {
        add("ok", "Angled links consistent",
            `${ang.total} angled line${ang.total === 1 ? "" : "s"} — every elbow/bend links to a material with matching degrees.`);
      } else {
        add("warn", "Angled links disagree",
            `${ang.bad} of ${ang.total} angled line(s) link to a material with different degrees (or nothing). ` +
            `Example: ${ang.examples.join(" · ")}`);
      }
    }

    /* last import */
    const imp = impRes.error ? null : (impRes.data ?? []);
    if (imp.length) {
      const b = imp[0];
      add("info", "Last import", `${b.filename} · ${b.line_count} lines · ${peso(b.grand_total)} · ${rel(b.imported_at)}`);
    }

    /* catalog */
    if (mCount != null)
      add("info", "Predictive memory",
          `${(mCount ?? 0).toLocaleString()} materials · ${(aCount ?? 0).toLocaleString()} aliases · ${(cCount ?? 0)} categories · ${(sCount ?? 0)} suppliers`);

    renderChecks();
    renderTiles({ pCount, mCount, sCount, aCount, cCount, stats, profs });
    renderRecent(recentRes.error ? [] : (recentRes.data ?? []));
    renderImports(imp);
  } catch (e) {
    add("fail", "Unexpected error", String(e));
    renderChecks();
  }

  $("refreshBtn").disabled = false;
  const t = new Date();
  $("lastChecked").textContent = `Checked ${t.toLocaleTimeString([], { hour12: false })}`;
  renderVerdict("done");
  running = false;
}

/* ---------- rendering ----------------------------------------------------- */

function renderVerdict(mode) {
  const el = $("verdict");
  if (mode === "checking") {
    el.className = "verdict ok";
    el.innerHTML = `<span class="vic spin">◌</span><div><h2>Running checks…</h2>
      <p class="vsub">Talking to Supabase and scanning the ledger.</p></div>`;
    return;
  }
  const fails = CHECKS.filter((c) => c.status === "fail").length;
  const warns = CHECKS.filter((c) => c.status === "warn").length;
  if (fails) {
    el.className = "verdict fail";
    el.innerHTML = `<span class="vic">✕</span><div><h2>${fails} issue${fails === 1 ? "" : "s"} — check before your client opens the app</h2>
      <p class="vsub">Red items below need action. Amber items can wait.</p></div>`;
  } else if (warns) {
    el.className = "verdict warn";
    el.innerHTML = `<span class="vic">!</span><div><h2>Nothing broken — ${warns} pending item${warns === 1 ? "" : "s"}</h2>
      <p class="vsub">Safe for your client to open. The amber items below are to-dos or heads-ups, not problems.</p></div>`;
  } else {
    el.className = "verdict ok";
    el.innerHTML = `<span class="vic">✓</span><div><h2>All systems healthy</h2>
      <p class="vsub">Database up, ledger intact, client active — safe for your client to open.</p></div>`;
  }
}

function renderChecks() {
  const ICON = { ok: "✓", info: "i", warn: "!", fail: "✕" };
  $("checks").innerHTML = CHECKS.length
    ? CHECKS.map((c) => `
        <div class="chk ${c.status}">
          <span class="dot" title="${c.status}"></span>
          <div class="chk-body">
            <div class="chk-label">${ICON[c.status]} ${esc(c.label)}</div>
            <div class="chk-detail">${esc(c.detail)}</div>
          </div>
        </div>`).join("")
    : `<div class="chk info"><span class="dot"></span><div class="chk-body">
         <div class="chk-label">Running checks…</div>
         <div class="chk-detail">One moment.</div></div></div>`;
}

function renderTiles({ pCount, mCount, sCount, aCount, cCount, stats, profs }) {
  const roles = { owner: 0, encoder: 0, viewer: 0 };
  for (const p of profs ?? []) if (p.is_active) roles[p.role] = (roles[p.role] || 0) + 1;
  const tiles = [
    { label: "Ledger", value: pCount == null ? "—" : `${pCount.toLocaleString()} lines`, sub: stats ? peso(stats.grand) : "" },
    { label: "This month", value: stats ? `${stats.monthCount} lines` : "—", sub: stats ? peso(stats.monthSum) : "" },
    { label: "Last client entry", value: stats ? rel(stats.lastCreated) : "—", sub: stats?.latestDate ? `newest purchase ${fmtDate(stats.latestDate)}` : "" },
    { label: "Materials memory", value: mCount == null ? "—" : `${mCount.toLocaleString()}`, sub: `${aCount ?? 0} aliases` },
    { label: "Suppliers", value: sCount == null ? "—" : `${sCount}`, sub: `${cCount ?? 0} categories` },
    { label: "Users", value: profs ? `${profs.length}` : "—", sub: profs ? `owner ${roles.owner} · enc ${roles.encoder} · view ${roles.viewer}` : "" },
  ];
  $("tiles").innerHTML = tiles.map((t) => `
    <div class="tile">
      <div class="tile-label">${t.label}</div>
      <div class="tile-value">${esc(t.value)}</div>
      <div class="tile-sub">${esc(t.sub)}</div>
    </div>`).join("");
}

function renderRecent(rows) {
  if (!rows.length) {
    $("recent").innerHTML = `<div class="import-line">No activity yet.</div>`;
    return;
  }
  $("recent").innerHTML = `
    <table class="recent">
      <thead><tr><th>Date</th><th>SI #</th><th>Supplier</th><th>Particulars</th><th style="text-align:right">Amount</th></tr></thead>
      <tbody>${rows.map((r) => `
        <tr>
          <td title="encoded ${esc(rel(r.created_at))}">${esc(fmtDate(r.purchase_date))}</td>
          <td class="dim">${esc(r.si_no || "—")}</td>
          <td class="ell" title="${esc(r.supplier || "—")}">${esc(r.supplier || "—")}</td>
          <td class="ell" title="${esc(r.particulars_raw)}">${esc(r.particulars_raw)}</td>
          <td class="num">${peso(r.amount)}</td>
        </tr>`).join("")}</tbody>
    </table>`;
}

function renderImports(imp) {
  $("imports").innerHTML = imp.length
    ? `Last import: <b>${esc(imp[0].filename)}</b> · ${imp[0].line_count} lines · ${rel(imp[0].imported_at)}`
    : "No imports recorded.";
}

/* ---------- static chrome -------------------------------------------------- */

$("projChip").textContent = `project · ${CONFIG.PROJECT_REF}`;
$("linkSupabase").href = `https://supabase.com/dashboard/project/${CONFIG.PROJECT_REF}`;

/* ---------- sample preview (used by scripts/check.mjs to screenshot the UI;
             renders fake data in-page only — no data leaves the browser) --- */
window.__mcd_preview = function () {
  signedIn = true;
  $("loginView").hidden = true;
  $("appView").hidden = false;
  $("userChip").textContent = "dev@rorotransport.ph";
  $("lastChecked").textContent = "Checked 12:00:00 (sample)";
  CHECKS.length = 0;
  add("ok", "Auth service", "up · 143 ms");
  add("ok", "Database (REST)", "reachable · 96 ms");
  add("ok", "Ledger readable (RLS working)", "131 lines visible for your account");
  add("info", "Ledger totals", "131 lines · ₱500,206.89 grand total · newest purchase Sep 11, 2026");
  add("ok", "Angled links consistent", "25 angled lines — every elbow/bend links to a material with matching degrees.");
  add("warn", "migration_002_display.sql not applied yet",
      "The client still sees raw particulars text. Paste supabase/migration_002_display.sql in the Supabase SQL editor.");
  add("ok", "Owner account present", "dev@rorotransport.ph · owner");
  add("info", "Accounts", "2 total — owner 1 · encoder 1 · viewer 0");
  add("ok", "Client activity", "Last entry 2h ago — the system is being used.");
  add("info", "Flagged receipt lines", "6 flagged (unreadable / no-invoice) — kept deliberately during import.");
  add("info", "Last import", "PURCHASES (1).xlsx · 131 lines · ₱500,206.89 · 2d ago");
  renderChecks();
  renderVerdict("done");
  renderTiles({
    pCount: 131, mCount: 96, sCount: 15, aCount: 128, cCount: 10,
    stats: { grand: 500206.89, monthCount: 3, monthSum: 18415.5, latestDate: "2026-09-11", lastCreated: new Date(Date.now() - 2 * 3600e3).toISOString() },
    profs: [{ role: "owner", is_active: true }, { role: "encoder", is_active: true }],
  });
  renderRecent([
    { created_at: new Date(Date.now() - 2 * 3600e3).toISOString(), purchase_date: "2026-09-11", si_no: "292714", supplier: "CEBU LUCKY MACHINERY, INC.", particulars_raw: "MOLDEX PVC WYE 6X6", amount: 13300 },
    { created_at: new Date(Date.now() - 3 * 3600e3).toISOString(), purchase_date: "2026-09-11", si_no: "1183", supplier: "SUNTRADE", particulars_raw: "ATLAS 3/8 X 2 FULL THREADED ROD", amount: 480 },
  ]);
  renderImports([{ filename: "PURCHASES (1).xlsx", imported_at: new Date(Date.now() - 2 * 86400e3).toISOString(), line_count: 131, grand_total: 500206.89 }]);
};
