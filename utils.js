// ---- Formatting ----
function money(n) {
  return Number(n).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function pct(n) {
  return (n * 100).toFixed(2) + "%";
}

// ---- CSV parsing ----
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

function toNumber(v) {
  if (v == null) return NaN;
  const s = String(v).trim();
  if (!s) return NaN;
  const neg = s.startsWith("(") && s.endsWith(")");
  const cleaned = s.replace(/[,$%()]/g, "").replace(/\s+/g, "");
  const n = Number(cleaned);
  return neg ? -n : n;
}

function normKey(k) {
  return String(k || "").trim().toLowerCase().replace(/\s+/g, "_");
}

async function loadCSV(path) {
  const txt = await fetch(path, { cache: "no-store" }).then(r => r.text());
  const clean = txt.replace(/^\uFEFF/, "");
  const [headerLine, ...lines] = clean.trim().split(/\r?\n/);
  const headers = parseCSVLine(headerLine).map(normKey);

  return lines
    .filter(l => l.trim().length)
    .map(line => {
      const parts = parseCSVLine(line);
      const row = {};
      headers.forEach((h, i) => row[h] = parts[i]);
      return {
        ticker: String(row.ticker || "").trim(),
        shares: toNumber(row.shares),
        total_cost: toNumber(row.total_cost),
        month: String(row.month || "").trim()
      };
    });
}

async function loadJSON(path) {
  return fetch(path, { cache: "no-store" }).then(r => r.json());
}

function monthLabel(m) {
  const s = String(m || "").trim();
  const [y, mo] = s.split("-");
  const n = Number(mo);
  const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  if (!y || !n || n < 1 || n > 12) return s;
  return `${names[n-1]} ${y}`;
}

function sortRows(rows, key, dir) {
  const mult = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (typeof av === "string" || typeof bv === "string") {
      return String(av).localeCompare(String(bv)) * mult;
    }
    const an = Number(av);
    const bn = Number(bv);
    if (Number.isNaN(an) && Number.isNaN(bn)) return 0;
    if (Number.isNaN(an)) return 1;
    if (Number.isNaN(bn)) return -1;
    return (an - bn) * mult;
  });
}

// ---- Sort indicator ----
function updateSortIndicators(tableEl, key, dir) {
  if (!tableEl) return;
  tableEl.querySelectorAll("thead th[data-sort], thead th[data-key]").forEach(th => {
    const k = th.dataset.sort || th.dataset.key;
    th.classList.remove("sorted-asc", "sorted-desc");
    if (k === key) th.classList.add(dir === "asc" ? "sorted-asc" : "sorted-desc");
  });
}

// ---- Error banner ----
function showError(msg) {
  let banner = document.getElementById("errorBanner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "errorBanner";
    banner.className = "errorBanner";
    const main = document.querySelector("main");
    if (main) document.body.insertBefore(banner, main);
    else document.body.appendChild(banner);
  }
  banner.textContent = "⚠ " + msg;
  banner.style.display = "block";
}
