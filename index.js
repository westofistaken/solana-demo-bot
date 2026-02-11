const express = require("express");
const axios = require("axios");
const fs = require("fs");

const app = express();
const config = JSON.parse(fs.readFileSync("config.json"));

// Demo/Paper trading durumu
let balance = config.startingBalance || 50;
let lastPairs = [];        // Son taranan gerçek coinler
let openTrades = [];       // Açık demo işlemler
let closedTrades = [];     // Kapanan demo işlemler

const MAX_OPEN_TRADES = config.maxOpenTrades || 5;

// 🔍 Risk tipi hesapla
function getRiskType(liquidity, volume) {
  if (liquidity < 20000 || volume < 5000) return "AGGRESSIVE"; // çok riskli
  if (liquidity < 100000) return "CAUTIOUS";                   // orta
  return "SAFE";                                               // daha oturmuş
}

// 💰 Riske göre pozisyon büyüklüğü (bakiyenin yüzdesi)
function getPositionFraction(risk) {
  if (risk === "AGGRESSIVE") return 0.05; // %5
  if (risk === "CAUTIOUS") return 0.10;   // %10
  return 0.20;                            // %20
}

// 🎯 Riske göre hedef ve stop
function getTargets(risk, entryPrice) {
  if (risk === "AGGRESSIVE") {
    return {
      takeProfit: entryPrice * 1.05, // +%5
      stopLoss: entryPrice * 0.92    // -%8
    };
  }
  if (risk === "CAUTIOUS") {
    return {
      takeProfit: entryPrice * 1.10, // +%10
      stopLoss: entryPrice * 0.90    // -%10
    };
  }
  return {
    takeProfit: entryPrice * 1.15,   // +%15
    stopLoss: entryPrice * 0.88      // -%12
  };
}

// 🔍 DexScreener'dan gerçek Solana verisi çek
async function scanDex() {
  try {
    const res = await axios.get(
      "https://api.dexscreener.com/latest/dex/pairs/solana",
      { timeout: 8000 }
    );

    const pairs = res.data?.pairs || [];

    // Filtre: minimum likidite ve hacim
    const filtered = pairs.filter(p => {
      const liq = p.liquidity?.usd || 0;
      const vol = p.volume?.h24 || 0;
      const price = Number(p.priceUsd || 0);

      return (
        liq >= 20000 &&        // en az 20k likidite
        vol >= 5000 &&        // en az 5k 24s hacim
        price > 0             // fiyat düzgün
      );
    });

    // Hacme göre sırala, ilk 10 coini al
    const top = filtered
      .sort((a, b) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0))
      .slice(0, 10);

    lastPairs = top.map(p => {
      const liq = p.liquidity?.usd || 0;
      const vol = p.volume?.h24 || 0;
      const price = Number(p.priceUsd || 0);
      const risk = getRiskType(liq, vol);

      return {
        id: p.pairAddress || p.url || p.pairCreatedAt || p.baseToken?.address || p.baseToken?.symbol,
        name: p.baseToken?.name || p.baseToken?.symbol || "Unknown",
        symbol: p.baseToken?.symbol || "?",
        price,
        liquidity: liq,
        volume: vol,
        risk
      };
    });

    console.log("🔍 Dex tarandı | Coin sayısı:", lastPairs.length);

    // Yeni verilere göre demo trade simülasyonu yap
    simulateTrading();
  } catch (err) {
    console.log("❌ DexScreener hatası:", err.message);
    // Hata olursa eski lastPairs kalır, yeni trade açmayız
  }
}

// 🛒 Demo alım (sadece kağıt üstünde)
function openDemoTrade(coin) {
  if (openTrades.length >= MAX_OPEN_TRADES) return;

  const alreadyOpen = openTrades.find(t => t.coinId === coin.id);
  if (alreadyOpen) return;

  const fraction = getPositionFraction(coin.risk);
  const amountUsd = balance * fraction;

  if (amountUsd < 1) return; // 1$ altına uğraşmayalım

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

  console.log(
    `🟢 DEMO BUY | ${coin.name} | Risk: ${coin.risk} | Amount: $${amountUsd.toFixed(
      2
    )} | Entry: ${coin.price}`
  );
}

// 💸 Demo satış (kağıt üzerinde kapatma)
function updateDemoTrades() {
  const remainingTrades = [];

  for (const t of openTrades) {
    const coin = lastPairs.find(c => c.id === t.coinId);
    if (!coin) {
      // coin yoksa trade'i olduğu gibi taşı
      remainingTrades.push(t);
      continue;
    }

    const currentPrice = coin.price;

    if (currentPrice >= t.takeProfit || currentPrice <= t.stopLoss) {
      // pozisyon kapanıyor
      const pnlMultiplier = currentPrice / t.entryPrice;
      const finalAmount = t.amountUsd * pnlMultiplier;
      const profit = finalAmount - t.amountUsd;
      balance += finalAmount;

      closedTrades.unshift({
        ...t,
        exitPrice: currentPrice,
        closedAt: new Date().toISOString(),
        profit
      });

      console.log(
        `🔴 DEMO SELL | ${t.coinName} | PnL: $${profit.toFixed(
          2
        )} | Exit: ${currentPrice}`
      );
    } else {
      // açık kalmaya devam
      remainingTrades.push(t);
    }
  }

  // Son 20 kapalı işlemi tut
  closedTrades = closedTrades.slice(0, 20);
  openTrades = remainingTrades;
}

// 🔁 Demo trading döngüsü
function simulateTrading() {
  // Önce mevcut açık işlemleri güncelle
  updateDemoTrades();

  // Sonra uygun coinlere göre yeni işlemler aç
  for (const coin of lastPairs) {
    openDemoTrade(coin);
  }
}

// İlk başta bir kere tara
scanDex();

// Sonra config'e göre belirli aralıklarla tara
const intervalMs = (config.scanIntervalSeconds || 30) * 1000;
setInterval(scanDex, intervalMs);

// 🌐 Web Panel
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
      <td>${t.coinName} (${t.symbol})</td>
      <td>${t.risk}</td>
      <td>$${t.amountUsd.toFixed(2)}</td>
      <td>$${t.entryPrice.toFixed(6)}</td>
      <td>TP: $${t.takeProfit.toFixed(6)}<br>SL: $${t.stopLoss.toFixed(6)}</td>
    </tr>
  `
    )
    .join("");

  const closedRows = closedTrades
    .map(
      t => `
    <tr>
      <td>${t.coinName} (${t.symbol})</td>
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

    <h2>📊 Takip Edilen Gerçek Coinler (DexScreener)</h2>
    <table border="1" cellpadding="6">
      <tr>
        <th>Coin</th>
        <th>Fiyat</th>
        <th>Likidite</th>
        <th>24s Hacim</th>
        <th>Risk</th>
      </tr>
      ${coinRows || "<tr><td colspan='5'>Şu an uygun coin bulunamadı veya DexScreener cevap vermedi.</td></tr>"}
    </table>

    <h2>💼 Açık Demo İşlemler</h2>
    <table border="1" cellpadding="6">
      <tr>
        <th>Coin</th>
        <th>Risk</th>
        <th>Miktar (USD)</th>
        <th>Alış Fiyatı</th>
        <th>Hedefler</th>
      </tr>
      ${openRows || "<tr><td colspan='5'>Açık demo işlem yok.</td></tr>"}
    </table>

    <h2>📜 Kapanan Demo İşlemler</h2>
    <table border="1" cellpadding="6">
      <tr>
        <th>Coin</th>
        <th>Risk</th>
        <th>Miktar (USD)</th>
        <th>Alış</th>
        <th>Satış</th>
        <th>Kâr/Zarar</th>
      </tr>
      ${closedRows || "<tr><td colspan='6'>Henüz kapanan demo işlem yok.</td></tr>"}
    </table>
  `);
});

app.listen(PORT, () => {
  console.log("🌐 Web server running on port", PORT);
});
