// Geolocalização + filtro de ruído + stats

export function haversineMeters(a, b){
  const R = 6371000;
  const toRad = (x) => x * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sin1 = Math.sin(dLat/2);
  const sin2 = Math.sin(dLng/2);
  const h = sin1*sin1 + Math.cos(lat1)*Math.cos(lat2)*sin2*sin2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function formatDistance(m){
  if (!Number.isFinite(m)) return '—';
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m/1000).toFixed(2).replace('.', ',')} km`;
}

export function formatDuration(seconds){
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const s = Math.floor(seconds);
  const h = Math.floor(s/3600);
  const m = Math.floor((s%3600)/60);
  const r = s%60;
  if (h > 0) return `${h}h ${String(m).padStart(2,'0')}m`;
  return `${m}m ${String(r).padStart(2,'0')}s`;
}

export function computeJourneyStats(points, opts={}){
  const stopSpeedMps = opts.stopSpeedMps ?? 0.6; // ~2.16 km/h
  const stopWindowSec = opts.stopWindowSec ?? 20;
  if (!points || points.length < 2) {
    return { distanceMeters: 0, movingSeconds: 0, stoppedSeconds: 0, pointsCount: points?.length||0 };
  }
  let dist = 0;
  let moving = 0;
  let stopped = 0;

  for (let i=1;i<points.length;i++){
    const p0 = points[i-1];
    const p1 = points[i];
    const dt = Math.max(0, (p1.ts - p0.ts)/1000);
    const d = haversineMeters({lat:p0.lat, lng:p0.lng},{lat:p1.lat, lng:p1.lng});
    dist += d;

    const speed = Number.isFinite(p1.speed) ? p1.speed : (dt>0 ? d/dt : 0);
    if (speed <= stopSpeedMps && dt >= stopWindowSec/2) stopped += dt;
    else moving += dt;
  }

  return {
    distanceMeters: dist,
    movingSeconds: moving,
    stoppedSeconds: stopped,
    pointsCount: points.length
  };
}

export class GeoTracker {
  watchId = null;
  lastAccepted = null;
  lastAnyTs = 0;

  constructor(opts={}){
    this.opts = {
      highAccuracy: true,
      timeoutMs: 15000,
      maxAgeMs: 2000,
      maxAccuracyM: 50,
      minIntervalMs: 2500,
      minDistanceM: 8,
      maxSpeedKmh: 140,
      ...opts
    };
  }

  isRunning(){
    return this.watchId !== null;
  }

  start(onPoint, onStatus){
    if (!('geolocation' in navigator)) {
      throw new Error('Geolocalização não suportada neste navegador.');
    }
    if (this.watchId !== null) return;

    const success = (pos) => {
      const c = pos.coords;
      const point = {
        lat: c.latitude,
        lng: c.longitude,
        ts: pos.timestamp || Date.now(),
        accuracy: c.accuracy,
        speed: (c.speed === null || c.speed === undefined) ? null : c.speed
      };

      // Atualiza status (mesmo que o ponto seja descartado)
      if (onStatus) {
        onStatus({
          ok: true,
          accuracy: point.accuracy,
          ts: point.ts,
          speedMps: point.speed
        });
      }

      // Filtro básico
      if (!Number.isFinite(point.accuracy) || point.accuracy > this.opts.maxAccuracyM) return;

      // Intervalo mínimo
      if (this.lastAccepted && (point.ts - this.lastAccepted.ts) < this.opts.minIntervalMs) return;

      // Distância mínima
      if (this.lastAccepted) {
        const d = haversineMeters(this.lastAccepted, point);
        if (d < this.opts.minDistanceM) return;

        // Speed sanity check (evitar "pulos")
        const dt = Math.max(0.001, (point.ts - this.lastAccepted.ts)/1000);
        const speedKmh = (d/dt) * 3.6;
        if (speedKmh > this.opts.maxSpeedKmh) return;
      }

      this.lastAccepted = point;
      onPoint(point);
    };

    const failure = (err) => {
      if (onStatus) {
        onStatus({
          ok: false,
          code: err.code,
          message: err.message
        });
      }
    };

    this.watchId = navigator.geolocation.watchPosition(
      success,
      failure,
      {
        enableHighAccuracy: this.opts.highAccuracy,
        timeout: this.opts.timeoutMs,
        maximumAge: this.opts.maxAgeMs
      }
    );
  }

  stop(){
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    this.lastAccepted = null;
  }
}
