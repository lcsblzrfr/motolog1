export function qs(sel, root=document){ return root.querySelector(sel); }
export function qsa(sel, root=document){ return Array.from(root.querySelectorAll(sel)); }

export function toast(msg, type='info', ms=2400){
  const el = qs('#toast');
  if (!el) return;
  el.textContent = msg;
  el.dataset.type = type;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), ms);
}

export function setText(id, txt){
  const el = qs(id);
  if (el) el.textContent = txt;
}

export function setHTML(id, html){
  const el = qs(id);
  if (el) el.innerHTML = html;
}

export function setDisabled(id, disabled){
  const el = qs(id);
  if (el) el.disabled = !!disabled;
}

export function fmtDateTime(ts){
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString('pt-BR', { dateStyle:'short', timeStyle:'short' });
}

export function fmtTime(ts){
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
}

export function setActiveView(viewId){
  qsa('.view').forEach(v => v.classList.remove('active'));
  const view = qs(`#view-${viewId}`);
  if (view) view.classList.add('active');

  qsa('.tab').forEach(t => t.classList.remove('active'));
  const tab = qs(`#tab-${viewId}`);
  if (tab) tab.classList.add('active');
}

// Map wrapper (Leaflet)
export class MapView {
  /** @type {import('leaflet').Map|null} */
  map = null;
  poly = null;
  startMarker = null;
  endMarker = null;

  init(containerId){
    // Leaflet é global (L)
    this.map = L.map(containerId, { zoomControl: true });
    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    });
    osm.addTo(this.map);

    // Uberlândia (aprox.) como default
    this.map.setView([-18.9186, -48.2767], 13);
  }

  reset(){
    if (!this.map) return;
    if (this.poly) { this.map.removeLayer(this.poly); this.poly = null; }
    if (this.startMarker) { this.map.removeLayer(this.startMarker); this.startMarker = null; }
    if (this.endMarker) { this.map.removeLayer(this.endMarker); this.endMarker = null; }
  }

  drawPolyline(latlngs){
    if (!this.map) return;
    if (!latlngs || latlngs.length === 0) {
      this.reset();
      return;
    }

    if (!this.poly) {
      this.poly = L.polyline(latlngs, { weight: 5 });
      this.poly.addTo(this.map);
    } else {
      this.poly.setLatLngs(latlngs);
    }

    const first = latlngs[0];
    const last = latlngs[latlngs.length-1];

    if (!this.startMarker) {
      this.startMarker = L.marker(first);
      this.startMarker.addTo(this.map);
    } else {
      this.startMarker.setLatLng(first);
    }

    if (!this.endMarker) {
      this.endMarker = L.marker(last);
      this.endMarker.addTo(this.map);
    } else {
      this.endMarker.setLatLng(last);
    }

    // Ajusta bounds com folga
    try{
      const b = this.poly.getBounds();
      this.map.fitBounds(b.pad(0.25));
    }catch(_){/* ignore */}
  }

  panTo(latlng){
    if (!this.map) return;
    this.map.panTo(latlng);
  }
}
