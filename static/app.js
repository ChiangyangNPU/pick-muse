'use strict';

/* 选号缪斯 PickMuse — 前端逻辑 */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const fmt2 = n => String(n).padStart(2, '0');
const pad = n => String(n).padStart(2, '0');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function el(tag, cls = '', text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const GAMES = {
  ssq: {
    name: '双色球',
    zones: [
      { key: 'red', name: '红球', min: 1, max: 33, pick: 6, cls: 'z-red' },
      { key: 'blue', name: '蓝球', min: 1, max: 16, pick: 1, cls: 'z-blue' },
    ],
  },
  dlt: {
    name: '大乐透',
    zones: [
      { key: 'front', name: '前区', min: 1, max: 35, pick: 5, cls: 'z-front' },
      { key: 'back', name: '后区', min: 1, max: 12, pick: 2, cls: 'z-back' },
    ],
  },
};

const STRATEGIES = {
  smart: { name: '综合评分', desc: '频率 + 遗漏加权评分' },
  hot: { name: '热号追踪', desc: '跟随近期高频号码' },
  cold: { name: '冷号回补', desc: '偏爱久未开出的号' },
  balanced: { name: '形态均衡', desc: '贴合历史和值奇偶' },
  random: { name: '完全随机', desc: '等同机选' },
};

const PRIZE_NAME = ['未中奖', '一等奖', '二等奖', '三等奖', '四等奖',
  '五等奖', '六等奖', '七等奖', '八等奖', '九等奖'];

function prizeLevel(game, tNums, dNums) {
  const m = GAMES[game].zones.map(z =>
    tNums[z.key].filter(n => dNums[z.key].includes(n)).length);
  const a = m[0], b = m[1];
  if (game === 'ssq') {
    if (a === 6 && b === 1) return 1;
    if (a === 6) return 2;
    if (a === 5 && b === 1) return 3;
    if (a === 5 || (a === 4 && b === 1)) return 4;
    if (a === 4 || (a === 3 && b === 1)) return 5;
    if (b === 1) return 6;
    return 0;
  }
  if (a === 5 && b === 2) return 1;
  if (a === 5 && b === 1) return 2;
  if (a === 5) return 3;
  if (a === 4 && b === 2) return 4;
  if (a === 4 && b === 1) return 5;
  if (a === 3 && b === 2) return 6;
  if (a === 4) return 7;
  if ((a === 3 && b === 1) || (a === 2 && b === 2)) return 8;
  if (a === 3 || (a === 2 && b === 1) || (a === 1 && b === 2) || (a === 0 && b === 2)) return 9;
  return 0;
}

function mkSmart(game) {
  const o = {};
  for (const z of GAMES[game].zones) o[z.key] = new Map(); // 号码 -> anchor | exclude
  return o;
}

const state = {
  game: 'ssq',
  tab: 'predict',
  strategy: 'smart',
  window: 50,
  count: 5,
  smart: { ssq: mkSmart('ssq'), dlt: mkSmart('dlt') },
  stats: null,
  hist: { ssq: [], dlt: [] },
  histDone: { ssq: false, dlt: false },
  lastPicks: [],
  report: null,
  checkInfo: null,
};

let tickets = [];
try { tickets = JSON.parse(localStorage.getItem('pickmuse.tickets') || '[]'); } catch (e) { /* 忽略损坏数据 */ }
function saveTickets() { localStorage.setItem('pickmuse.tickets', JSON.stringify(tickets)); }

/* ---------------- 通用 ---------------- */

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

async function api(path, opts = {}) {
  const r = await fetch(path, opts);
  let d = null;
  try { d = await r.json(); } catch (e) { /* 非 JSON 响应 */ }
  if (!r.ok || (d && d.error)) throw new Error((d && d.error) || `请求失败（${r.status}）`);
  return d;
}

function fmtTime(ts) {
  const d = new Date(ts);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtMoney(v) {
  if (v == null) return '—';
  return v >= 1e8 ? (v / 1e8).toFixed(2) + ' 亿'
    : v >= 1e4 ? (v / 1e4).toFixed(v % 1e4 ? 1 : 0) + ' 万'
    : String(v);
}

function ballSpan(cls, n, extra = '') {
  const s = el('span', `ball filled ${cls} ${extra}`.trim(), fmt2(n));
  return s;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('已复制到剪贴板');
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('已复制到剪贴板'); }
    catch (_) { toast('复制失败，请手动选择复制'); }
    ta.remove();
  }
}

function ticketText(t) {
  return GAMES[t.game].name + ' ' +
    GAMES[t.game].zones.map(z => t.nums[z.key].map(fmt2).join(' ')).join(' + ');
}

function mdLite(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .split(/\n{2,}/)
    .map(par => par.split('\n').map(l => l.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')).join('<br>'))
    .join('<br><br>');
}

/* ---------------- 数据加载 ---------------- */

function renderDataBar(loading, err) {
  const bar = $('#dataBar');
  if (loading) { bar.innerHTML = '<span class="dot loading"></span>正在获取官方开奖数据…'; return; }
  if (err) {
    bar.innerHTML = `<span class="dot err"></span>${err} <button class="link" id="btnRetryData">重试</button>`;
    $('#btnRetryData').addEventListener('click', () => loadData(true));
    return;
  }
  const s = state.stats;
  if (!s) { bar.innerHTML = ''; return; }
  const t = new Date(s.fetched_at * 1000);
  bar.innerHTML =
    `<span class="dot ok"></span>${GAMES[s.game].name} · 最新 <b>${s.latest.code}</b> 期（${s.latest.date.slice(5)}）` +
    ` · 本地缓存 ${s.total_draws} 期 · 更新于 ${pad(t.getHours())}:${pad(t.getMinutes())}` +
    ` <button class="link" id="btnRefreshData">刷新</button>`;
  $('#btnRefreshData').addEventListener('click', () => loadData(true));
}

async function loadData(refresh = false) {
  const game = state.game;
  renderDataBar(true);
  const rs = refresh ? '&refresh=1' : '';
  try {
    const [stats, hist] = await Promise.all([
      api(`/api/stats?game=${game}&window=${state.window}${rs}`),
      api(`/api/history?game=${game}&limit=30${rs}`),
    ]);
    if (state.game !== game) return;
    state.stats = stats;
    state.hist[game] = hist.draws;
    state.histDone[game] = hist.draws.length >= hist.total;
    renderDataBar();
    renderStatsTab();
    renderHistoryTab();
  } catch (e) {
    if (state.game !== game) return;
    renderDataBar(null, e.message);
    toast(e.message);
  }
}

function switchGame(game) {
  state.game = game;
  state.report = null;
  state.lastPicks = [];
  state.checkInfo = null;
  localStorage.setItem('pickmuse.game', game);
  document.body.className = 'theme-' + game;
  $$('#gameSeg button').forEach(b => b.classList.toggle('active', b.dataset.game === game));
  renderPickGrids();
  renderPredictResult();
  renderTickets();
  loadData();
}

function switchTab(tab) {
  state.tab = tab;
  $$('#tabBar button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.panel').forEach(p => { p.hidden = p.id !== 'tab-' + tab; });
  if (tab === 'history' && !state.hist[state.game].length) loadHistory();
  if (tab === 'mine') renderTickets();
}

/* ---------------- 智能选号 ---------------- */

function renderStrategies() {
  const host = $('#strategyGrid');
  host.innerHTML = '';
  for (const [k, v] of Object.entries(STRATEGIES)) {
    const c = el('button', 'strat-card' + (state.strategy === k ? ' active' : ''));
    c.type = 'button';
    c.innerHTML = `<b>${v.name}</b><span>${v.desc}</span>`;
    c.addEventListener('click', () => {
      state.strategy = k;
      localStorage.setItem('pickmuse.strategy', k);
      renderStrategies();
    });
    host.append(c);
  }
}

function buildSmartZone(zone) {
  const m = state.smart[state.game][zone.key];
  const wrap = el('div', 'zone ' + zone.cls);
  const head = el('div', 'zone-head');
  let a = 0, x = 0;
  m.forEach(v => (v === 'anchor' ? a++ : x++));
  head.append(el('h3', '', zone.name), el('span', 'zone-sub', `胆码 ${a} · 排除 ${x}`));
  const grid = el('div', 'ball-grid');
  for (let n = zone.min; n <= zone.max; n++) {
    const b = el('button', 'gball', fmt2(n));
    b.type = 'button';
    const st = m.get(n);
    if (st === 'anchor') b.classList.add('anchor');
    else if (st === 'exclude') b.classList.add('off');
    b.addEventListener('click', () => {
      const cur = m.get(n);
      if (!cur) {
        let anchors = 0;
        m.forEach(v => { if (v === 'anchor') anchors++; });
        if (anchors >= zone.pick) { toast(`${zone.name}胆码最多 ${zone.pick} 个`); return; }
        m.set(n, 'anchor');
      } else if (cur === 'anchor') {
        m.set(n, 'exclude');
      } else {
        m.delete(n);
      }
      renderPickGrids();
    });
    grid.append(b);
  }
  wrap.append(head, grid);
  return wrap;
}

function renderPickGrids() {
  const host = $('#pickGrids');
  host.innerHTML = '';
  for (const z of GAMES[state.game].zones) host.append(buildSmartZone(z));
}

async function runPredict() {
  const game = state.game;
  const body = {
    game, strategy: state.strategy, count: state.count, window: state.window,
    anchor: {}, exclude: {},
  };
  for (const z of GAMES[game].zones) {
    const m = state.smart[game][z.key];
    body.anchor[z.key] = [...m.entries()].filter(([, v]) => v === 'anchor').map(([n]) => n);
    body.exclude[z.key] = [...m.entries()].filter(([, v]) => v === 'exclude').map(([n]) => n);
  }
  const btn = $('#btnPredict');
  btn.disabled = true;
  btn.textContent = '⏳ 正在分析…';
  try {
    const d = await api('/api/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (state.game !== game) return;
    state.lastPicks = d.picks.map(p => ({
      ...p, game, strategy: d.strategy, strategyName: d.strategy_name, id: uid(),
    }));
    state.report = null;
    renderPredictResult();
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '⚡ 生成智能选号';
  }
}

function renderPredictResult() {
  const card = $('#predictResultCard');
  const picks = state.lastPicks;
  if (!picks.length) { card.hidden = true; return; }
  card.hidden = false;
  $('#predictMeta').textContent = `${STRATEGIES[picks[0].strategy].name} · 基于近 ${state.window} 期`;
  const host = $('#predictResult');
  host.innerHTML = '';
  picks.forEach((p, idx) => {
    host.append(pickRow(p, idx));
  });
  $('#reportBox').hidden = true;
}

function pickRow(p, idx) {
  const row = el('div', 'pick-row');
  const head = el('div', 'pick-head');
  head.append(el('span', 'pick-idx', `第${idx + 1}注`));
  const balls = el('div', 'balls');
  let bi = 0;
  for (const z of GAMES[p.game].zones) {
    for (const n of p.nums[z.key]) {
      const b = ballSpan(z.cls, n, 'pop');
      b.style.animationDelay = `${bi * 45}ms`;
      balls.append(b);
      bi++;
    }
  }
  head.append(balls);
  const saveBtn = el('button', 'mini-btn' + (isSaved(p.id) ? ' saved' : ''), isSaved(p.id) ? '已保存 ✓' : '保存');
  saveBtn.addEventListener('click', () => savePick(p, saveBtn));
  head.append(saveBtn);
  row.append(head);

  const feats = el('div', 'pick-feats');
  feats.innerHTML = `和值 <b>${p.features.sum}</b> · 奇偶 <b>${p.features.odd_even}</b> · 连号 <b>${p.features.consecutive}</b> 组`;
  row.append(feats);

  const details = el('details', 'pick-reasons');
  details.append(el('summary', '', '查看选号依据'));
  const body = el('div', 'reason-body');
  for (const z of GAMES[p.game].zones) {
    const zl = el('div', 'reason-zone ' + z.cls);
    const lines = p.nums[z.key].map(n => {
      const r = p.reasons[z.key][String(n)];
      const score = r.score == null ? '—' : r.score;
      return `<span class="rline"><i class="rb ball filled ${z.cls}">${fmt2(n)}</i>近${state.window}期 <b>${r.freq}</b> 次 · 遗漏 <b>${r.omission}</b> 期 · 评分 <b>${score}</b></span>`;
    }).join('');
    zl.innerHTML = `<strong>${z.name}</strong>${lines}`;
    body.append(zl);
  }
  details.append(body);
  row.append(details);
  return row;
}

function isSaved(id) { return tickets.some(t => t.id === id); }

function savePick(p, btn) {
  if (isSaved(p.id)) return;
  tickets.unshift({
    id: p.id, game: p.game, nums: p.nums, time: Date.now(),
    source: p.strategyName || '',
  });
  saveTickets();
  renderTickets();
  if (btn) {
    btn.textContent = '已保存 ✓';
    btn.classList.add('saved');
  }
  toast('已保存到「我的号码」');
}

async function runReport() {
  const btn = $('#btnReport');
  btn.disabled = true;
  btn.textContent = '🤖 分析中…';
  try {
    const d = await api('/api/ai_report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game: state.game, strategy: state.strategy, window: state.window }),
    });
    state.report = d;
    const box = $('#reportBox');
    box.hidden = false;
    const src = d.source === 'llm' ? '🤖 大模型分析报告' : '📊 内置统计报告（未配置大模型）';
    box.innerHTML = `<div class="report-src">${src}</div><div class="report-text">${mdLite(d.text)}</div>`;
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '🤖 生成 AI 分析报告';
  }
}

/* ---------------- 数据统计 ---------------- */

function renderStatsTab() {
  const s = state.stats;
  if (!s) return;
  $('#statsMeta').textContent = `近 ${s.window_used} 期 · 库存 ${s.total_draws} 期`;
  const fc = $('#freqCharts');
  fc.innerHTML = '';
  for (const z of GAMES[s.game].zones) {
    const blk = el('div', 'freq-block ' + z.cls);
    blk.append(el('h3', '', `${z.name}出现次数`));
    blk.insertAdjacentHTML('beforeend', freqChartSVG(z, s.zones[z.key]));
    blk.insertAdjacentHTML('beforeend',
      `<div class="freq-legend"><span><i style="background:var(--hot)"></i>偏热</span><span><i style="background:var(--mid)"></i>一般</span><span><i style="background:var(--cold)"></i>偏冷</span></div>`);
    fc.append(blk);
  }
  renderHotCold(s);
  renderSumTrend(s);
  renderShapeDist(s);
}

function freqChartSVG(zone, zstat) {
  const lo = zone.min, hi = zone.max, n = hi - lo + 1;
  const W = 760, H = 210, padL = 30, padR = 8, padT = 14, padB = 30;
  const iw = W - padL - padR, ih = H - padT - padB;
  const freqs = [];
  for (let i = 0; i < n; i++) freqs.push(zstat.freq[String(lo + i)] || 0);
  const maxF = Math.max(...freqs, 1);
  const mean = freqs.reduce((a, b) => a + b, 0) / n;
  const step = iw / n;
  const bw = Math.max(2, step * 0.6);
  let bars = '', labels = '';
  for (let i = 0; i < n; i++) {
    const f = freqs[i];
    const h = f ? Math.max(f / maxF * ih, 2.5) : 0;
    const x = padL + i * step + (step - bw) / 2;
    const y = padT + ih - h;
    const r = f / maxF;
    const fill = r >= 0.72 ? 'var(--hot)' : (r <= 0.34 ? 'var(--cold)' : 'var(--mid)');
    bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${fill}"><title>${fmt2(lo + i)}：出现 ${f} 次 · 当前遗漏 ${zstat.omission[String(lo + i)]} 期</title></rect>`;
    if ((lo + i) % 5 === 1 || lo + i === hi) {
      labels += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 10}" text-anchor="middle" class="ax">${fmt2(lo + i)}</text>`;
    }
  }
  const my = padT + ih - mean / maxF * ih;
  const grid =
    `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + ih}" class="axis"/>` +
    `<line x1="${padL}" y1="${padT + ih}" x2="${W - padR}" y2="${padT + ih}" class="axis"/>` +
    `<line x1="${padL}" y1="${my.toFixed(1)}" x2="${W - padR}" y2="${my.toFixed(1)}" class="mean-line"/>` +
    `<text x="${padL - 4}" y="${padT + 4}" text-anchor="end" class="ax">${maxF}</text>` +
    `<text x="${padL - 4}" y="${padT + ih}" text-anchor="end" class="ax">0</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img">${grid}${bars}${labels}</svg>`;
}

function chipRow(label, items, cls) {
  const row = el('div', 'chip-row');
  row.append(el('span', 'chip-label', label));
  const wrap = el('span', 'chips');
  for (const it of items) {
    const c = el('span', `num-chip ${cls}`);
    c.innerHTML = `${fmt2(it.n)}<i>${it.t}</i>`;
    wrap.append(c);
  }
  row.append(wrap);
  return row;
}

function renderHotCold(s) {
  const host = $('#hotCold');
  host.innerHTML = '';
  for (const z of GAMES[s.game].zones) {
    const zs = s.zones[z.key];
    const blk = el('div', 'hc-block ' + z.cls);
    blk.append(el('h3', '', z.name));
    blk.append(chipRow('🔥 热号', zs.hot.map(n => ({ n, t: `${zs.freq[String(n)]} 次` })), 'hot-chip'));
    blk.append(chipRow('❄️ 冷号', zs.cold.map(n => ({ n, t: `${zs.freq[String(n)]} 次` })), 'cold-chip'));
    blk.append(chipRow('⏳ 遗漏最久', zs.overdue.map(n => ({ n, t: `${zs.omission[String(n)]} 期` })), 'over-chip'));
    host.append(blk);
  }
}

function renderSumTrend(s) {
  const host = $('#sumTrend');
  host.innerHTML = '';
  const vals = [...s.sum.series].reverse(); // 旧 → 新
  const zone0 = GAMES[s.game].zones[0];
  if (!vals.length) { host.innerHTML = '<div class="empty">暂无数据</div>'; return; }
  const W = 760, H = 210, padL = 40, padR = 14, padT = 18, padB = 26;
  const iw = W - padL - padR, ih = H - padT - padB;
  const vMin = Math.min(...vals), vMax = Math.max(...vals);
  const lo = vMin - 3, hi = vMax + 3;
  const y = v => padT + ih - (v - lo) / (hi - lo) * ih;
  const x = i => padL + (vals.length === 1 ? iw / 2 : i / (vals.length - 1) * iw);
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${padL},${(padT + ih).toFixed(1)} ${pts} ${x(vals.length - 1).toFixed(1)},${(padT + ih).toFixed(1)}`;
  const meanY = y(s.sum.mean);
  const lastX = x(vals.length - 1), lastY = y(vals[vals.length - 1]);
  const svg =
    `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img">` +
    `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + ih}" class="axis"/>` +
    `<line x1="${padL}" y1="${padT + ih}" x2="${W - padR}" y2="${padT + ih}" class="axis"/>` +
    `<text x="${padL - 5}" y="${padT + 4}" text-anchor="end" class="ax">${vMax}</text>` +
    `<text x="${padL - 5}" y="${padT + ih}" text-anchor="end" class="ax">${vMin}</text>` +
    `<line x1="${padL}" y1="${meanY.toFixed(1)}" x2="${W - padR}" y2="${meanY.toFixed(1)}" class="mean-line"><title>均值 ${s.sum.mean}</title></line>` +
    `<polygon points="${area}" class="trend-area"/>` +
    `<polyline points="${pts}" class="trend"/>` +
    `<circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="4" fill="var(--accent)"><title>最新一期 ${zone0.name}和值：${vals[vals.length - 1]}</title></circle>` +
    `</svg>`;
  host.innerHTML = svg;
  $('#sumInfo').innerHTML =
    `近 ${s.window_used} 期${zone0.name}和值：均值 <b>${s.sum.mean}</b> · 常见区间 <b>${s.sum.p15} ~ ${s.sum.p85}</b> · 最新 <b>${vals[vals.length - 1]}</b>（虚线为均值）`;
}

function distBlock(title, obj, unit = '期') {
  const entries = Object.entries(obj).sort((a, b) => b[1] - a[1]);
  const max = entries.length ? entries[0][1] : 1;
  const blk = el('div', 'dist-block');
  blk.append(el('h3', '', title));
  for (const [k, v] of entries) {
    const row = el('div', 'dist-row');
    row.innerHTML =
      `<span class="dist-label">${k}</span><span class="dist-track"><span class="dist-bar" style="width:${(v / max * 100).toFixed(1)}%"></span></span><span class="dist-val">${v} ${unit}</span>`;
    blk.append(row);
  }
  return blk;
}

function renderShapeDist(s) {
  const host = $('#shapeDist');
  host.innerHTML = '';
  const z0 = GAMES[s.game].zones[0];
  host.append(distBlock(`${z0.name}奇偶比（奇:偶）`, s.odd_even));
  host.append(distBlock(`${z0.name}大小比（大:小，≥${s.big_split} 为大）`, s.big_small));
  host.append(distBlock('连号组数', s.consecutive));
}

/* ---------------- 历史开奖 ---------------- */

async function loadHistory(more = false) {
  const game = state.game;
  const offset = more ? state.hist[game].length : 0;
  try {
    const d = await api(`/api/history?game=${game}&limit=30&offset=${offset}`);
    if (state.game !== game) return;
    state.hist[game] = more ? state.hist[game].concat(d.draws) : d.draws;
    state.histDone[game] = state.hist[game].length >= d.total;
    renderHistoryTab();
  } catch (e) {
    toast(e.message);
  }
}

function renderHistoryTab() {
  const game = state.game;
  const host = $('#histTable');
  host.innerHTML = '';
  const draws = state.hist[game];
  if (!draws.length) { host.innerHTML = '<div class="empty">加载中…</div>'; return; }
  $('#histMeta').textContent = `${GAMES[game].name} · 已加载 ${draws.length} 期`;
  const table = el('table', 'hist');
  table.innerHTML = '<thead><tr><th>期号</th><th>日期</th><th>开奖号码</th><th>一等奖</th><th>奖池</th></tr></thead>';
  const tb = el('tbody');
  for (const d of draws) {
    const tr = el('tr');
    tr.innerHTML = `<td><b>${d.code}</b></td><td>${d.date.slice(5)}</td>`;
    const tdNums = el('td');
    const balls = el('div', 'balls sm');
    for (const z of GAMES[game].zones) {
      for (const n of d.nums[z.key]) balls.append(ballSpan(z.cls, n));
    }
    tdNums.append(balls);
    tr.append(tdNums);
    const first = d.first_count != null
      ? `${d.first_count} 注<br><b>${fmtMoney(d.first_money)}</b>` : '—';
    tr.insertAdjacentHTML('beforeend',
      `<td class="num">${first}</td><td class="num">${d.pool ? fmtMoney(d.pool) : '—'}</td>`);
    tb.append(tr);
  }
  table.append(tb);
  host.append(table);
  $('#btnMoreHistory').hidden = state.histDone[game];
}

/* ---------------- 我的号码 ---------------- */

function renderTickets() {
  $('#ticketCount').textContent = tickets.length ? `${tickets.length} 注` : '';
  const host = $('#ticketList');
  host.innerHTML = '';
  if (!tickets.length) {
    host.innerHTML = '<div class="empty">还没有保存的号码<br><small>在「智能选号」生成后点击「保存」，<br>或在「胆码与排除」里固定喜欢的号码</small></div>';
    return;
  }
  for (const t of tickets) host.append(ticketRow(t));
}

function ticketRow(t) {
  const row = el('div', 'ticket-row');
  const main = el('div', 'ticket-main');
  const meta = el('div', 'ticket-meta');
  meta.innerHTML =
    `<span class="tag tag-${t.game}">${GAMES[t.game].name}</span>` +
    (t.source ? `<span class="src">${t.source}</span>` : '') +
    `<span class="time">${fmtTime(t.time)}</span>`;
  const balls = el('div', 'balls');
  const checking = state.checkInfo && state.checkInfo[t.game];
  for (const z of GAMES[t.game].zones) {
    for (const n of t.nums[z.key]) {
      const b = ballSpan(z.cls, n);
      if (checking && state.checkInfo[t.game].latest.nums[z.key].includes(n)) b.classList.add('hit');
      balls.append(b);
    }
  }
  main.append(meta, balls);

  const ops = el('div', 'ticket-ops');
  if (checking) {
    const draw = state.checkInfo[t.game].latest.nums;
    const m = GAMES[t.game].zones.map(z => t.nums[z.key].filter(n => draw[z.key].includes(n)).length);
    const lv = prizeLevel(t.game, t.nums, draw);
    ops.innerHTML =
      `<span class="prize-badge ${lv ? 'p' + lv : 'miss'}">${lv ? PRIZE_NAME[lv] : '未中奖'}</span>` +
      `<span class="hit-info">中 ${m[0]}+${m[1]}</span>`;
  }
  const copyBtn = el('button', 'icon-btn', '⧉');
  copyBtn.title = '复制';
  copyBtn.addEventListener('click', () => copyText(ticketText(t)));
  const delBtn = el('button', 'icon-btn danger', '✕');
  delBtn.title = '删除';
  delBtn.addEventListener('click', () => {
    tickets = tickets.filter(x => x.id !== t.id);
    saveTickets();
    renderTickets();
  });
  ops.append(copyBtn, delBtn);
  row.append(main, ops);
  return row;
}

async function checkAll() {
  if (!tickets.length) { toast('还没有保存的号码'); return; }
  try {
    const [a, b] = await Promise.all([api('/api/latest?game=ssq'), api('/api/latest?game=dlt')]);
    state.checkInfo = { ssq: a, dlt: b };
    renderTickets();
    const wins = tickets.filter(t =>
      prizeLevel(t.game, t.nums, state.checkInfo[t.game].latest.nums) > 0).length;
    const ssqL = a.latest, dltL = b.latest;
    toast(`双色球 ${ssqL.code} 期 / 大乐透 ${dltL.code} 期 · ${tickets.length} 注中命中 ${wins} 注`);
  } catch (e) {
    toast(e.message);
  }
}

/* ---------------- 设置 ---------------- */

async function openSettings() {
  const m = $('#settingsModal');
  m.hidden = false;
  try {
    const d = await api('/api/settings');
    $('#setBaseUrl').value = d.llm.base_url;
    $('#setModel').value = d.llm.model;
    $('#setKey').value = '';
    $('#keyState').textContent = d.llm.has_key
      ? `已配置密钥（尾号 ${d.llm.key_tail}）` : '未配置密钥，将使用内置统计报告';
  } catch (e) {
    toast(e.message);
  }
}

async function saveSettings() {
  const body = {
    base_url: $('#setBaseUrl').value.trim(),
    model: $('#setModel').value.trim(),
  };
  const key = $('#setKey').value.trim();
  if (key) body.api_key = key;
  try {
    await api('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    toast('设置已保存');
    openSettings();
  } catch (e) {
    toast(e.message);
  }
}

async function testLlm() {
  const btn = $('#setTest');
  btn.disabled = true;
  btn.textContent = '测试中…';
  try {
    const d = await api('/api/llm_test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        base_url: $('#setBaseUrl').value.trim(),
        model: $('#setModel').value.trim(),
        api_key: $('#setKey').value.trim() || undefined,
      }),
    });
    toast('连接成功：' + (d.reply || 'ok'));
  } catch (e) {
    toast('连接失败：' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '测试连接';
  }
}

/* ---------------- 初始化 ---------------- */

function init() {
  const savedGame = localStorage.getItem('pickmuse.game');
  if (GAMES[savedGame]) state.game = savedGame;
  const savedStrategy = localStorage.getItem('pickmuse.strategy');
  if (STRATEGIES[savedStrategy]) state.strategy = savedStrategy;

  $$('#gameSeg button').forEach(b => b.addEventListener('click', () => switchGame(b.dataset.game)));
  $$('#tabBar button').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  $('#windowSel').addEventListener('change', e => {
    state.window = Number(e.target.value);
    localStorage.setItem('pickmuse.window', String(state.window));
    loadData();
  });
  $('#countSel').addEventListener('change', e => {
    state.count = Number(e.target.value);
    localStorage.setItem('pickmuse.count', String(state.count));
  });
  const savedWindow = Number(localStorage.getItem('pickmuse.window'));
  if ([30, 50, 100, 200].includes(savedWindow)) {
    state.window = savedWindow;
    $('#windowSel').value = String(savedWindow);
  }
  const savedCount = Number(localStorage.getItem('pickmuse.count'));
  if ([1, 5, 10].includes(savedCount)) {
    state.count = savedCount;
    $('#countSel').value = String(savedCount);
  }

  $('#btnPredict').addEventListener('click', runPredict);
  $('#btnSaveAll').addEventListener('click', () => {
    const unsaved = state.lastPicks.filter(p => !isSaved(p.id));
    if (!unsaved.length) { toast('没有新的选号可保存'); return; }
    for (const p of unsaved) savePick(p);
    renderPredictResult();
  });
  $('#btnReport').addEventListener('click', runReport);
  $('#btnMoreHistory').addEventListener('click', () => loadHistory(true));
  $('#btnCheckAll').addEventListener('click', checkAll);
  $('#btnCopyAll').addEventListener('click', () => {
    if (!tickets.length) { toast('还没有保存的号码'); return; }
    copyText(tickets.map(ticketText).join('\n'));
  });
  $('#btnClearAll').addEventListener('click', () => {
    if (!tickets.length) { toast('没有可清空的号码'); return; }
    if (confirm('确定清空全部保存的号码吗？')) {
      tickets = [];
      saveTickets();
      renderTickets();
      toast('已清空');
    }
  });

  $('#btnSettings').addEventListener('click', openSettings);
  $('#setClose').addEventListener('click', () => { $('#settingsModal').hidden = true; });
  $('#settingsModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.hidden = true;
  });
  $('#setSave').addEventListener('click', saveSettings);
  $('#setTest').addEventListener('click', testLlm);

  renderStrategies();
  renderPickGrids();
  renderTickets();
  switchGame(state.game);
}

document.addEventListener('DOMContentLoaded', init);
