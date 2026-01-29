function money(n){ return n.toLocaleString(undefined,{style:"currency",currency:"USD"}); }
function pct(n){ return (n*100).toFixed(2) + "%"; }

async function loadCSV(path){
  const txt = await fetch(path, {cache:"no-store"}).then(r=>r.text());
  const [header, ...lines] = txt.trim().split(/\r?\n/);
  const cols = header.split(",").map(s=>s.trim());
  return lines.map(line=>{
    const parts = line.split(",").map(s=>s.trim());
    const row = {};
    cols.forEach((c,i)=> row[c]=parts[i]);
    row.shares = Number(row.shares);
    row.avg_cost = Number(row.avg_cost);
    return row;
  });
}

async function loadJSON(path){
  return fetch(path, {cache:"no-store"}).then(r=>r.json());
}

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
  const labels = rows.map(r=>r.ticker);
  const values = rows.map(r=>r.value);
  const gains = rows.map(r=>r.gainPct*100);

  const ctxA = document.getElementById("chartAlloc");
  new Chart(ctxA, {
    type:"doughnut",
    data:{ labels, datasets:[{ data: values }]},
    options:{ plugins:{ legend:{ position:"bottom", labels:{ color:"#e8eefc" } } } }
  });

  const ctxG = document.getElementById("chartGains");
  new Chart(ctxG, {
    type:"bar",
    data:{ labels, datasets:[{ label:"Gain %", data:gains }]},
    options:{
      scales:{
        x:{ ticks:{ color:"#e8eefc" } },
        y:{ ticks:{ color:"#e8eefc" } }
      },
      plugins:{ legend:{ labels:{ color:"#e8eefc" } } }
    }
  });
}

async function main(){
  const portfolio = await loadCSV("portfolio.csv");
  const pricesFile = await loadJSON("prices.json");
  const priceMap = pricesFile.prices || {};

  document.getElementById("asOf").textContent =
    `As of: ${pricesFile.asOf || "—"}`;

  const priced = [];
  const missing = [];

  for (const p of portfolio) {
    const t = String(p.ticker).trim().toUpperCase();
    const price = priceMap[t];

    if (typeof price !== "number" || Number.isNaN(price)) {
      missing.push(t);
      continue;
    }

    const invested = p.shares * p.avg_cost;
    const value = p.shares * price;
    const gain = value - invested;
    const gainPct = invested === 0 ? 0 : gain / invested;

    priced.push({ ...p, ticker: t, price, invested, value, gain, gainPct });
  }

  priced.sort((a,b)=> b.value - a.value);

  const totalInvested = priced.reduce((s,r)=> s+r.invested, 0);
  const totalValue = priced.reduce((s,r)=> s+r.value, 0);
  const totalGain = totalValue - totalInvested;
  const totalGainPct = totalInvested === 0 ? 0 : totalGain / totalInvested;

  const winner = [...priced].sort((a,b)=> b.gainPct - a.gainPct)[0];
  const loser  = [...priced].sort((a,b)=> a.gainPct - b.gainPct)[0];

  document.getElementById("kpiInvested").textContent = money(totalInvested);
  document.getElementById("kpiValue").textContent = money(totalValue);
  document.getElementById("kpiGain").textContent = money(totalGain);
  document.getElementById("kpiGainPct").textContent = pct(totalGainPct);

  document.getElementById("kpiWinner").textContent = winner ? winner.ticker : "—";
  document.getElementById("kpiWinnerPct").textContent = winner ? pct(winner.gainPct) : "—";

  document.getElementById("kpiLoser").textContent = loser ? loser.ticker : "—";
  document.getElementById("kpiLoserPct").textContent = loser ? pct(loser.gainPct) : "—";

  document.getElementById("kpiCount").textContent = String(portfolio.length);

  buildTable(priced);
  makeCharts(priced);

  if (missing.length) {
    const pill = document.createElement("span");
    pill.className = "pill";
    pill.textContent = `⚠ Missing: ${missing.length}`;
    document.querySelector(".meta").appendChild(pill);
  }
}

main().catch(err => {
  console.error(err);
  alert("Dashboard error. Check console.");
});


