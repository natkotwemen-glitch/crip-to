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
let chart, candleSeries;

const COIN_IDS = { BTC:'bitcoin', ETH:'ethereum', SOL:'solana', BNB:'binancecoin', XRP:'ripple' };
const TF_DAYS = { 1:'1', 5:'1', 15:'1', 60:'7', 240:'14', 1440:'30', 10080:'90', 43200:'365' };

// ── Boot ──────────────────────────────────────────────────────────────────────
window.addEventListener('load', async () => {
  initChart();
  await Promise.all([loadBalance(), loadPrice()]);
  loadCandles();
  loadPositions();
  setInterval(async () => { await loadPrice(); updateTradeInfo(); }, 8000);
});

// ── Chart ─────────────────────────────────────────────────────────────────────
function initChart() {
  const el = document.getElementById('chart-container');
  chart = LightweightCharts.createChart(el, {
    width: el.clientWidth, height: 190,
    layout: { background: { color: '#0b0e11' }, textColor: '#848e9c' },
    grid: { vertLines: { color: '#1e232966' }, horzLines: { color: '#1e232966' } },
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
    const id = COIN_IDS[currentSymbol];
    const days = TF_DAYS[currentTf] || '1';
    const res = await fetch(`https://api.coingecko.com/api/v3/coins/${id}/ohlc?vs_currency=usd&days=${days}`);
    const data = await res.json();
    if (!Array.isArray(data)) return;
    const candles = data.map(d => ({ time: Math.floor(d[0]/1000), open:d[1], high:d[2], low:d[3], close:d[4] }))
      .filter((c,i,a) => i===0 || c.time > a[i-1].time);
    candleSeries.setData(candles);
    chart.timeScale().fitContent();
  } catch(e) { console.log(e); }
  showLoader(false);
}

function showLoader(v) {
  document.getElementById('chart-loader').classList.toggle('hidden', !v);
}

// ── Price ─────────────────────────────────────────────────────────────────────
async function loadPrice() {
  try {
    const id = COIN_IDS[currentSymbol];
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true&include_24hr_high=true&include_24hr_low=true`);
    const d = await res.json();
    const info = d[id];
    currentPrice = info.usd;
    const change = info.usd_24h_change || 0;
    const isUp = change >= 0;

    animatePrice(currentPrice, isUp);
    const badge = document.getElementById('price-change');
    badge.textContent = `${isUp?'+':''}${change.toFixed(2)}%`;
    badge.className = `price-badge${isUp?'':' red'}`;
    document.getElementById('price-high').textContent = `$${fmt(info.usd_24h_high||0)}`;
    document.getElementById('price-low').textContent = `$${fmt(info.usd_24h_low||0)}`;
    updateTradeInfo();
  } catch(e) {}
}

function animatePrice(price, isUp) {
  const el = document.getElementById('current-price');
  el.style.color = isUp ? '#0ecb81' : '#f6465d';
  el.style.transform = 'scale(1.05)';
  el.textContent = `$${fmt(price)}`;
  setTimeout(() => el.style.transform = 'scale(1)', 200);
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
  document.querySelector('#header-balance .bal-num').textContent = balance.toFixed(2);
  document.querySelector('.wallet-num').textContent = balance.toFixed(2);
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
  const cnt = document.getElementById('pos-count');
  cnt.textContent = list.length;
  cnt.classList.toggle('hidden', list.length === 0);

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
    if (d.ok) {
      showToast(`✅ Позиция #${d.position_id} открыта`);
      document.getElementById('trade-amount').value = '';
      await loadBalance(); loadPositions();
    } else showToast(d.error || 'Ошибка');
  } catch(e) { showToast('Ошибка сервера'); }
}

async function closePosition(id) {
  try {
    const res = await fetch(`${API}/close_position`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ user_id:userId, position_id:id, current_price:currentPrice })
    });
    const d = await res.json();
    if (d.ok) {
      const s = d.pnl >= 0 ? '+' : '';
      showToast(`Закрыто: ${s}${d.pnl.toFixed(2)} монет`);
      await loadBalance(); loadPositions();
    }
  } catch(e) { showToast('Ошибка'); }
}

// ── Wallet ────────────────────────────────────────────────────────────────────
function toggleForm(type) {
  const dep = document.getElementById('form-deposit');
  const wd = document.getElementById('form-withdraw');
  if (type === 'deposit') { dep.classList.toggle('hidden'); wd.classList.add('hidden'); }
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
    if (d.ok) { showToast('✅ Заявка на вывод отправлена'); document.getElementById('withdraw-amount').value=''; document.getElementById('form-withdraw').classList.add('hidden'); await loadBalance(); }
  } catch(e) { showToast('Ошибка'); }
}

// ── Pair selector ─────────────────────────────────────────────────────────────
document.getElementById('pair-selector').addEventListener('click', () => {
  document.getElementById('pair-dropdown').classList.toggle('hidden');
});
document.querySelectorAll('.dropdown-item').forEach(el => {
  el.addEventListener('click', async () => {
    currentSymbol = el.dataset.symbol;
    document.getElementById('current-pair').textContent = `${currentSymbol}/USD`;
    document.getElementById('pair-dropdown').classList.add('hidden');
    await loadPrice(); loadCandles();
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

// ── Tabs / Nav ────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    if (tab.dataset.tab === 'positions') loadPositions();
    if (tab.dataset.tab === 'wallet') loadBalance();
  });
});

function switchNav(name, btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab===name));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id===`tab-${name}`));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (name==='positions') loadPositions();
  if (name==='wallet') loadBalance();
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
