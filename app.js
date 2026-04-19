const tg = window.Telegram.WebApp;
tg.expand();
tg.setHeaderColor('#161a1e');

const API = 'http://localhost:8080';
const userId = tg.initDataUnsafe?.user?.id;

let currentSymbol = 'BTC';
let currentPrice = 0;
let currentDirection = 'long';
let currentLeverage = 10;
let balance = 0;
let chart, candleSeries, priceUpdateInterval;

const SYMBOLS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP'];

// ── Init ──────────────────────────────────────────────────────────────────────
window.addEventListener('load', async () => {
  initChart();
  await loadBalance();
  await loadPrice();
  await loadPositions();
  priceUpdateInterval = setInterval(async () => {
    await loadPrice();
    updateTradeInfo();
  }, 5000);
});

// ── Chart ─────────────────────────────────────────────────────────────────────
function initChart() {
  const container = document.getElementById('chart-container');
  chart = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: 200,
    layout: { background: { color: '#0b0e11' }, textColor: '#848e9c' },
    grid: { vertLines: { color: '#1e2329' }, horzLines: { color: '#1e2329' } },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    rightPriceScale: { borderColor: '#2b3139' },
    timeScale: { borderColor: '#2b3139', timeVisible: true },
  });
  candleSeries = chart.addCandlestickSeries({
    upColor: '#0ecb81', downColor: '#f6465d',
    borderUpColor: '#0ecb81', borderDownColor: '#f6465d',
    wickUpColor: '#0ecb81', wickDownColor: '#f6465d',
  });
  window.addEventListener('resize', () => {
    chart.applyOptions({ width: container.clientWidth });
  });
  loadCandles();
}

async function loadCandles() {
  try {
    const coinMap = { BTC:'bitcoin', ETH:'ethereum', SOL:'solana', BNB:'binancecoin', XRP:'ripple' };
    const id = coinMap[currentSymbol];
    const res = await fetch(`https://api.coingecko.com/api/v3/coins/${id}/ohlc?vs_currency=usd&days=1`);
    const data = await res.json();
    const candles = data.map(d => ({
      time: Math.floor(d[0] / 1000),
      open: d[1], high: d[2], low: d[3], close: d[4]
    }));
    candleSeries.setData(candles);
  } catch(e) { console.log('candles error', e); }
}

// ── Price ─────────────────────────────────────────────────────────────────────
async function loadPrice() {
  try {
    const coinMap = { BTC:'bitcoin', ETH:'ethereum', SOL:'solana', BNB:'binancecoin', XRP:'ripple' };
    const id = coinMap[currentSymbol];
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`);
    const data = await res.json();
    const info = data[id];
    currentPrice = info.usd;
    const change = info.usd_24h_change || 0;

    document.getElementById('current-price').textContent = `$${formatNum(currentPrice)}`;
    const changeEl = document.getElementById('price-change');
    changeEl.textContent = `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
    changeEl.style.color = change >= 0 ? '#0ecb81' : '#f6465d';
    document.getElementById('current-price').style.color = change >= 0 ? '#0ecb81' : '#f6465d';

    updateTradeInfo();
  } catch(e) {}
}

// ── Balance ───────────────────────────────────────────────────────────────────
async function loadBalance() {
  try {
    const res = await fetch(`${API}/balance?user_id=${userId}`);
    const data = await res.json();
    balance = data.balance || 0;
    document.getElementById('header-balance').textContent = balance.toFixed(2);
    document.getElementById('wallet-balance-display').textContent = `${balance.toFixed(2)} монет`;
  } catch(e) { balance = 0; }
}

// ── Positions ─────────────────────────────────────────────────────────────────
async function loadPositions() {
  try {
    const res = await fetch(`${API}/positions?user_id=${userId}`);
    const data = await res.json();
    renderPositions(data.positions || []);
  } catch(e) { renderPositions([]); }
}

function renderPositions(positions) {
  const el = document.getElementById('positions-list');
  if (!positions.length) {
    el.innerHTML = '<div class="empty-state">Нет открытых позиций</div>';
    return;
  }
  el.innerHTML = positions.map(p => {
    const pnl = calcPnl(p.direction, p.leverage, p.amount, p.entry_price, currentPrice);
    const pnlClass = pnl >= 0 ? 'positive' : 'negative';
    const sign = pnl >= 0 ? '+' : '';
    return `
    <div class="position-card ${p.direction}">
      <div class="pos-header">
        <span class="pos-symbol">${p.symbol}/USD</span>
        <span class="pos-dir ${p.direction}">${p.direction.toUpperCase()} x${p.leverage}</span>
      </div>
      <div class="pos-grid">
        <span>Вход: <b>$${formatNum(p.entry_price)}</b></span>
        <span>Сейчас: <b>$${formatNum(currentPrice)}</b></span>
        <span>Сумма: <b>${p.amount}</b></span>
        <span>Объём: <b>$${formatNum(p.amount * p.leverage)}</b></span>
      </div>
      <div class="pos-pnl ${pnlClass}">${sign}${pnl.toFixed(2)} монет (${sign}${((pnl/p.amount)*100).toFixed(1)}%)</div>
      <button class="close-pos-btn" onclick="closePosition(${p.id})">Закрыть позицию</button>
    </div>`;
  }).join('');
}

function calcPnl(direction, leverage, amount, entryPrice, currentPriceVal) {
  let change = (currentPriceVal - entryPrice) / entryPrice;
  if (direction === 'short') change = -change;
  const pnl = amount * leverage * change;
  return pnl <= -amount ? -amount : pnl;
}

// ── Trade ─────────────────────────────────────────────────────────────────────
function setDirection(dir) {
  currentDirection = dir;
  document.getElementById('btn-long').classList.toggle('active', dir === 'long');
  document.getElementById('btn-short').classList.toggle('active', dir === 'short');
  const btn = document.getElementById('open-btn');
  btn.className = `open-btn ${dir}`;
  btn.textContent = `Открыть ${dir.toUpperCase()}`;
  updateTradeInfo();
}

function setLeverage(val) {
  currentLeverage = val;
  document.getElementById('leverage-slider').value = val;
  document.getElementById('leverage-display').textContent = `x${val}`;
  updateTradeInfo();
}

function updateLeverage(val) {
  currentLeverage = parseInt(val);
  document.getElementById('leverage-display').textContent = `x${val}`;
  updateTradeInfo();
}

function setPercent(pct) {
  const amt = (balance * pct / 100).toFixed(2);
  document.getElementById('trade-amount').value = amt;
  updateTradeInfo();
}

function updateTradeInfo() {
  if (!currentPrice) return;
  const amount = parseFloat(document.getElementById('trade-amount').value) || 0;
  const posSize = amount * currentLeverage;
  const liqChange = 1 / currentLeverage;
  const liqPrice = currentDirection === 'long'
    ? currentPrice * (1 - liqChange)
    : currentPrice * (1 + liqChange);

  document.getElementById('entry-price-display').textContent = `$${formatNum(currentPrice)}`;
  document.getElementById('position-size').textContent = amount > 0 ? `$${formatNum(posSize)}` : '—';
  document.getElementById('liq-price').textContent = amount > 0 ? `$${formatNum(liqPrice)}` : '—';
}

async function openPosition() {
  const amount = parseFloat(document.getElementById('trade-amount').value);
  if (!amount || amount <= 0) { showToast('Введи сумму'); return; }
  if (amount > balance) { showToast('Недостаточно средств'); return; }
  if (!currentPrice) { showToast('Цена не загружена'); return; }

  try {
    const res = await fetch(`${API}/open_position`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        symbol: currentSymbol,
        direction: currentDirection,
        leverage: currentLeverage,
        amount: amount,
        entry_price: currentPrice
      })
    });
    const data = await res.json();
    if (data.ok) {
      showToast(`✅ Позиция открыта #${data.position_id}`);
      document.getElementById('trade-amount').value = '';
      await loadBalance();
      await loadPositions();
    } else {
      showToast(data.error || 'Ошибка');
    }
  } catch(e) { showToast('Ошибка сервера'); }
}

async function closePosition(posId) {
  try {
    const res = await fetch(`${API}/close_position`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, position_id: posId, current_price: currentPrice })
    });
    const data = await res.json();
    if (data.ok) {
      const sign = data.pnl >= 0 ? '+' : '';
      showToast(`Закрыто: ${sign}${data.pnl.toFixed(2)} монет`);
      await loadBalance();
      await loadPositions();
    }
  } catch(e) { showToast('Ошибка'); }
}

// ── Wallet ────────────────────────────────────────────────────────────────────
function showDeposit() {
  document.getElementById('deposit-form').classList.toggle('hidden');
  document.getElementById('withdraw-form').classList.add('hidden');
}
function showWithdraw() {
  document.getElementById('withdraw-form').classList.toggle('hidden');
  document.getElementById('deposit-form').classList.add('hidden');
}

async function submitDeposit() {
  const amount = parseFloat(document.getElementById('deposit-amount').value);
  if (!amount || amount <= 0) { showToast('Введи сумму'); return; }
  try {
    const res = await fetch(`${API}/deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, amount })
    });
    const data = await res.json();
    if (data.ok) {
      showToast('✅ Заявка отправлена');
      document.getElementById('deposit-amount').value = '';
      document.getElementById('deposit-form').classList.add('hidden');
    }
  } catch(e) { showToast('Ошибка'); }
}

async function submitWithdraw() {
  const amount = parseFloat(document.getElementById('withdraw-amount').value);
  if (!amount || amount <= 0) { showToast('Введи сумму'); return; }
  if (amount > balance) { showToast('Недостаточно средств'); return; }
  try {
    const res = await fetch(`${API}/withdraw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, amount })
    });
    const data = await res.json();
    if (data.ok) {
      showToast('✅ Заявка на вывод отправлена');
      document.getElementById('withdraw-amount').value = '';
      document.getElementById('withdraw-form').classList.add('hidden');
      await loadBalance();
    }
  } catch(e) { showToast('Ошибка'); }
}

// ── Pair selector ─────────────────────────────────────────────────────────────
document.getElementById('pair-selector').addEventListener('click', () => {
  document.getElementById('pair-dropdown').classList.toggle('hidden');
});
document.querySelectorAll('.pair-item').forEach(el => {
  el.addEventListener('click', async () => {
    currentSymbol = el.dataset.symbol;
    document.getElementById('current-pair').textContent = `${currentSymbol}/USD`;
    document.getElementById('pair-dropdown').classList.add('hidden');
    await loadPrice();
    await loadCandles();
  });
});

// ── Tabs ──────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    if (tab.dataset.tab === 'positions') loadPositions();
  });
});

function switchTab(tabName, btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.tab[data-tab="${tabName}"]`).classList.add('active');
  document.getElementById(`tab-${tabName}`).classList.add('active');
  btn.classList.add('active');
  if (tabName === 'positions') loadPositions();
  if (tabName === 'wallet') loadBalance();
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function formatNum(n) {
  if (!n) return '0';
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}

let toastTimer;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2500);
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('#pair-selector') && !e.target.closest('#pair-dropdown')) {
    document.getElementById('pair-dropdown').classList.add('hidden');
  }
});
