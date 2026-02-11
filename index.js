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

// Risk hesaplama
function getRiskType(liquidity, volume) {
  if (liquidity < 20000 || volume < 5000) return "AGGRESSIVE"; // çok riskli
  if (liquidity < 100000) return "CAUTIOUS";                   // orta
  return "SAFE";                                               // güvenli
}

// Pozisyon boyutu
function getPositionFraction(risk) {
  if (risk === "AGGRESSIVE") return 0.05; // %5
  if (risk === "CAUTIOUS")  return 0.10; // %10
  return 0.20;                           // %20
}

// TP/SL hesaplama
function getTargets(risk, entryPrice) {
  if (risk === "AGGRESSIVE") {
    return { takeProfit: entryPrice * 1.05, stopLoss: entryPrice * 0.90 };
  }
  if (risk === "CAUTIOUS") {
    return { takeProfit: entryPrice * 1.10, stopLoss: entryPrice * 0.88 };
  }
  return { takeProfit: entryPrice * 1.15, stopLoss: entryPrice * 0.85 };
}

// Dex tarama
async function scanDex() {
  try {
    const res = await axios.get(
      "https://api.dexscreener.com/latest/dex/pairs/solana",
      { timeout: 8000 }
    );

    const pairs = res.data?.pairs || [];

    if (pairs.length === 0) {
      console.log("⚠️ DexScreener boş döndürdü.");
      return;
    }

    // **HİÇ FİLTRE YOK** — tüm coinler içeri alınır
    const top = pairs
      .sort((a, b) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0))
      .slice(0, 10);

    lastPairs = top.map(p => {
      const liquidity = p.liquidity?.usd || 0;
      const volume = p.volume?.h24 || 0;
      const price = Number(p.priceUsd || 0);
      const risk = getRiskType(liquidity, volume);

      return {
        id: p.pairAddress || p.url || p.baseToken?.address,
        name: p.baseToken?.name || p.baseToken?.symbol || "Unknown",
        symbol: p.baseToken?.symbol || "?",
        price,
        liquidity,
        volume,
        risk
      };
    });

    console.log("🔍 Gerçek coinler çekildi:", lastPairs.length);

    simulateTrading();
  } catch (err) {
    console.log("❌ DexScreener hata:", err.message);
  }
}

// Demo ALIŞ
function openDemoTrade(coin) {
  if (openTrades.length >= MAX_OPEN_TRADES) return;

  if (openTrades.find(t => t.coinId === coin.id)) return;

  const fraction = getPositionFraction(coin.risk);
  const amountUsd = balance * fraction;

  if (amountUsd < 1) return;

  const { takeProfit, stopLoss } = getTargets(coin.risk, coin.price);

  balance -= amountUsd;

  openTrades.push({
    coinId: coin.id,
    coinName: coin.name,
    symbol: coin.symbol,
    risk: coin.risk,
    entryPrice: coin.price,
    amountUsd,
    takeProfit,
    stopLoss,
    openedAt: new Date().toISOString()
  });

  console.log(`🟢 BUY | ${coin.name} | Risk: ${coin.risk} | Amount: $${amountUsd.toFixed(2)}`);
}

// Demo SATIŞ
function updateDemoTrades() {
  const remaining = [];

  for (const t of openTrades) {
    const coin = lastPairs.find(c => c.id === t.coinId);

    if (!coin) {
      remaining.push(t);
      continue;
    }

    const price = coin.price;

    if (price >= t.takeProfit || price <= t.stopLoss) {
      const multiplier = price / t.entryPrice;
      const finalAmount = t.amountUsd * multiplier;

      balance += finalAmount;

      closedTrades.unshift({
        ...t,
        exitPrice: price,
        closedAt: new Date().toISOString(),
        profit: finalAmount - t.amountUsd
      });

      console.log(`🔴 SELL | ${t.coinName} | PnL: $${(finalAmount - t.amountUsd).toFixed(2)}`);
    } else {
      remaining.push(t);
    }
  }

  openTrades = remaining;
  closedTrades = closedTrades.slice(0, 25);
}

// Demo trading döngüsü
function simulateTrading() {
  updateDemoTrades();
  for (const coin of lastPairs) openDemoTrade(coin);
}

// İlk tarama
scanDex();
// Periyodik tarama
setInterval(scanDex, (config.scanIntervalSeconds || 30) * 1000);

// Web panel
const PORT = process.env.PORT || 8080;

app.get("/", (req, res) => {
  const coins = lastPairs.map(c => `
    <tr>
      <td>${c.name} (${c.symbol})</td>
      <td>$${c.price.toFixed(6)}</td>
      <td>$${c.liquidity.toLocaleString()}</td>
      <td>$${c.volume.toLocaleString()}</td>
      <td>${c.risk}</td>
    </tr>
  `).join("");

  const open = openTrades.map(t => `
    <tr>
      <td>${t.coinName}</td>
      <td>${t.risk}</td>
      <td>$${t.amountUsd.toFixed(2)}</td>
      <td>$${t.entryPrice.toFixed(6)}</td>
      <td>TP: $${t.takeProfit.toFixed(6)}<br>SL: $${t.stopLoss.toFixed(6)}</td>
    </tr>
  `).join("");

  const closed = closedTrades.map(t => `
    <tr>
      <td>${t.coinName}</td>
      <td>${t.risk}</td>
      <td>$${t.amountUsd.toFixed(2)}</td>
      <td>$${t.entryPrice.toFixed(6)}</td>
      <td>$${t.exitPrice.toFixed(6)}</td>
      <td>$${t.profit.toFixed(2)}</td>
    </tr>
  `).join("");

  res.send(`
    <h1>🤖 Solana Demo Trading Bot</h1>
    <p><b>Mode:</b> DEMO (Gerçek Alım-Satım Yok)</p>
    <p><b>Balance:</b> $${balance.toFixed(2)}</p>
    <p><b>Open Trades:</b> ${openTrades.length}</p>

    <h2>📊 Gerçek Dex Coinleri</h2>
    <table border="1" cellpadding="6">
      <tr><th>Coin</th><th>Fiyat</th><th>Likidite</th><th>Hacim</th><th>Risk</th></tr>
      ${coins || "<tr><td colspan='5'>Henüz veri yok...</td></tr>"}
    </table>

    <h2>💼 Açık Demo İşlemler</h2>
    <table border="1" cellpadding="6">
      <tr><th>Coin</th><th>Risk</th><th>USD</th><th>Entry</th><th>Targets</th></tr>
      ${open || "<tr><td colspan='5'>Açık işlem yok.</td></tr>"}
    </table>

    <h2>📜 Kapanan Demo İşlemler</h2>
    <table border="1" cellpadding="6">
      <tr><th>Coin</th><th>Risk</th><th>USD</th><th>Entry</th><th>Exit</th><th>PnL</th></tr>
      ${closed || "<tr><td colspan='6'>Henüz kapanan yok.</td></tr>"}
    </table>
  `);
});

app.listen(PORT, () => {
  console.log("🌐 Server running on", PORT);
});
