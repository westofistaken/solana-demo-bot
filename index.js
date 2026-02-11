const express = require("express");
const axios = require("axios");
const fs = require("fs");

const app = express();
const config = JSON.parse(fs.readFileSync("config.json"));

let balance = config.startingBalance;
let openTrades = [];
let lastPairs = [];

console.log("🤖 DEMO BOT BAŞLADI");
console.log("💰 Başlangıç bakiyesi:", balance, "$");

// 🔍 RİSK HESAPLAMA
function calculateRisk(pair) {
  const liquidity = pair.liquidity?.usd || 0;
  const volume = pair.volume?.h24 || 0;

  if (liquidity < 20000 || volume < 5000) return "🟥 Agresif";
  if (liquidity < 100000) return "🟨 Temkinli";
  return "🟩 Güvenli";
}

// 🔍 DEXSCREENER TARAMA
async function scanDex() {
  try {
    const res = await axios.get(
      "https://api.dexscreener.com/latest/dex/pairs/solana"
    );

    lastPairs = res.data.pairs.slice(0, 10).map(pair => ({
      name: pair.baseToken?.name || "Unknown",
      price: pair.priceUsd || 0,
      liquidity: pair.liquidity?.usd || 0,
      volume: pair.volume?.h24 || 0,
      risk: calculateRisk(pair)
    }));

    console.log("🔍 Tarama yapıldı | Coin:", lastPairs.length);
  } catch (err) {
    console.log("⚠️ DexScreener erişim hatası");
  }
}

// ⏱ BOT AÇILIR AÇILMAZ TARA
scanDex();

// ⏱ BELİRLİ ARALIKLARLA TARA
setInterval(scanDex, config.scanIntervalSeconds * 1000);

// 🌐 WEB PANEL
const PORT = process.env.PORT || 8080;

app.get("/", (req, res) => {
  let rows = lastPairs
    .map(
      c => `
      <tr>
        <td>${c.name}</td>
        <td>$${Number(c.price).toFixed(6)}</td>
        <td>$${Number(c.liquidity).toLocaleString()}</td>
        <td>$${Number(c.volume).toLocaleString()}</td>
        <td>${c.risk}</td>
      </tr>
    `
    )
    .join("");

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
