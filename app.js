const tg = window.Telegram?.WebApp;
if (tg) { tg.expand(); tg.setHeaderColor?.('#161a1e'); }

const API = 'http://localhost:8080';
const userId = tg?.initDataUnsafe?.user?.id || 0;

let currentSymbol = 'BTC';
let currentPrice = 0;
let currentDirection = 'long';
let currentLeverage = 10;
let currentTf = 15;
let balance = 0;
let currency = localStorage.getItem('currency') || 'coins';
let accentColor = localStorage.getItem('accent') || '#f0b90b';
let fxRates = { usd: 1, eur: 0.92, rub: 90 };
let chart, candleSeries, ws;

const COIN_IDS = { BTC:'bitcoin', ETH:'ethereum', SOL:'solana', BNB:'binancecoin', XRP:'ripple' };
const WS_SYMBOLS = { BTC:'btcusdt', ETH:'ethusdt', SOL:'solusdt', BNB:'bnbusdt', XRP:'xrpusdt' };
const TF_DAYS = { 1:'1', 5:'1', 15:'1', 60:'7', 240:'14', 1440:'30', 10080:'90', 43200:'365' };
const CUR_LABELS = { coins:'монет', usd:'USD', eur:'EUR', rub:'RUB' };
const CUR_SIGNS = { coins:'', usd:'$', eur:'€', rub:'₽' };

// ── Boot ──────────────────────────────────────────────────────────────────────
window.addEventListener('load', async () => {
  applyAccent(accentColor);
  applyCurrencyUI();
  initChart();
  await Promise.all([loadBalance(), loadPrice()]);
  loadCandles();
  loadPositions();
  connectWS();
  fetchFxRates();
});

// ── WebSocket realtime ────────────────────────────────────────────────────────
function connectWS() {
  if (ws) ws.close();
  const sym = WS_SYMBOLS[currentSymbol];
  ws = new WebSocket(`wss://stream.binance.com:9443/ws/${sym}@ticker`);
  const dot = document.getElementById('ws-dot');

  ws.onopen = () => { dot.classList.add('live'); };
  ws.onclose = () => { dot.classList.remove('live'); setTimeout(connectWS, 3000); };
  ws.onerror = () => ws.close();

  ws.onmessage = (e) => {
    const d = JSON.parse(e.data);
    const price = parseFloat(d.c);
    const change = parseFloat(d.P);
    const high = parseFloat(d.h);
    const low = parseFloat(d.l);
    if (!price) return;

    const isUp = price >= currentPrice;
    currentPrice = price;

    // animate price
    const el = document.getElementById('current-price');
    el.textContent = `$${fmt(price)}`;
    el.style.color = isUp ? '#0ecb81' : '#f6465d';

    const badge = document.getElementById('price-change');
    badge.textContent = `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
    badge.className = `price-badge${change >= 0 ? '' : ' red'}`;

    document.getElementById('price-high').textContent = `$${fmt(high)}`;
    document.getElementById('price-low').textContent = `$${fmt(low)}`;

    // update last candle
    if (candleSeries) {
      candleSeries.update({ time: Math.floor(Date.now()/1000), open: price, high: price, low: price, close: price });
    }

    updateTradeInfo();
    updateBalanceUI();
  };
}

// ── FX rates ──────────────────────────────────────────────────────────────────
async function fetchFxRates() {
  try {
    const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    const d = await res.json();
    fxRates = { usd: 1, eur: d.rates.EUR || 0.92, rub: d.rates.RUB || 90 };
  } catch(e) {}
}

// ── Chart ─────────────────────────────────────────────────────────────────────
function initChart() {
  const el = document.getElementById('chart-container');
  chart = LightweightCharts.createChart(el, {
    width: el.clientWidth, height: 190,
    layout: { background: { color: '#0b0e11' }, textColor: '#848e9c' },
    grid: { vertLines: { color: '#1e232944' }, horzLines: { color: '#1e232944' } },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    rightPriceScale: { borderColor: '#2b3139', scaleMargins: { top: 0.1, bottom: 0.1 } },
    timeScale: { borderColor: '#2b3139', timeVisible: true, secondsVisible: false },
    handleScroll: true, handleScale: true,
  });
  candleSeries = chart.addCandlestickSeries({
    upColor: '#0ecb81', downColor: '#f6465d',
    borderUpColor: '#0ecb81', borderDownColor: '#f6465d',
    wickUpColor: '#0ecb81', wickDownColor: '#f6465d',
  });
  window.addEventListener('resize', () => chart.applyOptions({ width: el.clientWidth }));
}

const TF_BINANCE = { 1:'1m', 5:'5m', 15:'15m', 60:'1h', 240:'4h', 1440:'1d', 10080:'1w', 43200:'1M' };

async function loadCandles() {
  showLoader(true);
  try {
    const sym = WS_SYMBOLS[currentSymbol].toUpperCase();
    const interval = TF_BINANCE[currentTf] || '15m';
    const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${interval}&limit=200`);
    const data = await res.json();
    if (!Array.isArray(data)) return;
    const candles = data.map(d => ({
      time: Math.floor(d[0]/1000),
      open: parseFloat(d[1]),
      high: parseFloat(d[2]),
      low: parseFloat(d[3]),
      close: parseFloat(d[4])
    }));
    candleSeries.setData(candles);
    chart.timeScale().fitContent();
  } catch(e) { console.log('candles err', e); }
  showLoader(false);
}

function showLoader(v) { document.getElementById('chart-loader').classList.toggle('hidden', !v); }

// ── Price (initial) ───────────────────────────────────────────────────────────
async function loadPrice() {
  try {
    const sym = WS_SYMBOLS[currentSymbol].toUpperCase();
    const [tickerRes, statsRes] = await Promise.all([
      fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${sym}`),
      fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${sym}`)
    ]);
    const ticker = await tickerRes.json();
    const stats = await statsRes.json();
    currentPrice = parseFloat(ticker.price);
    const change = parseFloat(stats.priceChangePercent);
    document.getElementById('current-price').textContent = `$${fmt(currentPrice)}`;
    document.getElementById('current-price').style.color = change >= 0 ? '#0ecb81' : '#f6465d';
    const badge = document.getElementById('price-change');
    badge.textContent = `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
    badge.className = `price-badge${change >= 0 ? '' : ' red'}`;
    document.getElementById('price-high').textContent = `$${fmt(parseFloat(stats.highPrice))}`;
    document.getElementById('price-low').textContent = `$${fmt(parseFloat(stats.lowPrice))}`;
    updateTradeInfo();
  } catch(e) {}
}

// ── Balance ───────────────────────────────────────────────────────────────────
async function loadBalance() {
  try {
    const res = await fetch(`${API}/balance?user_id=${userId}`);
    const d = await res.json();
    balance = d.balance || 0;
  } catch(e) { balance = 0; }
  updateBalanceUI();
}

function updateBalanceUI() {
  const converted = convertBalance(balance);
  const sign = CUR_SIGNS[currency];
  const label = CUR_LABELS[currency];
  document.getElementById('bal-display').textContent = `${sign}${converted}`;
  document.getElementById('bal-cur-label').textContent = label;
  document.getElementById('wallet-num').textContent = `${sign}${converted}`;
  document.getElementById('wallet-cur').textContent = label;
}

function convertBalance(coins) {
  if (currency === 'coins') return coins.toFixed(2);
  // 1 монета = 1 USD условно, конвертируем
  const usd = coins;
  if (currency === 'usd') return usd.toFixed(2);
  if (currency === 'eur') return (usd * fxRates.eur).toFixed(2);
  if (currency === 'rub') return Math.round(usd * fxRates.rub).toLocaleString('ru');
  return coins.toFixed(2);
}

function cycleCurrency() {
  const order = ['coins', 'usd', 'eur', 'rub'];
  const idx = order.indexOf(currency);
  currency = order[(idx + 1) % order.length];
  localStorage.setItem('currency', currency);
  applyCurrencyUI();
  updateBalanceUI();
}

function setCurrency(cur) {
  currency = cur;
  localStorage.setItem('currency', cur);
  applyCurrencyUI();
  updateBalanceUI();
}

function applyCurrencyUI() {
  document.querySelectorAll('.cur-pick').forEach(b => {
    b.classList.toggle('active', b.textContent.trim().toLowerCase() === CUR_LABELS[currency] || b.onclick?.toString().includes(`'${currency}'`));
  });
}

// ── Accent color ──────────────────────────────────────────────────────────────
function setAccent(color) {
  accentColor = color;
  localStorage.setItem('accent', color);
  applyAccent(color);
  document.querySelectorAll('.color-pick').forEach(el => {
    el.classList.toggle('active', el.dataset.color === color);
  });
}

function applyAccent(color) {
  document.documentElement.style.setProperty('--yellow', color);
  document.querySelectorAll('.color-pick').forEach(el => {
    el.classList.toggle('active', el.dataset.color === color);
  });
}

// ── Positions ─────────────────────────────────────────────────────────────────
async function loadPositions() {
  try {
    const res = await fetch(`${API}/positions?user_id=${userId}`);
    const d = await res.json();
    renderPositions(d.positions || []);
  } catch(e) { renderPositions([]); }
}

function renderPositions(list) {
  const badge = document.getElementById('pos-badge');
  badge.textContent = list.length;
  badge.classList.toggle('hidden', list.length === 0);
  const el = document.getElementById('positions-list');
  if (!list.length) { el.innerHTML = '<div class="empty-msg">Нет открытых позиций</div>'; return; }
  el.innerHTML = list.map(p => {
    const pnl = calcPnl(p.direction, p.leverage, p.amount, p.entry_price, currentPrice);
    const pct = ((pnl / p.amount) * 100).toFixed(1);
    const sign = pnl >= 0 ? '+' : '';
    const cls = pnl >= 0 ? 'green' : 'red';
    return `<div class="pos-card ${p.direction}">
      <div class="pos-head">
        <span class="pos-sym">${p.symbol}/USD</span>
        <span class="pos-tag ${p.direction}">${p.direction.toUpperCase()} x${p.leverage}</span>
      </div>
      <div class="pos-grid">
        <span>Вход: <b>$${fmt(p.entry_price)}</b></span>
        <span>Сейчас: <b>$${fmt(currentPrice)}</b></span>
        <span>Сумма: <b>${p.amount}</b></span>
        <span>Объём: <b>$${fmt(p.amount*p.leverage)}</b></span>
      </div>
      <div class="pos-pnl ${cls}">${sign}${pnl.toFixed(2)} монет (${sign}${pct}%)</div>
      <button class="close-btn" onclick="closePosition(${p.id})">Закрыть позицию</button>
    </div>`;
  }).join('');
}

function calcPnl(dir, lev, amt, entry, cur) {
  let ch = (cur - entry) / entry;
  if (dir === 'short') ch = -ch;
  const pnl = amt * lev * ch;
  return pnl <= -amt ? -amt : pnl;
}

// ── Trade ─────────────────────────────────────────────────────────────────────
function setDirection(dir) {
  currentDirection = dir;
  document.getElementById('btn-long').classList.toggle('active', dir==='long');
  document.getElementById('btn-short').classList.toggle('active', dir==='short');
  const btn = document.getElementById('open-btn');
  btn.className = `open-btn ${dir}`;
  btn.textContent = `Открыть ${dir.toUpperCase()}`;
  updateTradeInfo();
}

function setLeverage(v) {
  currentLeverage = v;
  document.getElementById('lev-slider').value = v;
  document.getElementById('lev-display').textContent = `x${v}`;
  updateTradeInfo();
}

function updateLeverage(v) {
  currentLeverage = parseInt(v);
  document.getElementById('lev-display').textContent = `x${v}`;
  updateTradeInfo();
}

function setPercent(pct) {
  document.getElementById('trade-amount').value = (balance * pct / 100).toFixed(2);
  updateTradeInfo();
}

function updateTradeInfo() {
  if (!currentPrice) return;
  const amt = parseFloat(document.getElementById('trade-amount').value) || 0;
  const liqCh = 1 / currentLeverage;
  const liq = currentDirection === 'long' ? currentPrice*(1-liqCh) : currentPrice*(1+liqCh);
  document.getElementById('entry-price-display').textContent = `$${fmt(currentPrice)}`;
  document.getElementById('position-size').textContent = amt > 0 ? `$${fmt(amt*currentLeverage)}` : '—';
  document.getElementById('liq-price').textContent = amt > 0 ? `$${fmt(liq)}` : '—';
}

async function openPosition() {
  const amt = parseFloat(document.getElementById('trade-amount').value);
  if (!amt || amt <= 0) { showToast('Введи сумму'); return; }
  if (amt > balance) { showToast('Недостаточно средств'); return; }
  if (!currentPrice) { showToast('Цена не загружена'); return; }
  try {
    const res = await fetch(`${API}/open_position`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ user_id:userId, symbol:currentSymbol, direction:currentDirection, leverage:currentLeverage, amount:amt, entry_price:currentPrice })
    });
    const d = await res.json();
    if (d.ok) { showToast(`✅ Позиция #${d.position_id} открыта`); document.getElementById('trade-amount').value=''; await loadBalance(); loadPositions(); }
    else showToast(d.error || 'Ошибка');
  } catch(e) { showToast('Ошибка сервера'); }
}

async function closePosition(id) {
  try {
    const res = await fetch(`${API}/close_position`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ user_id:userId, position_id:id, current_price:currentPrice })
    });
    const d = await res.json();
    if (d.ok) { showToast(`Закрыто: ${d.pnl>=0?'+':''}${d.pnl.toFixed(2)} монет`); await loadBalance(); loadPositions(); }
  } catch(e) { showToast('Ошибка'); }
}

// ── Wallet ────────────────────────────────────────────────────────────────────
function toggleForm(type) {
  const dep = document.getElementById('form-deposit');
  const wd = document.getElementById('form-withdraw');
  if (type==='deposit') { dep.classList.toggle('hidden'); wd.classList.add('hidden'); }
  else { wd.classList.toggle('hidden'); dep.classList.add('hidden'); }
}

async function submitDeposit() {
  const amt = parseFloat(document.getElementById('deposit-amount').value);
  if (!amt || amt <= 0) { showToast('Введи сумму'); return; }
  try {
    const res = await fetch(`${API}/deposit`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({user_id:userId,amount:amt}) });
    const d = await res.json();
    if (d.ok) { showToast('✅ Заявка отправлена'); document.getElementById('deposit-amount').value=''; document.getElementById('form-deposit').classList.add('hidden'); }
  } catch(e) { showToast('Ошибка'); }
}

async function submitWithdraw() {
  const amt = parseFloat(document.getElementById('withdraw-amount').value);
  if (!amt || amt <= 0) { showToast('Введи сумму'); return; }
  if (amt > balance) { showToast('Недостаточно средств'); return; }
  try {
    const res = await fetch(`${API}/withdraw`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({user_id:userId,amount:amt}) });
    const d = await res.json();
    if (d.ok) { showToast('✅ Заявка отправлена'); document.getElementById('withdraw-amount').value=''; document.getElementById('form-withdraw').classList.add('hidden'); await loadBalance(); }
  } catch(e) { showToast('Ошибка'); }
}

// ── Pair ──────────────────────────────────────────────────────────────────────
document.getElementById('pair-selector').addEventListener('click', () => {
  document.getElementById('pair-dropdown').classList.toggle('hidden');
});
document.querySelectorAll('.dropdown-item').forEach(el => {
  el.addEventListener('click', async () => {
    currentSymbol = el.dataset.symbol;
    document.getElementById('current-pair').textContent = `${currentSymbol}/USD`;
    document.getElementById('pair-dropdown').classList.add('hidden');
    await loadPrice(); loadCandles(); connectWS();
  });
});
document.addEventListener('click', e => {
  if (!e.target.closest('#pair-selector') && !e.target.closest('#pair-dropdown'))
    document.getElementById('pair-dropdown').classList.add('hidden');
});

// ── Timeframes ────────────────────────────────────────────────────────────────
document.querySelectorAll('.tf-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentTf = parseInt(btn.dataset.tf);
    loadCandles();
  });
});

// ── Nav ───────────────────────────────────────────────────────────────────────
function switchNav(name, btn) {
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id===`tab-${name}`));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (name==='positions') loadPositions();
  if (name==='wallet') { loadBalance(); applyAccent(accentColor); }
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function fmt(n) {
  if (!n) return '0';
  if (n >= 10000) return n.toLocaleString('en-US', {maximumFractionDigits:0});
  if (n >= 100) return n.toFixed(2);
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}

let toastT;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.remove('hidden');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.add('hidden'), 2500);
}
