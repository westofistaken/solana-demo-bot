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

// Proxy üzerinden Dex verisi çeken fonksiyon
async function fetchDex() {
  try {
    const url =
      "https://api.allorigins.win/raw?url=" +
      encodeURIComponent("https://api.dexscreener.com/latest/dex/pairs/solana");

    const res = await axios.get(url, { timeout: 8000 });

    return res.data?.pairs || [];
  } catch (err) {
    console.log("❌ Proxy hatası:", err.message);
    return [];
  }
}

// Risk hesaplama
function getRiskType(liq, vol) {
  if (liq < 20000 || vol < 5000) return "AGGRESSIVE";
  if (liq < 100000) return "CAUTIOUS";
  return "SAFE";
}

function getFraction(risk) {
  if (risk === "AGGRESSIVE") return 0.05;
  if (risk === "CAUTIOUS") return 0.10;
  return 0.20;
}

// TP/SL
function getTargets(risk, entry) {
  if (risk === "AGGRESSIVE") return { tp: entry * 1.05, sl: entry * 0.92 };
  if (risk === "CAUTIOUS") return { tp: entry * 1.10, sl: entry * 0.90 };
  return { tp: entry * 1.15, sl: entry * 0.88 };
}

// Dex tara
async function scanDex() {
  const pairs = await fetchDex();

  if (pairs.length === 0) {
    console.log("⚠️ Dex yine boş döndü.");
    return;
  }

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
      name: p.baseToken?.name || "Unknown",
      symbol: p.baseToken?.symbol || "?",
      price,
      liquidity: liq,
      volume: vol,
      risk
    };
  });

  console.log("🔍 Çekilen gerçek coin sayısı:", lastPairs.length);

  simulateTrading();
}

// Demo BUY
function openDemoTrade(coin) {
  if (openTrades.length >= MAX_OPEN_TRADES) return;
  if (openTrades.find(t => t.coinId === coin.id)) return;

  const portion = getFraction(coin.risk);
  const amountUsd = balance * portion;

  if (amountUsd < 1) return;

  const targets = getTargets(coin.risk, coin.price);

  balance -= amountUsd;

  openTrades.push({
    coinId: coin.id,
    coinName: coin.name,
    symbol: coin.symbol,
    risk: coin.risk,
    entryPrice: coin.price,
    amountUsd,
    ...targets,
    openedAt: Date.now()
  });

  console.log(`🟢 BUY → ${coin.name} | $${amountUsd.toFixed(2)} | Risk: ${coin.risk}`);
}

// Demo SELL
function updateDemoTrades() {
  const remain = [];

  for (const t of openTrades) {
    const coin = lastPairs.find(c => c.id === t.coinId);
    if (!coin) {
      remain.push(t);
      continue;
    }

    const price = coin.price;

    if (price >= t.tp || price <= t.sl) {
      const multiplier = price / t.entryPrice;
      const endAmount = t.amountUsd * multiplier;

      balance += endAmount;

      closedTrades.unshift({
        ...t,
        exitPrice: price,
        closedAt: new Date().toISOString(),
        profit: endAmount - t.amountUsd
      });

      console.log(`🔴 SELL → ${t.coinName} | PnL: ${(endAmount - t.amountUsd).toFixed(2)}`);
    } else {
      remain.push(t);
    }
  }

  openTrades = remain.slice(0, 25);
  closedTrades = closedTrades.slice(0, 25);
}

// Bot döngüsü
function simulateTrading() {
  updateDemoTrades();
  for (const c of lastPairs) openDemoTrade(c);
}

// İlk çalışma
scanDex();
setInterval(scanDex, (config.scanIntervalSeconds || 30) * 1000);

// Web panel
const PORT = process.env.PORT || 8080;

app.get("/", (req, res) => {
  const coins = lastPairs
    .map(
      c => `
    <tr>
      <td>${c.name}</td>
      <td>$${c.price.toFixed(5)}</td>
      <td>$${c.liquidity.toLocaleString()}</td>
      <td>$${c.volume.toLocaleString()}</td>
      <td>${c.risk}</td>
    </tr>`
    )
    .join("");

  res.send(`
    <h1>🤖 Solana Demo Trading Bot</h1>
    <p><b>Balance:</b> $${balance.toFixed(2)}</p>

    <h2>📊 Gerçek Dex Coinleri</h2>
    <table border="1" cellpadding="6">
      <tr><th>Coin</th><th>Fiyat</th><th>Likidite</th><th>Hacim</th><th>Risk</th></tr>
      ${coins || "<tr><td colspan='5'>Veri YOK...</td></tr>"}
    </table>
  `);
});

app.listen(PORT, () => console.log("🌐 Server active:", PORT));
