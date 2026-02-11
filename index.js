const express = require("express");
const axios = require("axios");
const fs = require("fs");

const app = express();
const config = JSON.parse(fs.readFileSync("config.json"));

let balance = config.startingBalance;
let lastPairs = [];
let trades = [];

console.log("🤖 DEMO BOT BAŞLADI");

// 🔍 RİSK HESABI
function riskType(liquidity, volume) {
  if (liquidity < 20000 || volume < 5000) return "AGGRESSIVE";
  if (liquidity < 100000) return "CAUTIOUS";
  return "SAFE";
}

// 💰 RİSKE GÖRE POZİSYON
function positionSize(risk) {
  if (risk === "AGGRESSIVE") return 0.05; // %5
  if (risk === "CAUTIOUS") return 0.10;   // %10
  return 0.20;                            // %20
}

// 🧪 MOCK COINLER
function loadMockPairs() {
  lastPairs = [
    { name: "TESTINU", price: 0.000012, liquidity: 12000, volume: 3000 },
    { name: "MOONCAT", price: 0.0021, liquidity: 55000, volume: 12000 },
    { name: "SOLGOD", price: 0.45, liquidity: 320000, volume: 98000 }
  ];
}

// 🛒 DEMO ALIM
function tryBuy(pair) {
  const risk = riskType(pair.liquidity, pair.volume);
  const size = positionSize(risk);
  const amount = balance * size;

  if (amount < 1) return;

  balance -= amount;

  trades.push({
    coin: pair.name,
    buyPrice: pair.price,
    amount,
    risk,
    target: pair.price * (risk === "AGGRESSIVE" ? 1.03 : 1.05)
  });
}

// 💸 DEMO SATIM
function trySell() {
  trades = trades.filter(t => {
    const current = lastPairs.find(p => p.name === t.coin);
    if (!current) return true;

    if (current.price >= t.target) {
      const profit = t.amount * 1.05;
      balance += profit;
      return false;
    }
    return true;
  });
}

// 🔁 BOT DÖNGÜSÜ
function botLoop() {
  loadMockPairs();

  lastPairs.forEach(pair => {
    if (!trades.find(t => t.coin === pair.name)) {
      tryBuy(pair);
    }
  });

  trySell();
}

setInterval(botLoop, 5000);

// 🌐 WEB PANEL
const PORT = process.env.PORT || 8080;

app.get("/", (req, res) => {
  const coinRows = lastPairs.map(p => `
    <tr>
      <td>${p.name}</td>
      <td>$${p.price}</td>
      <td>$${p.liquidity}</td>
      <td>$${p.volume}</td>
      <td>${riskType(p.liquidity, p.volume)}</td>
    </tr>
  `).join("");

  const tradeRows = trades.map(t => `
    <tr>
      <td>${t.coin}</td>
      <td>${t.risk}</td>
      <td>$${t.amount.toFixed(2)}</td>
      <td>$${t.buyPrice}</td>
      <td>$${t.target.toFixed(6)}</td>
    </tr>
  `).join("");

  res.send(`
    <h1>🤖 Solana Demo Trading Bot</h1>
    <p><b>Balance:</b> $${balance.toFixed(2)}</p>

    <h2>📊 Coinler</h2>
    <table border="1">
      <tr><th>Coin</th><th>Fiyat</th><th>Likidite</th><th>Hacim</th><th>Risk</th></tr>
      ${coinRows}
    </table>

    <h2>💼 Açık İşlemler</h2>
    <table border="1">
      <tr><th>Coin</th><th>Risk</th><th>Miktar</th><th>Alış</th><th>Hedef</th></tr>
      ${tradeRows}
    </table>
  `);
});

app.listen(PORT, () => {
  console.log("🌐 Web server running on port", PORT);
});
