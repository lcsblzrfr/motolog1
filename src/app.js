import { DB } from './db.js';
import { GeoTracker, computeJourneyStats, formatDistance, formatDuration, haversineMeters } from './geo.js';
import { brl, rangeForPeriod, sumTransactions, kpis, pct } from './reports.js';
import { qs, qsa, toast, setActiveView, fmtDateTime } from './ui.js';
import { MapView } from './ui.js';

// --------- Utilities ---------
const uid = () => (crypto?.randomUUID ? crypto.randomUUID() : `id_${Date.now()}_${Math.random().toString(16).slice(2)}`);
const nowIsoLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0,16);
};
const parseMoney = (s) => {
  if (s === null || s === undefined) return null;
  const clean = String(s).trim().replaceAll('.', '').replace(',', '.');
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
};

function downloadBlob(filename, blob){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// --------- App State ---------
const db = new DB();
let settings = {
  theme: 'system',
  maxAccuracyM: 50,
  minIntervalMs: 3000,
  minDistanceM: 8,
  maxSpeedKmh: 160
};

let activeJourney = null; // journey object
let activePoints = []; // accepted points {lat,lng,ts,accuracy,speed}
let selectedJourneyId = null;

const geo = new GeoTracker();
const mapView = new MapView();

let wakeLock = null;
let tickTimer = null;

// --------- Init ---------
window.addEventListener('DOMContentLoaded', async () => {
  try{
    await db.open();
    await loadSettings();
    initTheme();
    bindNav();
    bindHome();
    bindFinance();
    bindHistory();
    bindSettings();

    mapView.init('map');

    await hydrateActiveJourney();
    await refreshAll();

    // Default datetime-local
    qs('#txTs').value = nowIsoLocal();

    toast('MotoLog pronto.', 'ok');
  }catch(e){
    console.error(e);
    toast(`Erro ao iniciar: ${e?.message || e}`, 'bad', 5000);
  }
});

async function loadSettings(){
  const theme = await db.get('settings', 'theme');
  const s1 = await db.get('settings', 'maxAccuracyM');
  const s2 = await db.get('settings', 'minIntervalMs');
  const s3 = await db.get('settings', 'minDistanceM');
  const s4 = await db.get('settings', 'maxSpeedKmh');

  settings.theme = theme?.value ?? settings.theme;
  settings.maxAccuracyM = s1?.value ?? settings.maxAccuracyM;
  settings.minIntervalMs = s2?.value ?? settings.minIntervalMs;
  settings.minDistanceM = s3?.value ?? settings.minDistanceM;
  settings.maxSpeedKmh = s4?.value ?? settings.maxSpeedKmh;

  // Reflete nos inputs
  qs('#setMaxAccuracy').value = String(settings.maxAccuracyM);
  qs('#setMinInterval').value = String(Math.round(settings.minIntervalMs/1000));
  qs('#setMinDistance').value = String(settings.minDistanceM);
  qs('#setMaxSpeed').value = String(settings.maxSpeedKmh);

  // Atualiza tracker
  geo.opts.maxAccuracyM = settings.maxAccuracyM;
  geo.opts.minIntervalMs = settings.minIntervalMs;
  geo.opts.minDistanceM = settings.minDistanceM;
  geo.opts.maxSpeedKmh = settings.maxSpeedKmh;
}

function initTheme(){
  const apply = () => {
    const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    const mode = settings.theme === 'system' ? (prefersLight ? 'light' : 'dark') : settings.theme;
    document.documentElement.dataset.theme = (mode === 'light') ? 'light' : 'dark';
    qs('#btnTheme .icon').textContent = (mode === 'light') ? '☀' : '☾';
  };

  apply();
  window.matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', () => {
    if (settings.theme === 'system') apply();
  });

  qs('#btnTheme').addEventListener('click', async () => {
    // alterna entre dark e light (mantendo simples)
    const cur = document.documentElement.dataset.theme;
    const next = (cur === 'light') ? 'dark' : 'light';
    settings.theme = next;
    await db.put('settings', { key:'theme', value: next });
    apply();
    toast(`Tema: ${next}`, 'info');
  });
}

function bindNav(){
  qsa('.tab').forEach(btn => {
    btn.addEventListener('click', async () => {
      const target = btn.dataset.target;
      setActiveView(target);
      if (target === 'finance') await refreshFinance();
      if (target === 'history') await refreshHistory();
      if (target === 'home') await refreshHome();
    });
  });
}

function bindHome(){
  qs('#btnStart').addEventListener('click', startJourney);
  qs('#btnStop').addEventListener('click', stopJourney);
  qs('#btnCenter').addEventListener('click', () => {
    if (activePoints.length) {
      const last = activePoints[activePoints.length-1];
      mapView.panTo([last.lat, last.lng]);
    } else {
      mapView.panTo([-18.9186, -48.2767]);
    }
  });
  qs('#btnWake').addEventListener('click', toggleWakeLock);
}

function bindFinance(){
  // populate categories
  fillTxCategories('income');

  // set txTs default
  qs('#txTs').value = nowIsoLocal();

  qsa('input[name="txType"]').forEach(r => {
    r.addEventListener('change', () => {
      const type = qs('input[name="txType"]:checked').value;
      fillTxCategories(type);
    });
  });

  qs('#txForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    await addTransactionFromForm();
  });

  qs('#rangeSelect').addEventListener('change', refreshFinance);
  qs('#btnCsv').addEventListener('click', exportCsv);
}

function bindHistory(){
  qs('#journeyRange').addEventListener('change', refreshHistory);
  qs('#btnDemo').addEventListener('click', insertDemoData);
  qs('#btnEditJourney').addEventListener('click', editSelectedJourney);
  qs('#btnDeleteJourney').addEventListener('click', deleteSelectedJourney);
}

function bindSettings(){
  qs('#btnSaveSettings').addEventListener('click', saveSettingsFromUI);
  qs('#btnExport').addEventListener('click', exportAll);
  qs('#importFile').addEventListener('change', importAll);
  qs('#btnWipe').addEventListener('click', wipeAll);
}

// --------- Journeys / GPS ---------
async function hydrateActiveJourney(){
  const active = await db.get('settings', 'activeJourneyId');
  const jid = active?.value;
  if (!jid) return;
  const j = await db.get('journeys', jid);
  if (!j || j.endedAt) {
    await db.put('settings', { key:'activeJourneyId', value: null });
    return;
  }
  activeJourney = j;
  activePoints = (await db.getAllByIndex('gpsPoints', 'journeyId', jid)).sort((a,b)=>a.ts-b.ts);

  // desenhar o que já tem
  mapView.drawPolyline(activePoints.map(p=>[p.lat,p.lng]));

  // tenta retomar captura automaticamente
  safeStartTracking();
}

async function startJourney(){
  if (activeJourney) {
    toast('Já existe uma jornada ativa.', 'warn');
    return;
  }
  const j = {
    id: uid(),
    startedAt: Date.now(),
    endedAt: null,
    name: '',
    notes: '',
    stats: {
      distanceMeters: 0,
      movingSeconds: 0,
      stoppedSeconds: 0,
      pointsCount: 0
    }
  };
  await db.put('journeys', j);
  await db.put('settings', { key:'activeJourneyId', value: j.id });
  activeJourney = j;
  activePoints = [];

  mapView.drawPolyline([]);

  safeStartTracking();
  startTick();

  await refreshAll();
  toast('Jornada iniciada.', 'ok');
}

function safeStartTracking(){
  try{
    geo.opts.maxAccuracyM = settings.maxAccuracyM;
    geo.opts.minIntervalMs = settings.minIntervalMs;
    geo.opts.minDistanceM = settings.minDistanceM;
    geo.opts.maxSpeedKmh = settings.maxSpeedKmh;

    if (!geo.isRunning()) {
      geo.start(onGeoPoint, onGeoStatus);
      startTick();
    }
  }catch(e){
    toast(e.message || 'Falha ao iniciar GPS.', 'bad');
  }
}

async function onGeoPoint(point){
  if (!activeJourney) return;
  const rec = { id: uid(), journeyId: activeJourney.id, ...point };
  await db.add('gpsPoints', rec);
  activePoints.push(rec);

  // Atualiza mapa
  mapView.drawPolyline(activePoints.map(p=>[p.lat,p.lng]));

  // Atualiza métricas ao vivo (incremental)
  updateLiveMetrics();
}

function onGeoStatus(s){
  if (!s.ok) {
    const msg = (s.code === 1) ? 'Permissão de localização negada.'
      : (s.code === 2) ? 'Localização indisponível.'
      : (s.code === 3) ? 'Tempo esgotado ao obter localização.'
      : (s.message || 'Erro de localização.');
    qs('#gpsLive').textContent = `GPS: ${msg}`;
    return;
  }
  const acc = Number.isFinite(s.accuracy) ? `${Math.round(s.accuracy)}m` : '—';
  const sp = Number.isFinite(s.speedMps) ? `${Math.round(s.speedMps*3.6)} km/h` : '—';
  qs('#gpsLive').textContent = `GPS: ok | precisão ${acc} | vel ${sp}`;
}

async function stopJourney(){
  if (!activeJourney) {
    toast('Nenhuma jornada ativa.', 'warn');
    return;
  }

  // Para GPS
  geo.stop();
  stopTick();

  // Finaliza e computa stats
  const endedAt = Date.now();
  const jid = activeJourney.id;

  const points = (await db.getAllByIndex('gpsPoints', 'journeyId', jid)).sort((a,b)=>a.ts-b.ts);
  const stats = computeJourneyStats(points);

  const updated = {
    ...activeJourney,
    endedAt,
    stats
  };
  await db.put('journeys', updated);
  await db.put('settings', { key:'activeJourneyId', value: null });

  activeJourney = null;
  activePoints = [];
  mapView.drawPolyline([]);

  await refreshAll();
  toast('Jornada salva.', 'ok');
}

function startTick(){
  if (tickTimer) return;
  tickTimer = setInterval(updateLiveMetrics, 1000);
}

function stopTick(){
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
}

function updateLiveMetrics(){
  // botões
  qs('#btnStart').disabled = !!activeJourney;
  qs('#btnStop').disabled = !activeJourney;

  if (!activeJourney) {
    qs('#shiftStatus').textContent = 'Sem jornada ativa.';
    qs('#pointsLive').textContent = 'Pontos: 0';
    qs('#distLive').textContent = 'Distância: 0 m';
    qs('#timeLive').textContent = 'Tempo: 0:00';
    return;
  }

  const pts = activePoints;
  let dist = 0;
  for (let i=1;i<pts.length;i++){
    dist += haversineMeters(pts[i-1], pts[i]);
  }
  const elapsed = Math.max(0, (Date.now() - activeJourney.startedAt)/1000);

  qs('#shiftStatus').textContent = `Jornada ativa desde ${fmtDateTime(activeJourney.startedAt)}${geo.isRunning() ? ' (capturando GPS)' : ' (GPS pausado)'}`;
  qs('#pointsLive').textContent = `Pontos: ${pts.length}`;
  qs('#distLive').textContent = `Distância: ${formatDistance(dist)}`;
  qs('#timeLive').textContent = `Tempo: ${formatDuration(elapsed)}`;
}

// --------- Finance ---------
const INCOME_SOURCES = ['Uber', '99', 'Dinheiro', 'Pix', 'Outros'];
const EXPENSE_CATS = ['Combustível', 'Manutenção', 'Óleo', 'Pneus', 'Lavagem', 'Taxa/App', 'Alimentação', 'Equipamentos', 'Multas', 'Outros'];

function fillTxCategories(type){
  const sel = qs('#txCategory');
  sel.innerHTML = '';
  const label = qs('#txLabelCat');
  if (type === 'income') {
    label.textContent = 'Fonte';
    for (const s of INCOME_SOURCES) {
      const o = document.createElement('option');
      o.value = s; o.textContent = s;
      sel.appendChild(o);
    }
  } else {
    label.textContent = 'Categoria';
    for (const s of EXPENSE_CATS) {
      const o = document.createElement('option');
      o.value = s; o.textContent = s;
      sel.appendChild(o);
    }
  }
}

async function refreshTxJourneySelect(){
  const sel = qs('#txJourney');
  const journeys = await db.getAll('journeys');
  const ordered = journeys.slice().sort((a,b)=>b.startedAt-a.startedAt);

  sel.innerHTML = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = '— (não vincular)';
  sel.appendChild(none);

  for (const j of ordered.slice(0,50)) {
    const o = document.createElement('option');
    o.value = j.id;
    const date = new Date(j.startedAt).toLocaleDateString('pt-BR');
    const km = (j.stats?.distanceMeters||0)/1000;
    o.textContent = `${date} • ${(km).toFixed(1).replace('.',',')} km`;
    if (activeJourney && j.id === activeJourney.id) o.textContent += ' (ativa)';
    sel.appendChild(o);
  }
}

async function addTransactionFromForm(){
  const type = qs('input[name="txType"]:checked').value;
  const amount = parseMoney(qs('#txAmount').value);
  if (!amount || amount <= 0) {
    toast('Informe um valor válido.', 'warn');
    return;
  }
  const tsVal = qs('#txTs').value;
  const ts = tsVal ? new Date(tsVal).getTime() : Date.now();
  const category = qs('#txCategory').value;
  const journeyId = qs('#txJourney').value || null;
  const notes = qs('#txNotes').value?.trim() || '';

  const tx = {
    id: uid(),
    type,
    amount,
    category,
    ts,
    notes,
    journeyId
  };

  await db.put('transactions', tx);

  // reset fields (mantém data)
  qs('#txAmount').value = '';
  qs('#txNotes').value = '';

  toast('Lançamento salvo.', 'ok');
  await refreshFinance();
  await refreshHome();
}

async function refreshFinance(){
  await refreshTxJourneySelect();

  const rangeKey = qs('#rangeSelect').value;
  const range = rangeKey === 'week' ? rangeForPeriod('7d')
    : rangeKey === 'month' ? rangeForPeriod('30d')
    : rangeKey === 'year' ? rangeForPeriod('year')
    : rangeKey === 'all' ? rangeForPeriod('all')
    : rangeForPeriod('today');

  const txs = await db.getAll('transactions');
  const { income, expense, profit, items } = sumTransactions(txs, range);

  qs('#sumIncome').textContent = brl(income);
  qs('#sumExpense').textContent = brl(expense);
  qs('#sumProfit').textContent = brl(profit);

  // Lista
  const list = items.sort((a,b)=>b.ts-a.ts).slice(0,60);
  qs('#txList').innerHTML = list.length ? list.map(renderTxRow).join('') : `<div class="empty">Sem lançamentos neste período.</div>`;

  // deletar transação
  qsa('[data-tx-del]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-tx-del');
      if (!confirm('Apagar este lançamento?')) return;
      await db.del('transactions', id);
      toast('Lançamento apagado.', 'info');
      await refreshFinance();
      await refreshHome();
    });
  });
}

function renderTxRow(t){
  const sign = t.type === 'income' ? '+' : '-';
  const cls = t.type === 'income' ? 'good' : 'bad';
  const d = new Date(t.ts).toLocaleString('pt-BR', { dateStyle:'short', timeStyle:'short' });
  const j = t.journeyId ? `<div class="tiny muted">Jornada: ${t.journeyId.slice(0,6)}…</div>` : '';
  const note = t.notes ? `<div class="tiny muted">${escapeHtml(t.notes)}</div>` : '';
  return `
    <div class="row between list-item">
      <div>
        <div class="strong">${escapeHtml(t.category)}</div>
        <div class="tiny muted">${d}</div>
        ${note}
        ${j}
      </div>
      <div class="tx-right">
        <div class="strong ${cls}">${sign} ${brl(t.amount)}</div>
        <button class="mini danger" data-tx-del="${t.id}" title="Apagar">✕</button>
      </div>
    </div>
  `;
}

function escapeHtml(s){
  return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
}

async function exportCsv(){
  const txs = await db.getAll('transactions');
  const header = ['id','type','amount','category','ts','datetime','notes','journeyId'];
  const rows = txs.sort((a,b)=>a.ts-b.ts).map(t => {
    const dt = new Date(t.ts).toLocaleString('pt-BR');
    const vals = [
      t.id,
      t.type,
      String(t.amount).replace('.',','),
      t.category,
      String(t.ts),
      dt,
      (t.notes||'').replaceAll('\n',' ').replaceAll(';',','),
      t.journeyId||''
    ];
    return vals.map(v => `"${String(v).replaceAll('"','""')}"`).join(';');
  });
  const csv = [header.join(';'), ...rows].join('\n');
  downloadBlob(`motolog-transacoes-${new Date().toISOString().slice(0,10)}.csv`, new Blob([csv], {type:'text/csv;charset=utf-8'}));
  toast('CSV exportado.', 'ok');
}

// --------- History ---------
async function refreshHistory(){
  const rangeKey = qs('#journeyRange').value;
  const range = rangeKey === 'week' ? rangeForPeriod('7d')
    : rangeKey === 'month' ? rangeForPeriod('30d')
    : rangeKey === 'year' ? rangeForPeriod('year')
    : rangeForPeriod('all');

  const journeys = (await db.getAll('journeys')).filter(j => j.startedAt >= range.from && j.startedAt <= range.to);
  journeys.sort((a,b)=>b.startedAt-a.startedAt);

  qs('#journeyList').innerHTML = journeys.length ? journeys.map(renderJourneyRow).join('') : `<div class="empty">Sem jornadas neste período.</div>`;

  qsa('[data-journey-open]').forEach(el => {
    el.addEventListener('click', async () => {
      const id = el.getAttribute('data-journey-open');
      await openJourney(id);
    });
  });
}

function renderJourneyRow(j){
  const date = new Date(j.startedAt).toLocaleDateString('pt-BR');
  const time = new Date(j.startedAt).toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'});
  const km = (j.stats?.distanceMeters||0)/1000;
  const dur = formatDuration((j.stats?.movingSeconds||0) + (j.stats?.stoppedSeconds||0));
  const active = activeJourney && j.id === activeJourney.id ? ' (ativa)' : '';
  return `
    <button class="list-item btnlike" data-journey-open="${j.id}">
      <div class="row between">
        <div>
          <div class="strong">${date} • ${time}${active}</div>
          <div class="tiny muted">${km.toFixed(2).replace('.',',')} km • ${dur} • ${j.stats?.pointsCount||0} pts</div>
        </div>
        <div class="chev">›</div>
      </div>
    </button>
  `;
}

async function openJourney(jid){
  selectedJourneyId = jid;
  const j = await db.get('journeys', jid);
  const points = (await db.getAllByIndex('gpsPoints','journeyId',jid)).sort((a,b)=>a.ts-b.ts);
  const km = (j.stats?.distanceMeters||0)/1000;
  const dur = formatDuration((j.stats?.movingSeconds||0) + (j.stats?.stoppedSeconds||0));
  const mov = formatDuration(j.stats?.movingSeconds||0);
  const stop = formatDuration(j.stats?.stoppedSeconds||0);

  qs('#journeyDetails').innerHTML = `
    <div class="strong">${new Date(j.startedAt).toLocaleString('pt-BR', {dateStyle:'full', timeStyle:'short'})}</div>
    <div class="tiny muted">ID: ${jid}</div>
    <div class="divider"></div>
    <div class="row between"><span class="muted">Distância</span><span class="strong">${km.toFixed(2).replace('.',',')} km</span></div>
    <div class="row between"><span class="muted">Duração</span><span class="strong">${dur}</span></div>
    <div class="row between"><span class="muted">Em movimento</span><span class="strong">${mov}</span></div>
    <div class="row between"><span class="muted">Parado</span><span class="strong">${stop}</span></div>
    <div class="row between"><span class="muted">Pontos</span><span class="strong">${points.length}</span></div>
    ${j.name ? `<div class="divider"></div><div class="tiny muted">Nome: ${escapeHtml(j.name)}</div>` : ''}
    ${j.notes ? `<div class="tiny muted">Obs.: ${escapeHtml(j.notes)}</div>` : ''}
    <div class="divider"></div>
    <div class="tiny muted">Dica: volte para a aba Início para ver o mapa. Ao selecionar uma jornada, o mapa mostrará o trajeto.</div>
  `;

  // desenha no mapa (na Home)
  mapView.drawPolyline(points.map(p=>[p.lat,p.lng]));

  qs('#btnEditJourney').disabled = false;
  qs('#btnDeleteJourney').disabled = false;

  toast('Trajeto carregado no mapa.', 'info');
}

async function editSelectedJourney(){
  if (!selectedJourneyId) return;
  const j = await db.get('journeys', selectedJourneyId);
  const name = prompt('Nome da jornada (opcional):', j.name||'');
  if (name === null) return;
  const notes = prompt('Observações (opcional):', j.notes||'');
  if (notes === null) return;
  await db.put('journeys', { ...j, name: name.trim(), notes: notes.trim() });
  toast('Jornada atualizada.', 'ok');
  await refreshHistory();
  await refreshTxJourneySelect();
}

async function deleteSelectedJourney(){
  if (!selectedJourneyId) return;
  if (!confirm('Apagar esta jornada e todos os pontos? Essa ação não pode ser desfeita.')) return;
  const jid = selectedJourneyId;

  // Se for ativa, bloqueia
  if (activeJourney && activeJourney.id === jid) {
    toast('Não é possível apagar a jornada ativa. Pare e salve primeiro.', 'warn');
    return;
  }

  const pts = await db.getAllByIndex('gpsPoints','journeyId',jid);
  await db.del('journeys', jid);
  // apaga pontos (um a um)
  for (const p of pts) await db.del('gpsPoints', p.id);

  selectedJourneyId = null;
  qs('#journeyDetails').textContent = 'Selecione uma jornada no painel ao lado.';
  qs('#btnEditJourney').disabled = true;
  qs('#btnDeleteJourney').disabled = true;

  mapView.drawPolyline([]);

  toast('Jornada apagada.', 'info');
  await refreshHistory();
  await refreshHome();
  await refreshTxJourneySelect();
}

// --------- Settings / Backup ---------
async function saveSettingsFromUI(){
  const maxAcc = Number(qs('#setMaxAccuracy').value);
  const minIntSec = Number(qs('#setMinInterval').value);
  const minDist = Number(qs('#setMinDistance').value);
  const maxSp = Number(qs('#setMaxSpeed').value);

  if (!Number.isFinite(maxAcc) || maxAcc < 5 || maxAcc > 500) return toast('Precisão inválida.', 'warn');
  if (!Number.isFinite(minIntSec) || minIntSec < 1 || minIntSec > 60) return toast('Intervalo inválido.', 'warn');
  if (!Number.isFinite(minDist) || minDist < 1 || minDist > 200) return toast('Distância mínima inválida.', 'warn');
  if (!Number.isFinite(maxSp) || maxSp < 20 || maxSp > 300) return toast('Velocidade máx. inválida.', 'warn');

  settings.maxAccuracyM = Math.round(maxAcc);
  settings.minIntervalMs = Math.round(minIntSec*1000);
  settings.minDistanceM = Math.round(minDist);
  settings.maxSpeedKmh = Math.round(maxSp);

  await db.put('settings', { key:'maxAccuracyM', value: settings.maxAccuracyM });
  await db.put('settings', { key:'minIntervalMs', value: settings.minIntervalMs });
  await db.put('settings', { key:'minDistanceM', value: settings.minDistanceM });
  await db.put('settings', { key:'maxSpeedKmh', value: settings.maxSpeedKmh });

  geo.opts.maxAccuracyM = settings.maxAccuracyM;
  geo.opts.minIntervalMs = settings.minIntervalMs;
  geo.opts.minDistanceM = settings.minDistanceM;
  geo.opts.maxSpeedKmh = settings.maxSpeedKmh;

  toast('Configurações salvas.', 'ok');
}

async function exportAll(){
  const payload = {
    version: '1.0.0',
    exportedAt: Date.now(),
    journeys: await db.getAll('journeys'),
    gpsPoints: await db.getAll('gpsPoints'),
    transactions: await db.getAll('transactions'),
    settings: await db.getAll('settings')
  };
  const json = JSON.stringify(payload, null, 2);
  downloadBlob(`motolog-backup-${new Date().toISOString().slice(0,10)}.json`, new Blob([json], {type:'application/json'}));
  toast('Backup JSON exportado.', 'ok');
}

async function importAll(e){
  const file = e.target.files?.[0];
  if (!file) return;
  try{
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.journeys) || !Array.isArray(data.gpsPoints) || !Array.isArray(data.transactions)) {
      toast('Arquivo inválido.', 'bad');
      return;
    }

    const mode = prompt('Importar como? Digite: MESCLAR ou SUBSTITUIR', 'MESCLAR');
    if (!mode) return;
    const m = mode.trim().toLowerCase();

    if (m.startsWith('sub')) {
      await db.clear('journeys');
      await db.clear('gpsPoints');
      await db.clear('transactions');
      // settings: mantém theme? vamos limpar e reinserir
      await db.clear('settings');
    }

    await db.bulkPut('journeys', data.journeys);
    await db.bulkPut('gpsPoints', data.gpsPoints);
    await db.bulkPut('transactions', data.transactions);
    if (Array.isArray(data.settings)) {
      await db.bulkPut('settings', data.settings);
    }

    await loadSettings();
    await hydrateActiveJourney();
    await refreshAll();

    toast('Importação concluída.', 'ok');
  }catch(err){
    console.error(err);
    toast('Falha ao importar JSON.', 'bad');
  } finally {
    e.target.value = '';
  }
}

async function wipeAll(){
  if (!confirm('Apagar TODOS os dados (jornadas, pontos e financeiro)?')) return;
  geo.stop();
  stopTick();
  activeJourney = null;
  activePoints = [];
  selectedJourneyId = null;
  await db.clear('journeys');
  await db.clear('gpsPoints');
  await db.clear('transactions');
  await db.clear('settings');
  mapView.drawPolyline([]);
  await loadSettings();
  await refreshAll();
  toast('Dados apagados.', 'info');
}

// --------- Wake Lock ---------
async function toggleWakeLock(){
  const btn = qs('#btnWake');
  if (!('wakeLock' in navigator)) {
    toast('Wake Lock não disponível neste navegador.', 'warn');
    return;
  }
  try{
    if (!wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      btn.dataset.state = 'on';
      btn.textContent = 'Tela ativa: ligada';
      toast('Tela ativa ligada.', 'ok');
      wakeLock.addEventListener('release', () => {
        wakeLock = null;
        btn.dataset.state = 'off';
        btn.textContent = 'Manter tela ativa';
      });
    } else {
      await wakeLock.release();
      wakeLock = null;
      btn.dataset.state = 'off';
      btn.textContent = 'Manter tela ativa';
      toast('Tela ativa desligada.', 'info');
    }
  }catch(e){
    toast('Não foi possível manter tela ativa.', 'warn');
  }
}

// --------- Home KPI ---------
async function refreshHome(){
  // Resumo hoje: financeiro + km do dia
  const txs = await db.getAll('transactions');
  const today = rangeForPeriod('today');
  const { income, expense, profit } = sumTransactions(txs, today);

  // Distância do dia: soma jornadas iniciadas hoje
  const journeys = await db.getAll('journeys');
  const jToday = journeys.filter(j => j.startedAt >= today.from && j.startedAt <= today.to);
  const dist = jToday.reduce((acc, j) => acc + (j.stats?.distanceMeters||0), 0);
  const moving = jToday.reduce((acc, j) => acc + (j.stats?.movingSeconds||0), 0);
  const stop = jToday.reduce((acc, j) => acc + (j.stats?.stoppedSeconds||0), 0);

  const { revPerKm, costPerKm, profitPerKm, revPerH, profitPerH } = kpis({income, expense, profit, distanceMeters: dist, movingSeconds: moving});

  qs('#kpiIncome').textContent = brl(income);
  qs('#kpiExpense').textContent = brl(expense);
  qs('#kpiProfit').textContent = brl(profit);
  qs('#kpiKm').textContent = `${(dist/1000).toFixed(1).replace('.',',')} km`;

  qs('#kpiRpk').textContent = revPerKm === null ? '—' : brl(revPerKm);
  qs('#kpiCpk').textContent = costPerKm === null ? '—' : brl(costPerKm);

  // custo/h: usando tempo em movimento+parado como aproximação
  const totalH = ((moving+stop)||0)/3600;
  const revH = totalH>0 ? income/totalH : null;
  const costH = totalH>0 ? expense/totalH : null;

  qs('#kpiRph').textContent = revH === null ? '—' : brl(revH);
  qs('#kpiCph').textContent = costH === null ? '—' : brl(costH);

  updateLiveMetrics();
}

async function refreshAll(){
  await refreshTxJourneySelect();
  await refreshHome();
  await refreshFinance();
  await refreshHistory();
}

// --------- Demo Data ---------
async function insertDemoData(){
  if (!confirm('Inserir dados de demonstração (jornadas + lançamentos)?')) return;

  // Não poluir muito: insere 2 jornadas
  const base = { lat: -18.9186, lng: -48.2767 };
  const makePath = (seed, km=6) => {
    const pts = [];
    let lat = base.lat + (Math.sin(seed)*0.01);
    let lng = base.lng + (Math.cos(seed)*0.01);
    const steps = 80;
    const dt = 4000;
    let ts = Date.now() - seed*86400000;
    for (let i=0;i<steps;i++){
      lat += (Math.sin((i+seed)/7) * 0.00035);
      lng += (Math.cos((i+seed)/8) * 0.00035);
      pts.push({lat, lng, ts: ts + i*dt, accuracy: 12 + (i%7), speed: 6 + (i%5)});
    }
    return pts;
  };

  const journeys = [];
  const pointsAll = [];
  for (const dayOffset of [1, 3]) {
    const j = {
      id: uid(),
      startedAt: Date.now() - dayOffset*86400000 + 7*3600000,
      endedAt: Date.now() - dayOffset*86400000 + 10*3600000,
      name: dayOffset===1 ? 'Demo (manhã)' : 'Demo (tarde)',
      notes: 'Trajeto fictício para teste.',
      stats: { distanceMeters: 0, movingSeconds: 0, stoppedSeconds: 0, pointsCount: 0 }
    };
    const pts = makePath(dayOffset);
    const stats = computeJourneyStats(pts);
    j.stats = stats;
    journeys.push(j);
    for (const p of pts) pointsAll.push({ id: uid(), journeyId: j.id, ...p });
  }

  const txs = [
    { id: uid(), type:'income', amount: 180.50, category:'Uber', ts: Date.now()-86400000*1 + 10*3600000, notes:'Demo', journeyId: journeys[0].id },
    { id: uid(), type:'expense', amount: 45.00, category:'Combustível', ts: Date.now()-86400000*1 + 10*3600000 + 60000, notes:'Demo', journeyId: journeys[0].id },
    { id: uid(), type:'income', amount: 140.00, category:'99', ts: Date.now()-86400000*3 + 18*3600000, notes:'Demo', journeyId: journeys[1].id },
    { id: uid(), type:'expense', amount: 25.00, category:'Lavagem', ts: Date.now()-86400000*3 + 18*3600000 + 60000, notes:'Demo', journeyId: null }
  ];

  await db.bulkPut('journeys', journeys);
  await db.bulkPut('gpsPoints', pointsAll);
  await db.bulkPut('transactions', txs);

  toast('Dados demo inseridos.', 'ok');
  await refreshAll();
}
