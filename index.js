const express = require("express");
const axios = require("axios");
const fs = require("fs");

const app = express();
const config = JSON.parse(fs.readFileSync("config.json"));

let balance = config.startingBalance || 50;
let lastPairs = [];
let openTrades = [];
let closedTrades = [];

const MAX_OPEN_TRADES = config.maxOpenTrades || 5;

// ----------------- RİSK & TRADE YARDIMCILARI -----------------

function getRiskType(liq, vol) {
  if (liq < 20000 || vol < 5000) return "AGGRESSIVE"; // çok riskli
  if (liq < 100000) return "CAUTIOUS";                // orta
  return "SAFE";                                      // daha oturmuş
}

function getPositionFraction(risk) {
  if (risk === "AGGRESSIVE") return 0.05; // %5
  if (risk === "CAUTIOUS")  return 0.10;  // %10
  return 0.20;                            // %20
}

function getTargets(risk, entry) {
  if (risk === "AGGRESSIVE") {
    return { tp: entry * 1.05, sl: entry * 0.92 };
  }
  if (risk === "CAUTIOUS") {
    return { tp: entry * 1.10, sl: entry * 0.90 };
  }
  return { tp: entry * 1.15, sl: entry * 0.88 };
}

// ----------------- DEXSCREENER TARAMA (SEARCH) -----------------

async function scanDex() {
  try {
    // DOĞRU endpoint: search
    const res = await axios.get(
      "https://api.dexscreener.com/latest/dex/search?q=solana",
      { timeout: 8000 }
    );

    const pairs = res.data?.pairs || [];

    if (pairs.length === 0) {
      console.log("⚠️ DexSearch pairs boş döndü");
      return;
    }

    // Hacme göre sırala, ilk 10 coin
    const top = pairs
      .sort((a, b) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0))
      .slice(0, 10);

    lastPairs = top.map(p => {
      const liq = p.liquidity?.usd || 0;
      const vol = p.volume?.h24 || 0;
      const price = Number(p.priceUsd || 0);
      const risk = getRiskType(liq, vol);

      return {
        id: p.pairAddress || p.url || p.baseToken?.address,
        name: p.baseToken?.name || p.baseToken?.symbol || "Unknown",
        symbol: p.baseToken?.symbol || "?",
        price,
        liquidity: liq,
        volume: vol,
        risk
      };
    });

    console.log("🔍 DexSearch ile çekilen coin sayısı:", lastPairs.length);

    simulateTrading();
  } catch (err) {
    console.log("❌ DexSearch hata:", err.message);
  }
}

// ----------------- DEMO TRADE MOTORU -----------------

function openDemoTrade(coin) {
  if (openTrades.length >= MAX_OPEN_TRADES) return;
  if (openTrades.find(t => t.coinId === coin.id)) return;

  const fraction = getPositionFraction(coin.risk);
  const amountUsd = balance * fraction;
  if (amountUsd < 1) return;

  const { tp, sl } = getTargets(coin.risk, coin.price);

  balance -= amountUsd;

  openTrades.push({
    coinId: coin.id,
    coinName: coin.name,
    symbol: coin.symbol,
    risk: coin.risk,
    entryPrice: coin.price,
    amountUsd,
    tp,
    sl,
    openedAt: new Date().toISOString()
  });

  console.log(
    `🟢 BUY | ${coin.name} | Risk: ${coin.risk} | $${amountUsd.toFixed(2)}`
  );
}

function updateDemoTrades() {
  const remaining = [];

  for (const t of openTrades) {
    const coin = lastPairs.find(c => c.id === t.coinId);
    if (!coin) {
      remaining.push(t);
      continue;
    }

    const price = coin.price;

    if (price >= t.tp || price <= t.sl) {
      const mult = price / t.entryPrice;
      const finalAmt = t.amountUsd * mult;
      const profit = finalAmt - t.amountUsd;

      balance += finalAmt;

      closedTrades.unshift({
        ...t,
        exitPrice: price,
        closedAt: new Date().toISOString(),
        profit
      });

      console.log(
        `🔴 SELL | ${t.coinName} | PnL: $${profit.toFixed(2)}`
      );
    } else {
      remaining.push(t);
    }
  }

  openTrades = remaining;
  closedTrades = closedTrades.slice(0, 25);
}

function simulateTrading() {
  updateDemoTrades();
  for (const coin of lastPairs) {
    openDemoTrade(coin);
  }
}

// ----------------- BAŞLAT / LOOP -----------------

scanDex(); // ilk tarama

setInterval(
  scanDex,
  (config.scanIntervalSeconds || 30) * 1000
);

// ----------------- WEB PANEL -----------------

const PORT = process.env.PORT || 8080;

app.get("/", (req, res) => {
  const coinRows = lastPairs
    .map(
      c => `
    <tr>
      <td>${c.name} (${c.symbol})</td>
      <td>$${c.price.toFixed(6)}</td>
      <td>$${c.liquidity.toLocaleString()}</td>
      <td>$${c.volume.toLocaleString()}</td>
      <td>${c.risk}</td>
    </tr>
  `
    )
    .join("");

  const openRows = openTrades
    .map(
      t => `
    <tr>
      <td>${t.coinName}</td>
      <td>${t.risk}</td>
      <td>$${t.amountUsd.toFixed(2)}</td>
      <td>$${t.entryPrice.toFixed(6)}</td>
      <td>TP: $${t.tp.toFixed(6)}<br>SL: $${t.sl.toFixed(6)}</td>
    </tr>
  `
    )
    .join("");

  const closedRows = closedTrades
    .map(
      t => `
    <tr>
      <td>${t.coinName}</td>
      <td>${t.risk}</td>
      <td>$${t.amountUsd.toFixed(2)}</td>
      <td>$${t.entryPrice.toFixed(6)}</td>
      <td>$${t.exitPrice.toFixed(6)}</td>
      <td>$${t.profit.toFixed(2)}</td>
    </tr>
  `
    )
    .join("");

  res.send(`
    <h1>🤖 Solana Demo Trading Bot</h1>
    <p><b>Mode:</b> DEMO (GERÇEK ALIM-SATIM YOK)</p>
    <p><b>Balance:</b> $${balance.toFixed(2)}</p>
    <p><b>Open Trades:</b> ${openTrades.length}</p>

    <h2>📊 Gerçek Dex Coinleri (DexSearch)</h2>
    <table border="1" cellpadding="6">
      <tr>
        <th>Coin</th>
        <th>Fiyat</th>
        <th>Likidite</th>
        <th>24s Hacim</th>
        <th>Risk</th>
      </tr>
      ${coinRows || "<tr><td colspan='5'>Henüz veri yok...</td></tr>"}
    </table>

    <h2>💼 Açık Demo İşlemler</h2>
    <table border="1" cellpadding="6">
      <tr>
        <th>Coin</th>
        <th>Risk</th>
        <th>Miktar (USD)</th>
        <th>Alış</th>
        <th>Hedefler</th>
      </tr>
      ${openRows || "<tr><td colspan='5'>Açık demo işlem yok.</td></tr>"}
    </table>

    <h2>📜 Kapanan Demo İşlemler</h2>
    <table border="1" cellpadding="6">
      <tr>
        <th>Coin</th>
        <th>Risk</th>
        <th>USD</th>
        <th>Alış</th>
        <th>Satış</th>
        <th>Kâr/Zarar</th>
      </tr>
      ${closedRows || "<tr><td colspan='6'>Henüz kapanan demo işlem yok.</td></tr>"}
    </table>
  `);
});

app.listen(PORT, () => {
  console.log("🌐 Server running on", PORT);
});
