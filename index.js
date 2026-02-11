const axios = require("axios");
const fs = require("fs");

const config = JSON.parse(fs.readFileSync("config.json"));

let balance = config.startingBalance;
let openTrades = [];

console.log("🤖 DEMO BOT BAŞLADI");
console.log("💰 Başlangıç bakiyesi:", balance, "$");

async function scanDex() {
  try {
    const res = await axios.get(
      "https://api.dexscreener.com/latest/dex/pairs/solana"
    );

    console.log("🔍 Tarama yapıldı | Pair sayısı:", res.data.pairs.length);
    console.log("📊 Açık işlemler:", openTrades.length);
    console.log("💰 Demo bakiye:", balance.toFixed(2), "$");
  } catch (err) {
    console.log("⚠️ DexScreener erişim hatası");
  }
}

setInterval(scanDex, config.scanIntervalSeconds * 1000);
