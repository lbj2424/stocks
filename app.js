function money(n){ return n.toLocaleString(undefined,{style:"currency",currency:"USD"}); }
function pct(n){ return (n*100).toFixed(2) + "%"; }

// ---------- Chart instances (so we can update them) ----------
let allocChart = null;
let gainsChart = null;

// ---------- CSV + parsing helpers (robust) ----------
function parseCSVLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }

  out.push(cur);
  return out.map(v => v.trim());
}

function toNumber(v){
  if (v == null) return NaN;
  const s = String(v).trim();
  if (!s) return NaN;

  const neg = s.startsWith("(") && s.endsWith(")");
  const cleaned = s.replace(/[,$%()]/g, "").replace(/\s+/g, "");
  const n = Number(cleaned);
  return neg ? -n : n;
}

function normKey(k){
  return String(k || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_"); // "Total Cost" -> "total_cost"
}

async function loadCSV(path){
  const txt = await fetch(path, { cache: "no-store" }).then(r => r.text());
  const clean = txt.replace(/^\uFEFF/, ""); // remove Excel BOM if present

  const [headerLine, ...lines] = clean.trim().split(/\r?\n/);
  const headers = parseCSVLine(headerLine).map(normKey);

  return lines
    .filter(l => l.trim().length)
    .map(line => {
      const parts = parseCSVLine(line);
      const row = {};
      headers.forEach((h,i) => row[h] = parts[i]);

      return {
        ticker: String(row.ticker || "").trim(),
        shares: toNumber(row.shares),
        total_cost: toNumber(row.total_cost),
        month: String(row.month || "").trim()
      };
    });
}

async function loadJSON(path){
  return fetch(path, { cache: "no-store" }).then(r => r.json());
}

// ---------- UI ----------
function buildTable(rows){
  const tbody = document.querySelector("#holdingsTable tbody");
  tbody.innerHTML = "";

  for(const r of rows){
    const tr = document.createElement("tr");
    const cls = r.gainPct >= 0 ? "pos" : "neg";

    tr.innerHTML = `
      <td>${r.ticker}</td>
      <td>${r.shares.toFixed(6)}</td>
      <td>${money(r.avg_cost)}</td>
      <td>${money(r.price)}</td>
      <td>${money(r.invested)}</td>
      <td>${money(r.value)}</td>
      <td class="${cls}">${money(r.gain)}</td>
      <td class="${cls}">${pct(r.gainPct)}</td>
    `;
    tbody.appendChild(tr);
  }
}

function makeCharts(rows){
  // ✅ Aggregate by ticker so charts/legend are readable and stable
  const byTicker = new Map();
  for (const r of rows) {
    const key = r.ticker;
    if (!byTicker.has(key)) {
      byTicker.set(key, { ticker: key, value: 0, invested: 0 });
    }
    const agg = byTicker.get(key);
    agg.value += r.value;
    agg.invested += r.invested;
  }

  const aggRows = [...byTicker.values()].sort((a,b) => b.value - a.value);

  const labels = aggRows.map(r => r.ticker);
  const values = aggRows.map(r => r.value);
  const gains  = aggRows.map(r => r.invested === 0 ? 0 : ((r.value - r.invested) / r.invested) * 100);

  // ✅ Destroy old charts so changing month actually updates visuals
  if (allocChart) allocChart.destroy();
  if (gainsChart) gainsChart.destroy();

  const ctxA = document.getElementById("chartAlloc");
  allocChart = new Chart(ctxA, {
    type: "doughnut",
    data: { labels, datasets: [{ data: values }] },
    options: { plugins: { legend: { position: "bottom", labels: { color: "#e8eefc" } } } }
  });

  const ctxG = document.getElementById("chartGains");
  gainsChart = new Chart(ctxG, {
    type: "bar",
    data: { labels, datasets: [{ label: "Gain %", data: gains }] },
    options: {
      scales: {
        x: { ticks: { color: "#e8eefc" } },
        y: { ticks: { color: "#e8eefc" } }
      },
      plugins: { legend: { labels: { color: "#e8eefc" } } }
    }
  });
}

// ---------- main ----------
async function main(){
  const portfolio  = await loadCSV("portfolio.csv");
  const pricesFile = await loadJSON("prices.json");
  const priceMap   = pricesFile.prices || {};

  document.getElementById("asOf").textContent = `As of: ${pricesFile.asOf || "—"}`;

  // ---------------- Month dropdown setup ----------------
  const sel = document.getElementById("monthSelect");

  const months = [...new Set(
    portfolio.map(r => String(r.month || "").trim()).filter(Boolean)
  )].sort();

  if (sel && !sel.dataset.populated) {
    sel.innerHTML = `<option value="ALL">All</option>`;
    for (const m of months) {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      sel.appendChild(opt);
    }
    sel.dataset.populated = "1";

    // ✅ Re-run dashboard on change
    sel.addEventListener("change", () => main());
  }

  const selectedMonth = sel ? sel.value : "ALL";

  const portfolioFiltered =
    selectedMonth === "ALL"
      ? portfolio
      : portfolio.filter(r => String(r.month || "").trim() === selectedMonth);

  // Remove old missing pill if it exists (so they don't stack)
  const meta = document.querySelector(".meta");
  const oldMissing = meta?.querySelector(".pill.missingPill");
  if (oldMissing) oldMissing.remove();

  // ---------------- Core calculations ----------------
  const priced = [];
  const missing = [];

  for (const p of portfolioFiltered) {
    const t = String(p.ticker || "").trim().toUpperCase();
    if (!t) continue;

    const price = priceMap[t];
    if (typeof price !== "number" || Number.isNaN(price)) {
      missing.push(t);
      continue;
    }

    const shares = Number(p.shares);
    const invested = Number(p.total_cost);

    if (!Number.isFinite(shares) || shares <= 0 || !Number.isFinite(invested)) {
      missing.push(t);
      continue;
    }

    const avg_cost = invested / shares;
    const value = shares * price;
    const gain = value - invested;
    const gainPct = invested === 0 ? 0 : gain / invested;

    priced.push({ ticker: t, shares, avg_cost, price, invested, value, gain, gainPct });
  }

  priced.sort((a,b) => b.value - a.value);

  const totalInvested = priced.reduce((s,r) => s + r.invested, 0);
  const totalValue    = priced.reduce((s,r) => s + r.value, 0);
  const totalGain     = totalValue - totalInvested;
  const totalGainPct  = totalInvested === 0 ? 0 : totalGain / totalInvested;

  const winner = [...priced].sort((a,b) => b.gainPct - a.gainPct)[0];
  const loser  = [...priced].sort((a,b) => a.gainPct - b.gainPct)[0];

  document.getElementById("kpiInvested").textContent = money(totalInvested);
  document.getElementById("kpiValue").textContent    = money(totalValue);
  document.getElementById("kpiGain").textContent     = money(totalGain);
  document.getElementById("kpiGainPct").textContent  = pct(totalGainPct);

  document.getElementById("kpiWinner").textContent    = winner ? winner.ticker : "—";
  document.getElementById("kpiWinnerPct").textContent = winner ? pct(winner.gainPct) : "—";

  document.getElementById("kpiLoser").textContent    = loser ? loser.ticker : "—";
  document.getElementById("kpiLoserPct").textContent = loser ? pct(loser.gainPct) : "—";

  document.getElementById("kpiCount").textContent = String(priced.length);

  buildTable(priced);
  makeCharts(priced); // ✅ now charts update per month

  if (missing.length) {
    const pill = document.createElement("span");
    pill.className = "pill missingPill";
    pill.textContent = `⚠ Missing: ${missing.length}`;
    meta?.appendChild(pill);
    console.warn("Missing/invalid rows:", missing);
  }
}

main().catch(err => {
  console.error(err);
  alert("Dashboard error. Check console.");
});
