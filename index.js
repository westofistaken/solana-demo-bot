const express = require("express");
const axios = require("axios");
const fs = require("fs");

const app = express();
const config = JSON.parse(fs.readFileSync("config.json"));

let balance = config.startingBalance;
let lastPairs = [];

console.log("🤖 DEMO BOT BAŞLADI");

// 🔍 RİSK HESAPLAMA
function calculateRisk(liquidity, volume) {
  if (liquidity < 20000 || volume < 5000) return "🟥 Agresif";
  if (liquidity < 100000) return "🟨 Temkinli";
  return "🟩 Güvenli";
}

// 🧪 FAKE COIN (YEDEK)
function loadMockPairs() {
  lastPairs = [
    {
      name: "TESTINU",
      price: 0.000012,
      liquidity: 12000,
      volume: 3000,
      risk: calculateRisk(12000, 3000)
    },
    {
      name: "MOONCAT",
      price: 0.0021,
      liquidity: 55000,
      volume: 12000,
      risk: calculateRisk(55000, 12000)
    },
    {
      name: "SOLGOD",
      price: 0.45,
      liquidity: 320000,
      volume: 98000,
      risk: calculateRisk(320000, 98000)
    }
  ];
}

// 🔍 DEXSCREENER TARAMA
async function scanDex() {
  try {
    const res = await axios.get(
      "https://api.dexscreener.com/latest/dex/pairs/solana",
      { timeout: 5000 }
    );

    if (!res.data.pairs || res.data.pairs.length === 0) {
      console.log("⚠️ Dex boş döndü → mock veri kullanıldı");
      loadMockPairs();
      return;
    }

    lastPairs = res.data.pairs.slice(0, 5).map(pair => ({
      name: pair.baseToken?.name || "Unknown",
      price: pair.priceUsd || 0,
      liquidity: pair.liquidity?.usd || 0,
      volume: pair.volume?.h24 || 0,
      risk: calculateRisk(
        pair.liquidity?.usd || 0,
        pair.volume?.h24 || 0
      )
    }));

    console.log("🔍 Gerçek Dex verisi alındı");
  } catch (err) {
    console.log("❌ Dex hata → mock veri kullanıldı");
    loadMockPairs();
  }
}

// hemen çalıştır
scanDex();
setInterval(scanDex, config.scanIntervalSeconds * 1000);

// 🌐 WEB PANEL
const PORT = process.env.PORT || 8080;

app.get("/", (req, res) => {
  const rows = lastPairs.map(c => `
    <tr>
      <td>${c.name}</td>
      <td>$${Number(c.price).toFixed(6)}</td>
      <td>$${Number(c.liquidity).toLocaleString()}</td>
      <td>$${Number(c.volume).toLocaleString()}</td>
      <td>${c.risk}</td>
    </tr>
  `).join("");

  res.send(`
    <h1>🤖 Solana Demo Trading Bot</h1>
    <p>Status: Running</p>
    <p>Mode: DEMO</p>
    <p>Balance: $${balance.toFixed(2)}</p>

    <h2>📊 Son Taranan Coinler</h2>
    <table border="1" cellpadding="6">
      <tr>
        <th>Coin</th>
        <th>Fiyat</th>
        <th>Likidite</th>
        <th>24s Hacim</th>
        <th>Risk</th>
      </tr>
      ${rows}
    </table>
  `);
});

app.listen(PORT, () => {
  console.log("🌐 Web server running on port", PORT);
});
