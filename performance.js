function money(n){ return Number(n).toLocaleString(undefined,{style:"currency",currency:"USD"}); }
function pct(n){ return (n*100).toFixed(2) + "%"; }

// ---------------- CSV parsing helpers ----------------
function parseCSVLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === "," && !inQuotes) {
      out.push(cur); cur = "";
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
  return String(k || "").trim().toLowerCase().replace(/\s+/g, "_");
}

async function loadCSV(path){
  const txt = await fetch(path, { cache: "no-store" }).then(r => r.text());
  const clean = txt.replace(/^\uFEFF/, "");
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

// ---------------- Period logic ----------------
function monthFromISODate(iso){ 
  const s = String(iso || "").trim();
  return s.slice(0,7);
}

function addMonths(yyyymm, delta){
  const [y, m] = yyyymm.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, 1));
  dt.setUTCMonth(dt.getUTCMonth() + delta);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2,"0");
  return `${yy}-${mm}`;
}

function quarterStartMonth(yyyymm){
  const [y, m] = yyyymm.split("-").map(Number);
  const qStart = m <= 3 ? 1 : m <= 6 ? 4 : m <= 9 ? 7 : 10;
  return `${y}-${String(qStart).padStart(2,"0")}`;
}

function prevQuarterRange(yyyymm){
  const [y, m] = yyyymm.split("-").map(Number);
  const thisQStart = Number(quarterStartMonth(yyyymm).split("-")[1]);
  let endMonth = thisQStart - 1;
  let endYear = y;
  if (endMonth <= 0) { endMonth += 12; endYear -= 1; }

  const startMonth = endMonth - 2;
  const startYear = startMonth <= 0 ? endYear - 1 : endYear;
  const sm = startMonth <= 0 ? startMonth + 12 : startMonth;
  return { start: `${startYear}-${String(sm).padStart(2,"0")}`, end: `${endYear}-${String(endMonth).padStart(2,"0")}` };
}

function inMonthRange(m, start, end){
  return m >= start && m <= end;
}

function periodRange(periodKey, asOfMonth){
  if (periodKey === "MTD") return { label: "Month-to-Date", startMonth: asOfMonth, endMonth: asOfMonth };
  if (periodKey === "QTD") return { label: "Quarter-to-Date", startMonth: quarterStartMonth(asOfMonth), endMonth: asOfMonth };
  if (periodKey === "YTD") return { label: "Year-to-Date", startMonth: `${asOfMonth.slice(0,4)}-01`, endMonth: asOfMonth };
  if (periodKey === "LM") { const lm = addMonths(asOfMonth, -1); return { label: "Last Month", startMonth: lm, endMonth: lm }; }
  if (periodKey === "LQ") { const r = prevQuarterRange(asOfMonth); return { label: "Last Quarter", startMonth: r.start, endMonth: r.end }; }
  if (periodKey === "LTM") { const start = addMonths(asOfMonth, -11); return { label: "Last 12 Months", startMonth: start, endMonth: asOfMonth }; }
  return { label: "Since Inception", startMonth: null, endMonth: asOfMonth };
}

function monthLabel(m){
  const s = String(m || "").trim();
  const [y, mo] = s.split("-");
  const n = Number(mo);
  const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  if (!y || !n || n < 1 || n > 12) return s;
  return `${names[n-1]} ${y}`;
}

// ---------------- IRR Logic ----------------
function calcIRRMonthly(cashflows){
  if (!cashflows || cashflows.length < 2) return null;
  let hasNeg = false, hasPos = false;
  for (const cf of cashflows) {
    if (cf.amount < 0) hasNeg = true;
    if (cf.amount > 0) hasPos = true;
  }
  if (!hasNeg || !hasPos) return null;

  const npv = (r) => {
    let s = 0;
    for (const cf of cashflows) {
      s += cf.amount / Math.pow(1 + r, cf.tMonths);
    }
    return s;
  };

  let lo = -0.95, hi = 10;
  let fLo = npv(lo), fHi = npv(hi);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi)) return null;
  if (fLo * fHi > 0) { hi = 50; fHi = npv(hi); if (!Number.isFinite(fHi) || fLo * fHi > 0) return null; }

  for (let i = 0; i < 120; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (!Number.isFinite(fMid)) return null;
    if (Math.abs(fMid) < 1e-8) { lo = hi = mid; break; }
    if (fLo * fMid <= 0) { hi = mid; fHi = fMid; } else { lo = mid; fLo = fMid; }
  }
  const rMonthly = (lo + hi) / 2;
  return Math.pow(1 + rMonthly, 12) - 1;
}

function buildCashflowsForPeriod(rows, priceMap, asOfISO){
  const asOfMonth = monthFromISODate(asOfISO);
  const months = rows.map(r => r.month).filter(Boolean).sort();
  if (!months.length) return null;

  const startMonth = months[0];
  const tIndex = (m) => {
    const [sy, sm] = startMonth.split("-").map(Number);
    const [y, mo] = m.split("-").map(Number);
    return (y - sy) * 12 + (mo - sm);
  };

  const cashflows = [];
  for (const r of rows) {
    const m = String(r.month || "").trim();
    const t = String(r.ticker || "").trim().toUpperCase();
    const invested = Number(r.total_cost);
    if (!m || !t || !Number.isFinite(invested) || invested === 0) continue;
    cashflows.push({ tMonths: tIndex(m), amount: -invested });
  }

  let endingValue = 0;
  for (const r of rows) {
    const t = String(r.ticker || "").trim().toUpperCase();
    const price = priceMap[t];
    const shares = Number(r.shares);
    if (typeof price !== "number" || Number.isNaN(price)) continue;
    if (!Number.isFinite(shares) || shares <= 0) continue;
    endingValue += shares * price;
  }

  cashflows.push({ tMonths: tIndex(asOfMonth), amount: endingValue });
  return cashflows;
}

// ---------------- Sorting ----------------
let sortState = { key: "value", dir: "desc" };
let currentAggRows = [];

function sortRows(rows, key, dir){
  const mult = dir === "asc" ? 1 : -1;
  return [...rows].sort((a,b) => {
    const av = a[key];
    const bv = b[key];
    if (typeof av === "string" || typeof bv === "string") return String(av).localeCompare(String(bv)) * mult;
    const an = (av == null ? NaN : Number(av));
    const bn = (bv == null ? NaN : Number(bv));
    if (Number.isNaN(an) && Number.isNaN(bn)) return 0;
    if (Number.isNaN(an)) return 1;
    if (Number.isNaN(bn)) return -1;
    return (an - bn) * mult;
  });
}

function initTableSorting(){
  const table = document.getElementById("perfTable");
  if (!table || table.dataset.sortInit) return;
  const headers = table.querySelectorAll("thead th[data-sort]");
  headers.forEach(th => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (sortState.key === key) sortState.dir = sortState.dir === "asc" ? "desc" : "asc";
      else { sortState.key = key; sortState.dir = "desc"; }
      renderTable(sortRows(currentAggRows, sortState.key, sortState.dir));
    });
  });
  table.dataset.sortInit = "1";
}

function renderTable(aggRows){
  const tbody = document.querySelector("#perfTable tbody");
  tbody.innerHTML = "";

  for (const r of aggRows) {
    const cls = r.gainPct >= 0 ? "pos" : "neg";
    const contribText = (r.contribPct == null) ? "—" : (r.contribPct * 100).toFixed(2) + "%";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.ticker}</td>
      <td>${money(r.invested)}</td>
      <td>${money(r.value)}</td>
      <td class="${cls}">${money(r.gain)}</td>
      <td class="${cls}">${pct(r.gainPct)}</td>
      <td class="${cls}">${contribText}</td>
      <td>${(r.weight * 100).toFixed(2)}%</td>
      <td>${r.txns}</td>
    `;
    tbody.appendChild(tr);
  }
}

function setActivePeriod(periodKey){
  const btns = document.querySelectorAll(".periodBtn");
  btns.forEach(b => b.classList.toggle("active", b.dataset.period === periodKey));
}

// ---------------- Main Logic ----------------
async function main(){
  const portfolio  = await loadCSV("portfolio.csv");
  const pricesFile = await loadJSON("prices.json");
  const priceMap   = pricesFile.prices || {};
  const asOfISO    = pricesFile.asOf || "";
  const asOfMonth  = monthFromISODate(asOfISO);

  document.getElementById("asOf").textContent = `As of: ${asOfISO || "—"}`;

  const bar = document.getElementById("periodBar");
  if (!bar.dataset.init) {
    bar.dataset.init = "1";
    window.__period = "YTD";
    setActivePeriod(window.__period);

    bar.addEventListener("click", (e) => {
      const btn = e.target.closest(".periodBtn");
      if (!btn) return;
      window.__period = btn.dataset.period;
      setActivePeriod(window.__period);
      renderForPeriod(portfolio, priceMap, asOfISO, asOfMonth, window.__period);
    });
  }

  initTableSorting();
  renderForPeriod(portfolio, priceMap, asOfISO, asOfMonth, window.__period || "YTD");
}

function renderForPeriod(portfolio, priceMap, asOfISO, asOfMonth, periodKey){
  
  // 1. Calculate GLOBAL Total Value (Used for correct Weighting)
  let globalTotalValue = 0;
  for (const r of portfolio) {
    const t = String(r.ticker || "").trim().toUpperCase();
    const price = priceMap[t];
    const shares = Number(r.shares);
    if (price && shares > 0) {
      globalTotalValue += (shares * price);
    }
  }

  // 2. Filter for Period
  const { label, startMonth, endMonth } = periodRange(periodKey, asOfMonth);
  let rows = portfolio.filter(r => {
    const m = String(r.month || "").trim();
    if (!m) return false;
    if (periodKey === "SI") return m <= endMonth;
    return inMonthRange(m, startMonth, endMonth);
  });

  const pm = document.getElementById("periodMeta");
  if (periodKey === "SI") {
    pm.textContent = `${label}: start → ${monthLabel(endMonth)} (monthly view)`;
  } else {
    pm.textContent = `${label}: ${monthLabel(startMonth)} → ${monthLabel(endMonth)} (monthly view)`;
  }

  // 3. Aggregate for Period
  let totalInvested = 0;
  let totalValue = 0;
  const byTicker = new Map();

  for (const r of rows) {
    const t = String(r.ticker || "").trim().toUpperCase();
    if (!t) continue;
    const shares = Number(r.shares);
    const invested = Number(r.total_cost);
    const price = priceMap[t];

    if (!Number.isFinite(shares) || shares <= 0) continue;
    if (!Number.isFinite(invested)) continue;
    if (typeof price !== "number" || Number.isNaN(price)) continue;

    const value = shares * price;
    totalInvested += invested;
    totalValue += value;

    if (!byTicker.has(t)) byTicker.set(t, { ticker: t, invested: 0, value: 0, txns: 0 });
    const agg = byTicker.get(t);
    agg.invested += invested;
    agg.value += value;
    agg.txns += 1;
  }

  const aggRows = [...byTicker.values()].map(r => {
    const gain = r.value - r.invested;
    const gainPct = r.invested === 0 ? 0 : gain / r.invested;
    return { ...r, gain, gainPct, weight: 0 };
  });

  // 4. Calculate Weights
  for (const r of aggRows) {
    r.weight = globalTotalValue === 0 ? 0 : r.value / globalTotalValue;
  }

  // KPIs
  const totalGain = totalValue - totalInvested;
  const returnPct = totalInvested === 0 ? 0 : totalGain / totalInvested;
   
  // 5. Calculate Contribution %
  for (const r of aggRows) {
    // FIX: logic based on Return %. 
    // If return is less than 0.1% (essentially flat), calculating "contribution" 
    // results in wacky numbers like 1700%. We hide it in that case.
    if (Math.abs(returnPct) < 0.001) { 
       r.contribPct = null; 
    } else {
       // Also guard against totalGain being literal 0
       r.contribPct = (Math.abs(totalGain) < 0.0001) ? null : (r.gain / totalGain);
    }
  }

  document.getElementById("kpiInvested").textContent = money(totalInvested);
  document.getElementById("kpiValue").textContent = money(totalValue);
  document.getElementById("kpiGain").textContent = money(totalGain);
  document.getElementById("kpiReturn").textContent = pct(returnPct);

  const uniqueTickers = new Set(aggRows.map(r => r.ticker));
  document.getElementById("kpiTickers").textContent = String(uniqueTickers.size);
  document.getElementById("kpiTxns").textContent = String(rows.length);

  const best = [...aggRows].sort((a,b) => b.gainPct - a.gainPct)[0];
  const worst = [...aggRows].sort((a,b) => a.gainPct - b.gainPct)[0];

  document.getElementById("bestTicker").textContent = best ? best.ticker : "—";
  document.getElementById("bestPct").textContent = best ? pct(best.gainPct) : "—";

  document.getElementById("worstTicker").textContent = worst ? worst.ticker : "—";
  document.getElementById("worstPct").textContent = worst ? pct(worst.gainPct) : "—";

  const cashflows = buildCashflowsForPeriod(rows, priceMap, asOfISO);
  const irr = cashflows ? calcIRRMonthly(cashflows) : null;
  document.getElementById("kpiIRR").textContent = irr == null ? "—%" : `${(irr*100).toFixed(2)}%`;

  currentAggRows = aggRows;
  const sorted = sortRows(currentAggRows, sortState.key, sortState.dir);
  renderTable(sorted);
}

main().catch(err => {
  console.error(err);
  alert("Performance page error. Check console.");
});
