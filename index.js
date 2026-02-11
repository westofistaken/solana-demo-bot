const express = require("express");
const axios = require("axios");
const fs = require("fs");

const app = express();

// config.json oku
const config = JSON.parse(fs.readFileSync("config.json"));

let balance = config.startingBalance;
let openTrades = [];

console.log("🤖 DEMO BOT BAŞLADI");
console.log("💰 Başlangıç bakiyesi:", balance, "$");

// DexScreener tarama (şimdilik sadece log)
async function scanDex() {
  try {
    const res = await axios.get(
      "https://api.dexscreener.com/latest/dex/pairs/solana"
    );

    console.log("🔍 Tarama yapıldı | Pair sayısı:", res.data.pairs.length);
    console.log("📂 Açık işlemler:", openTrades.length);
    console.log("💰 Demo bakiye:", balance.toFixed(2), "$");
  } catch (err) {
    console.log("⚠️ DexScreener erişim hatası");
  }
}

// interval
setInterval(scanDex, config.scanIntervalSeconds * 1000);

// 🌐 WEB PANEL
const PORT = process.env.PORT || 8080;

app.get("/", (req, res) => {
  res.send(`
    <h1>🤖 Solana Demo Trading Bot</h1>
    <p>Status: Running</p>
    <p>Mode: DEMO</p>
    <p>Balance: $${balance.toFixed(2)}</p>
    <p>Open Trades: ${openTrades.length}</p>
  `);
});

app.listen(PORT, () => {
  console.log("🌐 Web server running on port", PORT);
});
