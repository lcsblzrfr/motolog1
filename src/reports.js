export function brl(v){
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
}

export function clampNumber(v, min, max){
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

export function startOfDay(ts){
  const d = new Date(ts);
  d.setHours(0,0,0,0);
  return d.getTime();
}

export function endOfDay(ts){
  const d = new Date(ts);
  d.setHours(23,59,59,999);
  return d.getTime();
}

export function rangeForPeriod(period){
  const now = Date.now();
  const day = 86400000;
  switch(period){
    case 'today': {
      return { from: startOfDay(now), to: endOfDay(now) };
    }
    case '7d': {
      return { from: now - 6*day, to: now };
    }
    case '30d': {
      return { from: now - 29*day, to: now };
    }
    case '90d': {
      return { from: now - 89*day, to: now };
    }
    case 'year': {
      return { from: now - 364*day, to: now };
    }
    default:
      return { from: 0, to: now };
  }
}

export function sumTransactions(transactions, range){
  const from = range?.from ?? 0;
  const to = range?.to ?? Infinity;
  let income = 0;
  let expense = 0;
  const items = [];
  for (const t of (transactions||[])){
    if (t.ts < from || t.ts > to) continue;
    items.push(t);
    if (t.type === 'income') income += Number(t.amount)||0;
    else if (t.type === 'expense') expense += Number(t.amount)||0;
  }
  const profit = income - expense;
  return { income, expense, profit, items };
}

export function kpis({income, expense, profit, distanceMeters, movingSeconds}){
  const km = (Number(distanceMeters)||0) / 1000;
  const h = (Number(movingSeconds)||0) / 3600;
  const revPerKm = km > 0 ? income / km : null;
  const costPerKm = km > 0 ? expense / km : null;
  const profitPerKm = km > 0 ? profit / km : null;
  const revPerH = h > 0 ? income / h : null;
  const profitPerH = h > 0 ? profit / h : null;
  const margin = income > 0 ? (profit / income) : null;
  return { km, h, revPerKm, costPerKm, profitPerKm, revPerH, profitPerH, margin };
}

export function pct(v){
  if (!Number.isFinite(v)) return '—';
  return `${(v*100).toFixed(0)}%`;
}
