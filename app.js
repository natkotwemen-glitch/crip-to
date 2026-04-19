const tg = window.Telegram?.WebApp;
if (tg) { tg.expand(); tg.setHeaderColor?.('#161a1e'); }

const API = 'https://crip-to-production.up.railway.app';
const userId = tg?.initDataUnsafe?.user?.id || 0;

let currentSymbol = 'BTC';
let currentPrice = 0;
let currentDirection = 'long';
let currentLeverage = 10;
let currentTf = 15;
let balance = 0;
let currency = localStorage.getItem('currency') || 'usd';
let accentColor = localStorage.getItem('accent') || '#f0b90b';
let fxRates = { usd: 1, eur: 0.92, rub: 90 };
let chart, candleSeries, ws;
let cachedPositions = [];
let priceCache = {};
let lastCandle = null;

const WS_SYMBOLS = { BTC:'btcusdt', ETH:'ethusdt', SOL:'solusdt', BNB:'bnbusdt', XRP:'xrpusdt' };
const CUR_LABELS = { usd:'USD', eur:'EUR', rub:'RUB' };
const CUR_SIGNS  = { usd:'$', eur:'\u20ac', rub:'\u20bd' };
const TF_BINANCE = { 1:'1m', 5:'5m', 15:'15m', 60:'1h', 240:'4h', 1440:'1d', 10080:'1w', 43200:'1M' };

// Boot
window.addEventListener('load', async () => {
  applyAccent(accentColor);
  applyCurrencyUI();
  initChart();
  await Promise.all([loadBalance(), loadPrice()]);
  loadCandles();
  loadPositions();
  connectWS();
  fetchFxRates();
  setInterval(async () => { await loadBalance(); fetchFxRates(); updateBalanceUI(); }, 10000);
  setInterval(() => loadPositions(), 5000);
});

// WebSocket realtime
function connectWS() {
  if (ws) ws.close();
  const sym = WS_SYMBOLS[currentSymbol];
  ws = new WebSocket(`wss://stream.binance.com:9443/ws/${sym}@ticker`);
  const dot = document.getElementById('ws-dot');

  ws.onopen  = () => dot.classList.add('live');
  ws.onclose = () => { dot.classList.remove('live'); setTimeout(connectWS, 3000); };
  ws.onerror = () => ws.close();

  ws.onmessage = (e) => {
    const d = JSON.parse(e.data);
    const price  = parseFloat(d.c);
    const change = parseFloat(d.P);
    const high   = parseFloat(d.h);
    const low    = parseFloat(d.l);
    if (!price) return;

    const isUp = price >= currentPrice;
    currentPrice = price;
    priceCache[currentSymbol] = price;

    const el = document.getElementById('current-price');
    el.textContent = fmt(price);
    el.style.color = isUp ? '#0ecb81' : '#f6465d';

    const badge = document.getElementById('price-change');
    badge.textContent = `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
    badge.className = `price-badge${change >= 0 ? '' : ' red'}`;

    document.getElementById('price-high').textContent = fmt(high);
    document.getElementById('price-low').textContent  = fmt(low);

    if (candleSeries && lastCandle) {
      const t = Math.floor(Date.now() / 1000);
      const barTime = t - (t % (currentTf * 60));
      if (barTime > lastCandle.time) {
        // новая свеча началась
        lastCandle = { time: barTime, open: price, high: price, low: price, close: price };
      } else {
        // обновляем текущую свечу
        lastCandle.close = price;
        lastCandle.high = Math.max(lastCandle.high, price);
        lastCandle.low  = Math.min(lastCandle.low, price);
      }
      candleSeries.update(lastCandle);
    }

    updateTradeInfo();
    updateBalanceUI();
    if (cachedPositions.length) renderPositions(cachedPositions);
  };
}

// FX rates
async function fetchFxRates() {
  try {
    const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    const d = await res.json();
    fxRates = { usd: 1, eur: d.rates.EUR || 0.92, rub: d.rates.RUB || 90 };
  } catch(e) {}
}

// Chart
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
      open: parseFloat(d[1]), high: parseFloat(d[2]),
      low: parseFloat(d[3]),  close: parseFloat(d[4])
    }));
    candleSeries.setData(candles);
    chart.timeScale().fitContent();
    lastCandle = candles[candles.length - 1] || null;
  } catch(e) { console.log('candles err', e); }
  showLoader(false);
}

function showLoader(v) { document.getElementById('chart-loader').classList.toggle('hidden', !v); }

// Price (initial)
async function loadPrice() {
  try {
    const sym = WS_SYMBOLS[currentSymbol].toUpperCase();
    const [tickerRes, statsRes] = await Promise.all([
      fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${sym}`),
      fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${sym}`)
    ]);
    const ticker = await tickerRes.json();
    const stats  = await statsRes.json();
    currentPrice = parseFloat(ticker.price);
    priceCache[currentSymbol] = currentPrice;
    const change = parseFloat(stats.priceChangePercent);
    document.getElementById('current-price').textContent = fmt(currentPrice);
    document.getElementById('current-price').style.color = change >= 0 ? '#0ecb81' : '#f6465d';
    const badge = document.getElementById('price-change');
    badge.textContent = `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
    badge.className = `price-badge${change >= 0 ? '' : ' red'}`;
    document.getElementById('price-high').textContent = fmt(parseFloat(stats.highPrice));
    document.getElementById('price-low').textContent  = fmt(parseFloat(stats.lowPrice));
    updateTradeInfo();
  } catch(e) {}
}

// Balance
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
  const sign  = CUR_SIGNS[currency];
  const label = CUR_LABELS[currency];
  document.getElementById('bal-display').textContent  = `${sign}${converted}`;
  document.getElementById('bal-cur-label').textContent = label;
  document.getElementById('wallet-num').textContent   = `${sign}${converted}`;
  document.getElementById('wallet-cur').textContent   = label;
}

function convertBalance(coins) {
  if (currency === 'usd')   return coins.toFixed(2);
  if (currency === 'eur')   return (coins * fxRates.eur).toFixed(2);
  if (currency === 'rub')   return Math.round(coins * fxRates.rub).toLocaleString('ru');
  return coins.toFixed(2);
}

function cycleCurrency() {
  const order = ['usd', 'eur', 'rub'];
  currency = order[(order.indexOf(currency) + 1) % order.length];
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
    b.classList.toggle('active', b.onclick?.toString().includes(`'${currency}'`));
  });
}

// Accent color
function setAccent(color) {
  accentColor = color;
  localStorage.setItem('accent', color);
  applyAccent(color);
}

function applyAccent(color) {
  document.documentElement.style.setProperty('--yellow', color);
  document.querySelectorAll('.color-pick').forEach(el => {
    el.classList.toggle('active', el.dataset.color === color);
  });
}

// Positions
async function loadPositions() {
  try {
    const res = await fetch(`${API}/positions?user_id=${userId}`);
    const d = await res.json();
    cachedPositions = d.positions || [];
    renderPositions(cachedPositions);
  } catch(e) { renderPositions(cachedPositions); }
}

function renderPositions(list) {
  const badge = document.getElementById('pos-badge');
  badge.textContent = list.length;
  badge.classList.toggle('hidden', list.length === 0);
  const el = document.getElementById('positions-list');
  if (!list.length) { el.innerHTML = '<div class="empty-msg">\u041d\u0435\u0442 \u043e\u0442\u043a\u0440\u044b\u0442\u044b\u0445 \u043f\u043e\u0437\u0438\u0446\u0438\u0439</div>'; return; }

  // если карточки уже есть — только обновляем PnL без перерисовки
  const existing = el.querySelectorAll('.pos-card');
  if (existing.length === list.length) {
    list.forEach((p, i) => {
      const symPrice = priceCache[p.symbol] || currentPrice;
      const pnl = calcPnl(p.direction, p.leverage, p.amount, p.entry_price, symPrice);
      const pct = ((pnl / p.amount) * 100).toFixed(1);
      const sign = pnl >= 0 ? '+' : '';
      const cls  = pnl >= 0 ? 'green' : 'red';
      const card = existing[i];
      const pnlEl = card.querySelector('.pos-pnl');
      const nowEl = card.querySelectorAll('.pos-grid span b')[1];
      if (pnlEl) { pnlEl.className = `pos-pnl ${cls}`; pnlEl.textContent = `${sign}${fmtCur(pnl)} (${sign}${pct}%)`; }
      if (nowEl) nowEl.textContent = fmt(symPrice);
    });
    return;
  }

  // первая отрисовка
  el.innerHTML = list.map(p => {
    const symPrice = priceCache[p.symbol] || currentPrice;
    const pnl = calcPnl(p.direction, p.leverage, p.amount, p.entry_price, symPrice);
    const pct = ((pnl / p.amount) * 100).toFixed(1);
    const sign = pnl >= 0 ? '+' : '';
    const cls  = pnl >= 0 ? 'green' : 'red';
    return `<div class="pos-card ${p.direction}">
      <div class="pos-head">
        <span class="pos-sym">${p.symbol}/USD</span>
        <span class="pos-tag ${p.direction}">${p.direction.toUpperCase()} x${p.leverage}</span>
      </div>
      <div class="pos-grid">
        <span>\u0412\u0445\u043e\u0434: <b>${fmt(p.entry_price)}</b></span>
        <span>\u0421\u0435\u0439\u0447\u0430\u0441: <b>${fmt(symPrice)}</b></span>
        <span>\u0421\u0443\u043c\u043c\u0430: <b>${fmtCur(p.amount)}</b></span>
        <span>\u041e\u0431\u044a\u0451\u043c: <b>${fmtCur(p.amount * p.leverage)}</b></span>
      </div>
      <div class="pos-pnl ${cls}">${sign}${fmtCur(pnl)} (${sign}${pct}%)</div>
      <button class="close-btn" onclick="closePosition(${p.id})">\u0417\u0430\u043a\u0440\u044b\u0442\u044c \u043f\u043e\u0437\u0438\u0446\u0438\u044e</button>
    </div>`;
  }).join('');
}

// форматирование суммы в текущей валюте
function fmtCur(usd) {
  const sign = CUR_SIGNS[currency];
  if (currency === 'usd') return `${sign}${usd.toFixed(2)}`;
  if (currency === 'eur') return `${sign}${(usd * fxRates.eur).toFixed(2)}`;
  if (currency === 'rub') return `${sign}${Math.round(usd * fxRates.rub).toLocaleString('ru')}`;
  return `${sign}${usd.toFixed(2)}`;
}

function calcPnl(dir, lev, amt, entry, cur) {
  let ch = (cur - entry) / entry;
  if (dir === 'short') ch = -ch;
  const pnl = amt * lev * ch;
  return pnl <= -amt ? -amt : pnl;
}

// Trade
function setDirection(dir) {
  currentDirection = dir;
  document.getElementById('btn-long').classList.toggle('active', dir === 'long');
  document.getElementById('btn-short').classList.toggle('active', dir === 'short');
  const btn = document.getElementById('open-btn');
  btn.className = `open-btn ${dir}`;
  btn.textContent = `\u041e\u0442\u043a\u0440\u044b\u0442\u044c ${dir.toUpperCase()}`;
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
  const amt   = parseFloat(document.getElementById('trade-amount').value) || 0;
  const liqCh = 1 / currentLeverage;
  const liq   = currentDirection === 'long' ? currentPrice*(1-liqCh) : currentPrice*(1+liqCh);
  document.getElementById('entry-price-display').textContent = fmt(currentPrice);
  document.getElementById('position-size').textContent = amt > 0 ? fmt(amt * currentLeverage) : '\u2014';
  document.getElementById('liq-price').textContent     = amt > 0 ? fmt(liq) : '\u2014';
}

async function openPosition() {
  const amt = parseFloat(document.getElementById('trade-amount').value);
  if (!amt || amt <= 0) { showToast('\u0412\u0432\u0435\u0434\u0438 \u0441\u0443\u043c\u043c\u0443'); return; }
  if (amt > balance)    { showToast('\u041d\u0435\u0434\u043e\u0441\u0442\u0430\u0442\u043e\u0447\u043d\u043e \u0441\u0440\u0435\u0434\u0441\u0442\u0432'); return; }
  if (!currentPrice)    { showToast('\u0426\u0435\u043d\u0430 \u043d\u0435 \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043d\u0430'); return; }
  try {
    const res = await fetch(`${API}/open_position`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, symbol: currentSymbol, direction: currentDirection, leverage: currentLeverage, amount: amt, entry_price: currentPrice })
    });
    const d = await res.json();
    if (d.ok) {
      showToast(`\u2705 \u041f\u043e\u0437\u0438\u0446\u0438\u044f #${d.position_id} \u043e\u0442\u043a\u0440\u044b\u0442\u0430 \u043d\u0430 ${fmtCur(amt)}`);
      document.getElementById('trade-amount').value = '';
      await loadBalance();
      loadPositions();
    } else showToast(d.error || '\u041e\u0448\u0438\u0431\u043a\u0430');
  } catch(e) { showToast('\u041e\u0448\u0438\u0431\u043a\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0430'); }
}

async function closePosition(id) {
  try {
    const symPrice = priceCache[cachedPositions.find(p => p.id === id)?.symbol] || currentPrice;
    const res = await fetch(`${API}/close_position`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, position_id: id, current_price: symPrice })
    });
    const d = await res.json();
    if (d.ok) {
      showToast(`\u0417\u0430\u043a\u0440\u044b\u0442\u043e: ${d.pnl >= 0 ? '+' : ''}${fmtCur(d.pnl)}`);
      await loadBalance();
      loadPositions();
    }
  } catch(e) { showToast('\u041e\u0448\u0438\u0431\u043a\u0430'); }
}

// Wallet
function toggleForm(type) {
  const dep = document.getElementById('form-deposit');
  const wd  = document.getElementById('form-withdraw');
  if (type === 'deposit') { dep.classList.toggle('hidden'); wd.classList.add('hidden'); }
  else { wd.classList.toggle('hidden'); dep.classList.add('hidden'); }
}

async function submitDeposit() {
  const amt = parseFloat(document.getElementById('deposit-amount').value);
  if (!amt || amt <= 0) { showToast('\u0412\u0432\u0435\u0434\u0438 \u0441\u0443\u043c\u043c\u0443'); return; }
  try {
    const res = await fetch(`${API}/deposit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: userId, amount: amt }) });
    const d = await res.json();
    if (d.ok) { showToast('\u2705 \u0417\u0430\u044f\u0432\u043a\u0430 \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u0430'); document.getElementById('deposit-amount').value = ''; document.getElementById('form-deposit').classList.add('hidden'); }
  } catch(e) { showToast('\u041e\u0448\u0438\u0431\u043a\u0430'); }
}

async function submitWithdraw() {
  const amt = parseFloat(document.getElementById('withdraw-amount').value);
  if (!amt || amt <= 0) { showToast('\u0412\u0432\u0435\u0434\u0438 \u0441\u0443\u043c\u043c\u0443'); return; }
  if (amt > balance)    { showToast('\u041d\u0435\u0434\u043e\u0441\u0442\u0430\u0442\u043e\u0447\u043d\u043e \u0441\u0440\u0435\u0434\u0441\u0442\u0432'); return; }
  try {
    const res = await fetch(`${API}/withdraw`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: userId, amount: amt }) });
    const d = await res.json();
    if (d.ok) { showToast('\u2705 \u0417\u0430\u044f\u0432\u043a\u0430 \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u0430'); document.getElementById('withdraw-amount').value = ''; document.getElementById('form-withdraw').classList.add('hidden'); await loadBalance(); }
  } catch(e) { showToast('\u041e\u0448\u0438\u0431\u043a\u0430'); }
}

// Pair selector
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

// Timeframes
document.querySelectorAll('.tf-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentTf = parseInt(btn.dataset.tf);
    loadCandles();
  });
});

// Nav
function switchNav(name, btn) {
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${name}`));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const isWallet = name === 'wallet';
  document.getElementById('chart-wrap').style.display = isWallet ? 'none' : '';
  document.querySelector('.price-bar').style.display  = isWallet ? 'none' : '';
  document.querySelector('.tf-bar').style.display     = isWallet ? 'none' : '';
  if (name === 'positions') loadPositions();
  if (isWallet) { loadBalance(); applyAccent(accentColor); }
}

// Utils
function fmt(n) {
  if (!n) return '0';
  if (n >= 10000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 100)   return n.toFixed(2);
  if (n >= 1)     return n.toFixed(4);
  return n.toFixed(6);
}

let toastT;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.add('hidden'), 2500);
}
