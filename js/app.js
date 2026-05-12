// ============================================================
//  FireCoord — Main Application Logic
// ============================================================

let map, routeMap;
let fireMarkers = {}, teamMarkers = {}, fireCircles = {}, routeLayer = null;
let simInterval = null;
let clockInterval = null;
let moveTick = 0;

// Route planner state — 3 route options (safe / balanced / fast)
let _routeOptions  = {};
let _activeRouteKey = 'safe';
let _routeCtx = null; // { team, fire, score }

const _fireSectionOpen = { active: true, pending: true, ext: false };
const EQUIP_LIST = ['maske', 'hortum', 'söndürücü', 'telsiz', 'ilk yardım çantası'];
const VEHICLES = [
  { id: 'V001', type: 'Yangın Söndürme Aracı' },
  { id: 'V002', type: 'Yangın Söndürme Aracı' },
  { id: 'V003', type: 'Yangın Söndürme Aracı' },
  { id: 'V004', type: 'Merdivenli Yangın Söndürme Aracı' },
  { id: 'V005', type: 'Yangın Söndürme Aracı' },
  { id: 'V006', type: 'Merdivenli Yangın Söndürme Aracı' },
  { id: 'V007', type: 'Yangın Söndürme Aracı' },
  { id: 'V008', type: 'Merdivenli Yangın Söndürme Aracı' },
];

function getMyTeams() {
  const user = AppState.currentUser;
  if (!user) return [];
  return AppState.teams.filter(t => t.chiefUserId === user.id);
}

// ---- INIT ----
document.addEventListener('DOMContentLoaded', () => {
  const raw = sessionStorage.getItem('fc_user');
  if (!raw) { window.location.href = 'index.html'; return; }
  AppState.currentUser = JSON.parse(raw);

  document.getElementById('userNameDisplay').textContent = AppState.currentUser.name;
  document.getElementById('userRoleDisplay').textContent = roleLabel(AppState.currentUser.role);

  initMap();
  initRoutemap();
  startClock();
  RoleBasedController.applyUI();
  initFirebaseListeners();
  startTeamMovement();
  addLog('Sistem başlatıldı. Firebase bağlantısı kuruldu.', 'success');
  OfflineCacheManager.init();
  setInterval(() => OfflineCacheManager.cacheState(), 30000);
});

// ---- CLOCK ----
function startClock() {
  function tick() {
    const now = new Date();
    document.getElementById('clock').textContent =
      now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  tick();
  clockInterval = setInterval(tick, 1000);
}

// ---- NAVIGATION ----
function navTo(panel) {
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(el => el.classList.remove('active'));
  document.querySelector('[data-panel="' + panel + '"]').classList.add('active');
  document.getElementById('panel-' + panel).classList.add('active');

  if (panel === 'map') setTimeout(() => { if (map) map.invalidateSize(); }, 100);
  if (panel === 'route') setTimeout(() => { if (routeMap) routeMap.invalidateSize(); }, 100);
  if (panel === 'fires') renderFires();
  if (panel === 'teams') renderTeams();
  if (panel === 'route') renderRoute();
  if (panel === 'mgmt') renderMgmt();
  if (panel === 'task') renderTaskPanel();
}

// ---- MAP INIT ----
function initMap() {
  map = L.map('map', { zoomControl: true }).setView([39.9208, 32.8700], 13);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap contributors, © CARTO',
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(map);

  map.on('click', e => {
    if (document.getElementById('addFireMode').dataset.active === 'true') {
      addNewFire(e.latlng.lat, e.latlng.lng);
    }
  });

  renderMapMarkers();
}

function initRoutemap() {
  routeMap = L.map('routeMap', { zoomControl: false }).setView([39.9208, 32.8700], 12);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap contributors, © CARTO',
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(routeMap);
}

// ---- MAP MARKERS ----
const fireIcon = L.divIcon({
  className: '',
  html: '<div style="font-size:22px;text-shadow:0 0 8px #e63946;filter:drop-shadow(0 0 6px #e63946)">🔥</div>',
  iconSize: [30, 30], iconAnchor: [15, 15]
});

const teamIcons = {
  available: L.divIcon({ className: '', html: '<div style="font-size:20px;filter:drop-shadow(0 0 4px #3fb950)">🚒</div>', iconSize: [28, 28], iconAnchor: [14, 14] }),
  on_duty: L.divIcon({ className: '', html: '<div style="font-size:20px;filter:drop-shadow(0 0 4px #d29922)">🚒</div>', iconSize: [28, 28], iconAnchor: [14, 14] }),
  on_route: L.divIcon({ className: '', html: '<div style="font-size:20px;filter:drop-shadow(0 0 4px #58a6ff)">🚒</div>', iconSize: [28, 28], iconAnchor: [14, 14] }),
  maintenance: L.divIcon({ className: '', html: '<div style="font-size:20px;filter:drop-shadow(0 0 4px #6e7681)">🚒</div>', iconSize: [28, 28], iconAnchor: [14, 14] })
};

function renderMapMarkers() {
  if (!map) return;

  // Fires
  AppState.fires.forEach(fire => {
    if (fireMarkers[fire.id]) { try { fireMarkers[fire.id].remove(); } catch(e) {} }
    if (fireCircles[fire.id]) { fireCircles[fire.id].forEach(c => { try { c.remove(); } catch(e) {} }); }

    if (fire.status === 'extinguished') return;
    if (!fire.lat || !fire.lng || isNaN(fire.lat) || isNaN(fire.lng)) return;

    try {
      const marker = L.marker([fire.lat, fire.lng], { icon: fireIcon }).addTo(map);
      marker.bindPopup(firePopupHTML(fire));
      fireMarkers[fire.id] = marker;

      const circles = [
        L.circle([fire.lat, fire.lng], { color: '#e63946', fillColor: '#e63946', fillOpacity: 0.18, radius: fire.radius || 100, weight: 1.5 }).addTo(map),
        L.circle([fire.lat, fire.lng], { color: '#e63946', fillColor: 'transparent', fillOpacity: 0, radius: (fire.radius || 100) * 1.6, weight: 1, dashArray: '6 4', opacity: 0.4 }).addTo(map)
      ];
      fireCircles[fire.id] = circles;
    } catch(e) { console.error('Fire marker error:', fire.id, e); }
  });

  // Teams
  AppState.teams.forEach(team => {
    if (teamMarkers[team.id]) { try { teamMarkers[team.id].remove(); } catch(e) {} }
    if (!team.lat || !team.lng || isNaN(team.lat) || isNaN(team.lng)) return;

    try {
      const icon = teamIcons[team.status] || teamIcons.available;
      const marker = L.marker([team.lat, team.lng], { icon }).addTo(map);
      marker.bindPopup(teamPopupHTML(team));
      teamMarkers[team.id] = marker;
    } catch(e) { console.error('Team marker error:', team.id, e); }
  });
}

function updateMapCircles() {
  AppState.fires.forEach(fire => {
    if (fireCircles[fire.id]) {
      fireCircles[fire.id][0].setRadius(fire.radius);
      fireCircles[fire.id][1].setRadius(fire.radius * 1.6);
      if (fireMarkers[fire.id]) fireMarkers[fire.id].setPopupContent(firePopupHTML(fire));
    }
  });
  AppState.teams.forEach(team => {
    if (teamMarkers[team.id]) {
      teamMarkers[team.id].setLatLng([team.lat, team.lng]);
      const icon = teamIcons[team.status] || teamIcons.available;
      teamMarkers[team.id].setIcon(icon);
      teamMarkers[team.id].setPopupContent(teamPopupHTML(team));
    }
  });
}

function firePopupHTML(f) {
  return `<div style="font-family:Segoe UI,sans-serif;min-width:160px">
    <b style="color:#e63946">🔥 Yangın ${f.id}</b><br>
    <small style="color:#888">Başlangıç: ${timeStr(f.startTime)} (${elapsed(f.startTime)} önce)</small><hr style="border-color:#333;margin:6px 0">
    Şiddet: <b>${intensityLabel(f.intensity)}</b><br>
    Arazi: ${terrainLabel(f.terrain)}<br>
    Yayılma Yönü: <b>${f.direction}</b><br>
    Yarıçap: <b>${Math.round(f.radius)} m</b><br>
    Ekipler: ${f.assignedTeams.length || 'Yok'}
  </div>`;
}

function teamPopupHTML(t) {
  return `<div style="font-family:Segoe UI,sans-serif;min-width:160px">
    <b>🚒 ${t.name}</b> (${t.vehicleId})<br>
    <small style="color:#888">Şef: ${t.chief}</small><hr style="border-color:#333;margin:6px 0">
    Durum: <b>${statusLabel(t.status)}</b><br>
    Su: <b>${t.water}%</b><br>
    Personel: <b>${t.personnel}</b><br>
    Ekipman: ${t.equipment.join(', ')}
  </div>`;
}

// ---- WIND CONTROL ----
function setWind(dir) {
  AppState.windDirection = dir;
  document.querySelectorAll('.wind-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.dir === dir);
  });
  document.getElementById('windInfo').textContent = dir;
  addLog('Rüzgar yönü değiştirildi: ' + dir, 'info');
  renderMapInfo();
}

// ---- ADD FIRE MODE ----
function toggleAddFireMode() {
  const btn = document.getElementById('addFireMode');
  const active = btn.dataset.active === 'true';
  btn.dataset.active = active ? 'false' : 'true';
  btn.style.borderColor = active ? '' : '#e63946';
  btn.style.color = active ? '' : '#e63946';
  btn.innerHTML = active ? '🔥 Yangın Ekle' : '✕ İptal Et';
  if (map) map.getContainer().style.cursor = active ? '' : 'crosshair';
}

function addNewFire(lat, lng) {
  const maxNum = AppState.fires.reduce((max, f) => {
    const m = f.id.match(/^F(\d+)$/);
    return m ? Math.max(max, parseInt(m[1])) : max;
  }, 0);
  const id = 'F' + String(maxNum + 1).padStart(3, '0');
  const newFire = {
    id, lat, lng,
    radius: 100,
    direction: AppState.windDirection,
    intensity: 'low',
    terrain: document.getElementById('terrainSelect') ? document.getElementById('terrainSelect').value : 'forest',
    startTime: new Date(),
    status: 'active',
    reportedBy: AppState.currentUser ? AppState.currentUser.name : 'Manuel Giriş',
    assignedTeams: [],
    spread_rate: 8
  };
  OfflineCacheManager.wrapWrite('addFire', newFire, () => dbAddFire(newFire));
  const _notifText = `Yeni yangın eklendi: ${id} (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
  OfflineCacheManager.wrapWrite('addNotif', { text: _notifText, type: 'warning' }, () => dbAddNotification(_notifText, 'warning'));
  addLog('Yeni yangın eklendi: ' + id, 'warn');
  toggleAddFireMode();
}

// ---- SIMULATION ----
function toggleSimulation() {
  if (AppState.simRunning) {
    clearInterval(simInterval);
    AppState.simRunning = false;
    document.getElementById('simBtn').innerHTML = '▶ Simülasyonu Başlat';
    document.getElementById('simBtn').classList.remove('danger');
    document.getElementById('simBtn').classList.add('success');
    addSimLog('Simülasyon durduruldu.', 'info');
  } else {
    AppState.simRunning = true;
    document.getElementById('simBtn').innerHTML = '⏹ Simülasyonu Durdur';
    document.getElementById('simBtn').classList.remove('success');
    document.getElementById('simBtn').classList.add('danger');
    addSimLog('Simülasyon başlatıldı.', 'success');
    simInterval = setInterval(runSimTick, 3000);
    runSimTick();
  }
}

function runSimTick() {
  AppState.simTick++;
  AppState.fires.forEach(fire => {
    if (fire.status !== 'active') return;
    const growth = spreadFire(fire);
    const msg = `[T${AppState.simTick}] ${fire.id}: Yarıçap ${Math.round(fire.radius)}m | Yön: ${fire.direction} | Büyüme: ${growth > 0 ? '+' : ''}${growth.toFixed(1)}m/tur`;
    const type = growth > 10 ? 'danger' : growth > 0 ? 'warn' : 'success';
    addSimLog(msg, type);

    // Her 5 tick'te bir Firebase'e yaz (write spam'i önlemek için)
    if (AppState.simTick % 5 === 0) {
      dbUpdateFireRadius(fire.id, Math.round(fire.radius), fire.intensity);
    }
  });
  updateMapCircles();
  renderMapInfo();
  if (document.getElementById('panel-fires').classList.contains('active')) renderFires();
}

function addSimLog(text, type) {
  const log = document.getElementById('simLog');
  if (!log) return;
  const el = document.createElement('div');
  el.className = 'sim-log-entry ' + type;
  el.textContent = nowStr().slice(0, 5) + ' › ' + text;
  log.prepend(el);
  while (log.children.length > 40) log.removeChild(log.lastChild);
}

// ---- TEAM MOVEMENT SIMULATION ----
function startTeamMovement() {
  let locationTick = 0;
  setInterval(() => {
    moveTick++;
    locationTick++;
    AppState.teams.forEach(team => {
      let moved = false;
      let newStatus = team.status;

      if (team.assignedFire) {
        const fire = AppState.fires.find(f => f.id === team.assignedFire);
        if (!fire) return;
        const dlat = (fire.lat - team.lat) * 0.05;
        const dlng = (fire.lng - team.lng) * 0.05;
        if (Math.abs(dlat) > 0.0001 || Math.abs(dlng) > 0.0001) {
          team.lat += dlat;
          team.lng += dlng;
          newStatus = 'on_route';
          moved = true;
        } else {
          newStatus = 'on_duty';
        }
        team.status = newStatus;
        if (teamMarkers[team.id]) teamMarkers[team.id].setLatLng([team.lat, team.lng]);
      } else if (team.status === 'available') {
        team.lat += (Math.random() - 0.5) * 0.0002;
        team.lng += (Math.random() - 0.5) * 0.0002;
        moved = true;
        if (teamMarkers[team.id]) teamMarkers[team.id].setLatLng([team.lat, team.lng]);
      }

      // Her 15 tick'te bir konum Firebase'e yaz (~30 saniye)
      if (moved && locationTick % 15 === 0) {
        dbUpdateTeamLocation(team.id, team.lat, team.lng, newStatus !== team.status ? newStatus : null);
      }
    });
  }, 2000);
}

// ---- RENDER MAP INFO ----
function renderMapInfo() {
  const activeFires = AppState.fires.filter(f => f.status === 'active').length;
  const availTeams = AppState.teams.filter(t => t.status === 'available').length;
  const onDutyTeams = AppState.teams.filter(t => t.status === 'on_duty' || t.status === 'on_route').length;
  document.getElementById('infoActiveFires').textContent = activeFires;
  document.getElementById('infoAvailTeams').textContent = availTeams;
  document.getElementById('infoOnDuty').textContent = onDutyTeams;
  document.getElementById('infoWind').textContent = AppState.windDirection + ' ' + AppState.windSpeed + 'km/s';

  // weather topbar
  document.getElementById('wbWind').textContent = AppState.windDirection + ' ' + AppState.windSpeed + 'km/s';
  document.getElementById('wbTemp').textContent = AppState.temperature + '°C';
  document.getElementById('wbHumidity').textContent = AppState.humidity + '%';
}

// ---- FIRES PANEL ----
function toggleFireSection(key) {
  _fireSectionOpen[key] = !_fireSectionOpen[key];
  renderFires();
}

function fireCardHTML(fire) {
  const role = AppState.currentUser?.role;
  const user = AppState.currentUser;
  const extinguished = fire.status === 'extinguished';
  const pendingReport = fire.status === 'pending_report';
  const intensityClass = fire.intensity === 'high' ? '' : fire.intensity === 'medium' ? 'medium-intensity' : 'low-intensity';
  const blocks = [1,2,3,4,5].map(i => {
    const limit = fire.intensity === 'high' ? 5 : fire.intensity === 'medium' ? 3 : 1;
    return `<div class="intensity-block ${i<=limit ? 'filled '+fire.intensity : ''}"></div>`;
  }).join('');
  const best = !extinguished && !pendingReport ? getBestTeam(fire.id) : null;

  const teamNames = fire.assignedTeams.length
    ? fire.assignedTeams.map(tid => { const t = AppState.teams.find(x => x.id === tid); return t ? t.name : tid; }).join(', ')
    : 'Yok';
  const chiefNames = (fire.assignedChiefs || []).length
    ? fire.assignedChiefs.map(cid => { const u = AppState.users.find(x => x.id === cid); return u ? u.name : cid; }).join(', ')
    : 'Yok';

  let badgeClass, badgeLabel;
  if (extinguished)       { badgeClass = 'badge-gray';   badgeLabel = 'Söndürüldü'; }
  else if (pendingReport) { badgeClass = 'badge-yellow';  badgeLabel = '⏳ Onay Bekliyor'; }
  else                    { badgeClass = fire.intensity === 'high' ? 'badge-red' : fire.intensity === 'medium' ? 'badge-yellow' : 'badge-green'; badgeLabel = intensityLabel(fire.intensity); }

  let btns = '';
  if (!extinguished) {
    if (pendingReport) {
      // Şef: onay butonu (kendi yangınıysa)
      if (role === 'sef' && (fire.assignedChiefs || []).includes(user.id)) {
        btns += `<button class="btn btn-success btn-sm" onclick="showReportModal('${fire.id}')">📋 Onayla ve Raporla</button>`;
      }
      // Merkez: yine de manuel söndürme yapabilir
      if (role === 'merkez') {
        btns += `<button class="btn btn-success btn-sm" onclick="extinguishFire('${fire.id}')">✅ Manuel Söndür</button>`;
      }
    } else {
      if (role === 'merkez') {
        btns += `<button class="btn btn-primary btn-sm" onclick="showAssignChiefModal('${fire.id}')">👨‍🚒 Şef Görevlendir</button>`;
        btns += `<button class="btn btn-success btn-sm" onclick="extinguishFire('${fire.id}')">✅ Söndür</button>`;
      } else if (role === 'sef' && (fire.assignedChiefs || []).includes(user.id)) {
        btns += `<button class="btn btn-primary btn-sm" onclick="showDispatchModal('${fire.id}')">🚒 Ekip Gönder</button>`;
      }
    }
    btns += `<button class="btn btn-secondary btn-sm" onclick="focusOnMap('${fire.id}')">🗺 Haritada Gör</button>`;
  }

  const pendingBanner = pendingReport ? `
    <div style="margin-top:10px;padding:8px 12px;background:rgba(210,153,34,0.1);border:1px solid rgba(210,153,34,0.4);border-radius:6px;font-size:12px;color:#d29922">
      ⏳ Tüm ekip üyeleri görevlerini tamamladı. İtfaiye şefinin onayı bekleniyor.
    </div>` : '';

  return `
  <div class="card fire-card ${intensityClass}" id="fcard-${fire.id}">
    <div class="card-header">
      <div class="card-icon">${pendingReport ? '⏳' : '🔥'}</div>
      <div>
        <div class="card-title">${fire.id}</div>
        <div class="card-subtitle">${terrainLabel(fire.terrain)} · ${timeStr(fire.startTime)}</div>
      </div>
      <div class="card-status">
        <span class="badge ${badgeClass}">${badgeLabel}</span>
      </div>
    </div>
    <div class="intensity-bar">${blocks}</div>
    <div class="info-row"><span class="key">Yayılma Yönü</span><span class="val">${fire.direction} (${AppState.windDirection} rüzgar)</span></div>
    <div class="info-row"><span class="key">Yarıçap</span><span class="val">${Math.round(fire.radius)} m</span></div>
    <div class="info-row"><span class="key">Görevli Şefler</span><span class="val">${chiefNames}</span></div>
    <div class="info-row"><span class="key">Atanan Ekipler</span><span class="val">${teamNames}</span></div>
    <div class="info-row"><span class="key">Bildiren</span><span class="val">${fire.reportedBy}</span></div>
    <div class="info-row"><span class="key">Geçen Süre</span><span class="val">${elapsed(fire.startTime)}</span></div>
    ${best ? `
    <div style="margin-top:10px;padding:8px;background:#0d1117;border-radius:6px;border:1px solid #21262d">
      <div style="font-size:10px;color:#6e7681;text-transform:uppercase;margin-bottom:4px">Önerilen Ekip</div>
      <div style="font-size:12px;color:#58a6ff">${best.team.name} · ${best.distance} km · Skor: %${best.score}</div>
    </div>` : ''}
    ${pendingBanner}
    ${btns ? `<div class="btn-group">${btns}</div>` : ''}
  </div>`;
}

function renderFires() {
  const grid = document.getElementById('firesGrid');
  const stats = document.getElementById('fireStats');
  const active  = AppState.fires.filter(f => f.status === 'active');
  const pending = AppState.fires.filter(f => f.status === 'pending_report');
  const ext     = AppState.fires.filter(f => f.status === 'extinguished');
  const affectedArea = Math.round(active.reduce((a,f) => a + Math.PI*f.radius*f.radius/1e6, 0) * 10) / 10;

  stats.innerHTML = `
    <div class="stat-card red"><div class="stat-icon">🔥</div><div><div class="stat-val">${active.length}</div><div class="stat-label">Aktif Yangın</div></div></div>
    <div class="stat-card yellow"><div class="stat-icon">⏳</div><div><div class="stat-val">${pending.length}</div><div class="stat-label">Onay Bekliyor</div></div></div>
    <div class="stat-card green"><div class="stat-icon">✅</div><div><div class="stat-val">${ext.length}</div><div class="stat-label">Söndürüldü</div></div></div>
    <div class="stat-card blue"><div class="stat-icon">📐</div><div><div class="stat-val">${affectedArea}</div><div class="stat-label">Etkilenen Alan (km²)</div></div></div>
  `;

  const section = (key, icon, title, fires, emptyMsg) => {
    const html = fires.length
      ? `<div class="cards-grid">${fires.map(fireCardHTML).join('')}</div>`
      : `<div style="color:#6e7681;padding:16px;text-align:center">${emptyMsg}</div>`;
    return `
      <div class="fire-section">
        <div class="fire-section-header" onclick="toggleFireSection('${key}')">
          <span>${icon} ${title} <span class="fire-section-count">${fires.length}</span></span>
          <span class="fire-section-arrow">${_fireSectionOpen[key] ? '▲' : '▼'}</span>
        </div>
        ${_fireSectionOpen[key] ? html : ''}
      </div>`;
  };

  grid.innerHTML =
    section('active',  '🔥', 'Aktif Yangınlar',       active,  'Aktif yangın yok') +
    section('pending', '⏳', 'Onay Bekleyen Yangınlar', pending, 'Onay bekleyen yangın yok') +
    section('ext',     '✅', 'Söndürülen Yangınlar',   ext,     'Söndürülen yangın yok');
}

function focusOnMap(fireId) {
  const fire = AppState.fires.find(f => f.id === fireId);
  if (fire && map) {
    navTo('map');
    setTimeout(() => {
      map.setView([fire.lat, fire.lng], 15);
      if (fireMarkers[fireId]) fireMarkers[fireId].openPopup();
    }, 200);
  }
}

function showAssignChiefModal(fireId) {
  const fire = AppState.fires.find(f => f.id === fireId);
  if (!fire) return;
  document.getElementById('assignChiefFireLabel').textContent = fireId;
  document.getElementById('assignChiefFireId').value = fireId;
  document.getElementById('assignChiefInfo').innerHTML = '';

  const already = fire.assignedChiefs || [];
  const sefUsers = AppState.users.filter(u => u.role === 'sef' && u.active !== false);
  const sel = document.getElementById('assignChiefSelect');
  if (sefUsers.length === 0) {
    sel.innerHTML = '<option value="">Sistemde aktif şef yok</option>';
  } else {
    sel.innerHTML = '<option value="">-- Şef Seçin --</option>' +
      sefUsers.map(u => {
        const teamCount = AppState.teams.filter(t => t.chiefUserId === u.id).length;
        const tag = already.includes(u.id) ? ' ✓ Zaten görevli' : '';
        return `<option value="${u.id}" ${already.includes(u.id) ? 'disabled' : ''}>${u.name}${tag} · ${teamCount} ekip</option>`;
      }).join('');
  }
  document.getElementById('assignChiefModal').classList.add('open');
}

function saveAssignChief() {
  const fireId = document.getElementById('assignChiefFireId').value;
  const chiefId = document.getElementById('assignChiefSelect').value;
  if (!chiefId) { alert('Bir şef seçin!'); return; }
  const chief = AppState.users.find(u => u.id === chiefId);
  dbAssignChief(chiefId, fireId);
  dbAddNotification(`${chief?.name}, ${fireId} yangınına şef olarak görevlendirildi.`, 'warning');
  addLog(`${chief?.name} → ${fireId} yangınına şef olarak atandı`, 'warn');
  closeModal('assignChiefModal');
}

function showDispatchModal(fireId) {
  const fire = AppState.fires.find(f => f.id === fireId);
  if (!fire) return;
  const role = AppState.currentUser?.role;

  document.getElementById('dispatchFireLabel').textContent = fireId;
  document.getElementById('dispatchFireIdVal').value = fireId;

  const sourceTeams = role === 'sef' ? getMyTeams() : AppState.teams;
  const candidates = sourceTeams
    .filter(t => t.status !== 'maintenance' && !fire.assignedTeams.includes(t.id))
    .map(t => ({
      ...t,
      score: Math.round(teamScore(t, fire) * 100),
      dist: haversine(t.lat, t.lng, fire.lat, fire.lng).toFixed(1)
    }))
    .sort((a, b) => b.score - a.score);

  const sel = document.getElementById('dispatchTeamSelect');
  if (candidates.length === 0) {
    sel.innerHTML = '<option value="">Uygun ekip bulunamadı</option>';
    document.getElementById('dispatchTeamInfo').innerHTML = '';
  } else {
    sel.innerHTML = candidates.map((t, i) =>
      `<option value="${t.id}" ${i === 0 ? 'selected' : ''}>` +
      `${i === 0 ? '⭐ ' : ''}${t.name}  ·  ${statusLabel(t.status)}  ·  💧%${t.water}  ·  ${t.dist}km  ·  Skor:%${t.score}` +
      `</option>`
    ).join('');
    refreshDispatchInfo();
  }
  document.getElementById('dispatchModal').classList.add('open');
}

function refreshDispatchInfo() {
  const fireId = document.getElementById('dispatchFireIdVal').value;
  const teamId = document.getElementById('dispatchTeamSelect').value;
  const box = document.getElementById('dispatchTeamInfo');
  if (!teamId || !fireId) { box.innerHTML = ''; return; }
  const team = AppState.teams.find(t => t.id === teamId);
  const fire = AppState.fires.find(f => f.id === fireId);
  if (!team || !fire) { box.innerHTML = ''; return; }
  const dist  = haversine(team.lat, team.lng, fire.lat, fire.lng).toFixed(1);
  const score = Math.round(teamScore(team, fire) * 100);
  const eta   = team.speed > 0 ? Math.round((dist / team.speed) * 60) : '—';
  box.innerHTML = `
    <div style="background:#0d1117;border:1px solid #21262d;border-radius:6px;padding:10px;margin-top:8px;font-size:12px">
      <div style="display:flex;justify-content:space-between;padding:3px 0"><span style="color:#8b949e">Ekip</span><span style="color:#c9d1d9">${team.name}</span></div>
      <div style="display:flex;justify-content:space-between;padding:3px 0"><span style="color:#8b949e">Durum</span><span class="badge ${statusBadgeClass(team.status)}">${statusLabel(team.status)}</span></div>
      <div style="display:flex;justify-content:space-between;padding:3px 0"><span style="color:#8b949e">Su Kapasitesi</span><span>%${team.water}</span></div>
      <div style="display:flex;justify-content:space-between;padding:3px 0"><span style="color:#8b949e">Personel</span><span>${team.personnel} kişi</span></div>
      <div style="display:flex;justify-content:space-between;padding:3px 0"><span style="color:#8b949e">Mesafe</span><span>${dist} km</span></div>
      <div style="display:flex;justify-content:space-between;padding:3px 0"><span style="color:#8b949e">Tahmini Varış</span><span style="color:#3fb950">${eta} dk</span></div>
      <div style="display:flex;justify-content:space-between;padding:3px 0"><span style="color:#8b949e">Uygunluk Skoru</span><span style="color:#58a6ff">%${score}</span></div>
    </div>`;
}

function saveDispatch() {
  const fireId = document.getElementById('dispatchFireIdVal').value;
  const teamId = document.getElementById('dispatchTeamSelect').value;
  if (!teamId) { alert('Bir ekip seçin!'); return; }
  const team = AppState.teams.find(t => t.id === teamId);
  OfflineCacheManager.wrapWrite('assignTeam', { teamId, fireId }, () => dbAssignTeam(teamId, fireId));
  const _notifText = `${team?.name} ${fireId} yangınına gönderildi.`;
  OfflineCacheManager.wrapWrite('addNotif', { text: _notifText, type: 'info' }, () => dbAddNotification(_notifText, 'info'));
  addLog(`${team?.name} → ${fireId} yangınına yönlendirildi`, 'warn');
  closeModal('dispatchModal');
}

function extinguishFire(fireId) {
  const fire = AppState.fires.find(f => f.id === fireId);
  if (!fire) return;
  fire.assignedTeams.forEach(tid => {
    const team = AppState.teams.find(t => t.id === tid);
    const water = team ? Math.max(10, team.water - 30) : 10;
    OfflineCacheManager.wrapWrite('unassignTeam', { teamId: tid, fireId, water }, () => dbUnassignTeam(tid, fireId, water));
  });
  OfflineCacheManager.wrapWrite('extinguishFire', { fireId }, () => dbExtinguishFire(fireId));
  const _notifText = `${fireId} yangını söndürüldü!`;
  OfflineCacheManager.wrapWrite('addNotif', { text: _notifText, type: 'success' }, () => dbAddNotification(_notifText, 'success'));
  addLog(fireId + ' yangını söndürüldü!', 'success');
}

// ---- RAPOR MODAL ----
function showReportModal(fireId) {
  const fire = AppState.fires.find(f => f.id === fireId);
  if (!fire) return;
  const chief = AppState.currentUser;
  const respondingTeams  = fire.assignedTeams.map(tid => AppState.teams.find(t => t.id === tid)).filter(Boolean);
  const respondingChiefs = (fire.assignedChiefs || []).map(cid => AppState.users.find(u => u.id === cid)).filter(Boolean);
  const durationMin = Math.floor((Date.now() - (fire.startTime instanceof Date ? fire.startTime.getTime() : fire.startTime)) / 60000);
  const durationStr = durationMin < 60 ? `${durationMin} dakika` : `${Math.floor(durationMin/60)} saat ${durationMin % 60} dakika`;
  const endTime = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

  document.getElementById('reportFireIdVal').value = fireId;
  document.getElementById('reportContent').innerHTML = `
    <div style="background:#0d1117;border:1px solid #21262d;border-radius:8px;padding:16px;font-size:13px;display:grid;gap:8px">
      <div style="font-size:10px;color:#6e7681;text-transform:uppercase;font-weight:600;margin-bottom:4px">📋 Yangın Söndürme Raporu</div>
      <div style="display:flex;justify-content:space-between"><span style="color:#8b949e">Yangın ID</span><span style="color:#e6edf3;font-weight:600">${fire.id}</span></div>
      <div style="display:flex;justify-content:space-between"><span style="color:#8b949e">Konum</span><span style="color:#e6edf3">${fire.lat.toFixed(4)}, ${fire.lng.toFixed(4)}</span></div>
      <div style="display:flex;justify-content:space-between"><span style="color:#8b949e">Arazi Tipi</span><span style="color:#e6edf3">${terrainLabel(fire.terrain)}</span></div>
      <div style="display:flex;justify-content:space-between"><span style="color:#8b949e">Son Yoğunluk</span><span style="color:#e6edf3">${intensityLabel(fire.intensity)}</span></div>
      <div style="display:flex;justify-content:space-between"><span style="color:#8b949e">Son Yarıçap</span><span style="color:#e6edf3">${Math.round(fire.radius)} m</span></div>
      <div style="display:flex;justify-content:space-between"><span style="color:#8b949e">Bildiren</span><span style="color:#e6edf3">${fire.reportedBy}</span></div>
      <div style="border-top:1px solid #21262d;margin:2px 0"></div>
      <div style="display:flex;justify-content:space-between"><span style="color:#8b949e">Başlangıç</span><span style="color:#e6edf3">${timeStr(fire.startTime)}</span></div>
      <div style="display:flex;justify-content:space-between"><span style="color:#8b949e">Söndürülme</span><span style="color:#e6edf3">${endTime}</span></div>
      <div style="display:flex;justify-content:space-between"><span style="color:#8b949e">Müdahale Süresi</span><span style="color:#3fb950;font-weight:600">${durationStr}</span></div>
      <div style="border-top:1px solid #21262d;margin:2px 0"></div>
      <div style="display:flex;justify-content:space-between"><span style="color:#8b949e">Müdahale Eden Ekip(ler)</span><span style="color:#58a6ff">${respondingTeams.map(t => t.name).join(', ') || '—'}</span></div>
      <div style="display:flex;justify-content:space-between"><span style="color:#8b949e">Görevli Şef(ler)</span><span style="color:#d29922">${respondingChiefs.map(u => u.name).join(', ') || '—'}</span></div>
      <div style="display:flex;justify-content:space-between"><span style="color:#8b949e">Raporu Onaylayan</span><span style="color:#3fb950;font-weight:600">${chief.name}</span></div>
    </div>
    <div style="margin-top:10px;padding:10px 12px;background:rgba(63,185,80,0.08);border:1px solid rgba(63,185,80,0.3);border-radius:6px;font-size:12px;color:#3fb950">
      Bu raporu onayladığınızda yangın söndürülmüş olarak işaretlenecek ve Merkez dashboardına iletilecektir.
    </div>
  `;
  document.getElementById('reportModal').classList.add('open');
}

function submitReport() {
  const fireId = document.getElementById('reportFireIdVal').value;
  const fire = AppState.fires.find(f => f.id === fireId);
  if (!fire) return;
  const chief = AppState.currentUser;
  const respondingTeams  = fire.assignedTeams.map(tid => AppState.teams.find(t => t.id === tid)).filter(Boolean);
  const respondingChiefs = (fire.assignedChiefs || []).map(cid => AppState.users.find(u => u.id === cid)).filter(Boolean);
  const now = Date.now();
  const durationMin = Math.floor((now - (fire.startTime instanceof Date ? fire.startTime.getTime() : fire.startTime)) / 60000);

  const report = {
    id: 'RPT' + now,
    fireId: fire.id,
    submittedAt: now,
    submittedAtStr: new Date(now).toLocaleString('tr-TR'),
    approvedBy: chief.name,
    approvedByUserId: chief.id,
    fireData: {
      lat: fire.lat, lng: fire.lng,
      terrain: fire.terrain, intensity: fire.intensity,
      radius: Math.round(fire.radius),
      reportedBy: fire.reportedBy,
      startTime: fire.startTime instanceof Date ? fire.startTime.getTime() : fire.startTime,
      endTime: now
    },
    teamIds: fire.assignedTeams,
    teamNames: respondingTeams.map(t => t.name),
    chiefNames: respondingChiefs.map(u => u.name),
    durationMin
  };

  OfflineCacheManager.wrapWrite('submitReport', report, () => dbSubmitReport(report));
  const _notifText = `📋 ${fire.id} yangın söndürme raporu ${chief.name} tarafından onaylandı.`;
  OfflineCacheManager.wrapWrite('addNotif', { text: _notifText, type: 'success' }, () => dbAddNotification(_notifText, 'success'));
  addLog(`${fire.id} raporu onaylandı ve Merkez'e gönderildi — ${chief.name}`, 'success');
  closeModal('reportModal');
}

// ---- TEAMS PANEL ----
function renderTeams() {
  const role = AppState.currentUser?.role;
  const teamsToShow = role === 'sef' ? getMyTeams() : AppState.teams;
  const grid = document.getElementById('teamsGrid');
  const stats = document.getElementById('teamStats');
  const available = teamsToShow.filter(t => t.status === 'available').length;
  const onDuty = teamsToShow.filter(t => t.status !== 'available' && t.status !== 'maintenance').length;
  const maint = teamsToShow.filter(t => t.status === 'maintenance').length;

  stats.innerHTML = `
    <div class="stat-card green"><div class="stat-icon">✅</div><div><div class="stat-val">${available}</div><div class="stat-label">Uygun Ekip</div></div></div>
    <div class="stat-card yellow"><div class="stat-icon">🚒</div><div><div class="stat-val">${onDuty}</div><div class="stat-label">Görevde</div></div></div>
    <div class="stat-card red"><div class="stat-icon">🔧</div><div><div class="stat-val">${maint}</div><div class="stat-label">Bakımda</div></div></div>
    <div class="stat-card blue"><div class="stat-icon">👤</div><div><div class="stat-val">${teamsToShow.reduce((a,t)=>a+t.personnel,0)}</div><div class="stat-label">Toplam Personel</div></div></div>
  `;

  if (teamsToShow.length === 0) {
    grid.innerHTML = '<div style="color:#6e7681;text-align:center;padding:40px">Ekip bulunamadı</div>';
    return;
  }

  grid.innerHTML = teamsToShow.map(team => {
    const waterPct = team.water;
    const waterClass = waterPct >= 70 ? 'high' : waterPct >= 40 ? 'mid' : 'low';
    const requiredEquip = ['maske', 'hortum', 'söndürücü'];
    const equipTags = requiredEquip.map(e => {
      const has = team.equipment.includes(e);
      return `<span class="equip-tag ${has ? '' : 'missing'}">${has ? '✓' : '✗'} ${e}</span>`;
    }).join('');

    const activeFire = AppState.fires.find(f => f.status === 'active');
    const score = activeFire ? teamScore(team, activeFire) : null;

    return `
    <div class="card" id="tcard-${team.id}">
      <div class="card-header">
        <div class="card-icon">🚒</div>
        <div>
          <div class="card-title">${team.name}</div>
          <div class="card-subtitle">${team.vehicleId}${team.vehicleType ? ' · ' + team.vehicleType : ''} · Şef: ${team.chief}</div>
        </div>
        <div class="card-status">
          <span class="badge ${statusBadgeClass(team.status)}">${statusLabel(team.status)}</span>
        </div>
      </div>
      <div class="info-row"><span class="key">Su Seviyesi</span><span class="val">${waterPct}%</span></div>
      <div class="progress-bar"><div class="progress-fill ${waterClass}" style="width:${waterPct}%"></div></div>
      <div class="info-row mt-2"><span class="key">Personel</span><span class="val">${team.personnel} kişi</span></div>
      <div class="info-row"><span class="key">Atandığı Yangın</span><span class="val">${team.assignedFire || 'Yok'}</span></div>
      ${score !== null ? `<div class="info-row"><span class="key">Uygunluk Skoru</span><span class="val" style="color:#58a6ff">%${Math.round(score * 100)}</span></div>` : ''}
      <div class="equip-tags">${equipTags}</div>
      <div class="btn-group">
        ${(role === 'merkez' || role === 'sef') && team.status !== 'maintenance' ? `<button class="btn btn-secondary btn-sm" onclick="updateTeamWater('${team.id}')">💧 Su Güncelle</button>` : ''}
        ${RoleBasedController.can('teams.complete', {teamId: team.id}) && team.assignedFire ? `<button class="btn btn-success btn-sm" onclick="completeTask('${team.id}')">✅ Görev Bitti</button>` : ''}
        ${role === 'sef' ? `<button class="btn btn-secondary btn-sm" onclick="showEquipmentModal('${team.id}')">🔧 Ekipman</button>` : ''}
        ${role === 'sef' ? `<button class="btn btn-secondary btn-sm" onclick="toggleMaintenance('${team.id}')">${team.status === 'maintenance' ? '✅ Aktif Et' : '🔧 Bakıma Al'}</button>` : ''}
        <button class="btn btn-secondary btn-sm" onclick="focusOnTeam('${team.id}')">🗺 Haritada Gör</button>
      </div>
    </div>`;
  }).join('');
}

function showEquipmentModal(teamId) {
  const team = AppState.teams.find(t => t.id === teamId);
  if (!team) return;
  document.getElementById('equipModalTeamId').value = teamId;
  document.getElementById('equipModalTeamName').textContent = team.name;
  document.getElementById('equipCheckboxes').innerHTML = EQUIP_LIST.map(e => `
    <label style="display:flex;align-items:center;gap:8px;padding:5px 0;cursor:pointer;font-size:13px;color:#c9d1d9">
      <input type="checkbox" value="${e}" ${team.equipment.includes(e) ? 'checked' : ''} style="accent-color:#e63946;width:14px;height:14px">
      ${e}
    </label>`).join('');
  document.getElementById('equipmentModal').classList.add('open');
}

function saveEquipment() {
  const teamId = document.getElementById('equipModalTeamId').value;
  const checked = Array.from(document.querySelectorAll('#equipCheckboxes input[type="checkbox"]:checked'));
  const equipment = checked.map(cb => cb.value);
  dbUpdateTeamEquipment(teamId, equipment);
  const team = AppState.teams.find(t => t.id === teamId);
  addLog(`${team?.name} ekipmanları güncellendi`, 'info');
  closeModal('equipmentModal');
}

function toggleMaintenance(teamId) {
  const team = AppState.teams.find(t => t.id === teamId);
  if (!team) return;
  if (team.status === 'maintenance') {
    dbUpdateTeamStatus(teamId, 'available');
    addLog(`${team.name} bakımdan çıkarıldı`, 'success');
  } else if (team.status === 'available') {
    dbUpdateTeamStatus(teamId, 'maintenance');
    addLog(`${team.name} bakıma alındı`, 'warn');
  } else {
    alert('Görevde olan ekip bakıma alınamaz.');
  }
}

function focusOnTeam(teamId) {
  const team = AppState.teams.find(t => t.id === teamId);
  if (team && map) {
    navTo('map');
    setTimeout(() => {
      map.setView([team.lat, team.lng], 15);
      if (teamMarkers[teamId]) teamMarkers[teamId].openPopup();
    }, 200);
  }
}

function updateTeamWater(teamId) {
  const team = AppState.teams.find(t => t.id === teamId);
  const val = prompt(`${team.name} - Su Seviyesi (0-100):`, team.water);
  if (val === null) return;
  const n = parseInt(val);
  if (!isNaN(n) && n >= 0 && n <= 100) {
    OfflineCacheManager.wrapWrite('updateWater', { teamId, water: n }, () => dbUpdateTeamWater(teamId, n));
    addLog(`${team.name} su seviyesi güncellendi: %${n}`, 'info');
  }
}

function completeTask(teamId) {
  const team = AppState.teams.find(t => t.id === teamId);
  if (!team) return;
  const water = Math.max(10, team.water - 20);
  OfflineCacheManager.wrapWrite('unassignTeam', { teamId, fireId: team.assignedFire, water }, () => dbUnassignTeam(teamId, team.assignedFire, water));
  addLog(`${team.name} görevi tamamladı, uygun duruma geçti`, 'success');
}

// ---- ROUTE PANEL ----
function renderRoute() {
  const fireSelect = document.getElementById('routeFireSelect');
  const teamSelect = document.getElementById('routeTeamSelect');
  const teamLabel  = document.getElementById('routeTeamLabel');

  // Tüm roller için yangın listesi göster
  fireSelect.innerHTML = '<option value="">-- Yangın Seç --</option>' +
    AppState.fires.filter(f => f.status === 'active').map(f =>
      `<option value="${f.id}">${f.id} - ${terrainLabel(f.terrain)} (${Math.round(f.radius)}m)</option>`
    ).join('');

  const myTeams = getMyTeams();
  const sourceTeams = AppState.currentUser.role === 'sef' ? myTeams : AppState.teams;
  teamSelect.style.display = 'block';
  if (teamLabel) teamLabel.style.display = 'none';
  teamSelect.innerHTML = '<option value="">-- Ekip Seç --</option>' +
    sourceTeams.map(t =>
      `<option value="${t.id}">${t.name} [${statusLabel(t.status)}] Su:%${t.water}</option>`
    ).join('');
}

// ---- SAFE PATH GENERATION ----
// strategy: 'safe'  → 3-arc waypoints, büyük buffer (OSRM'i güvenli yola zorlar)
//           'balanced' → 1 waypoint, orta buffer
// Geri dönüş: { waypoints, avoided, zones } veya rota temizse null.
function generateSafePathStrategic(teamLat, teamLng, fireLat, fireLng, targetFireId, strategy) {
  const BUFFER = strategy === 'safe' ? 1.2 : 0.5;
  const MIN_R  = strategy === 'safe' ? 0.7 : 0.3;

  const dangerFires = AppState.fires.filter(f =>
    (f.status === 'active' || f.status === 'pending_report') && f.id !== targetFireId
  );
  if (dangerFires.length === 0) return null;

  const cosLat   = Math.cos(teamLat * Math.PI / 180);
  const toLocal   = (lat, lng) => ({ x: (lng - teamLng) * cosLat * 111.32, y: (lat - teamLat) * 111.32 });
  const fromLocal = (x, y)     => [teamLat + y / 111.32, teamLng + x / (111.32 * cosLat)];

  const B = toLocal(fireLat, fireLng);
  const ABlen = Math.hypot(B.x, B.y);
  if (ABlen < 0.01) return null;
  const ABu = { x: B.x / ABlen, y: B.y / ABlen };

  const allBypasses = [];

  dangerFires.forEach(fire => {
    const C = toLocal(fire.lat, fire.lng);
    const safeR = Math.max(MIN_R, fire.radius / 1000 + BUFFER);

    // Projeksiyon: yangın merkezinin AB doğrusuna en yakın noktası
    const t  = Math.max(0, Math.min(ABlen, C.x * ABu.x + C.y * ABu.y));
    const Px = ABu.x * t, Py = ABu.y * t;
    const dist = Math.hypot(C.x - Px, C.y - Py);

    if (dist >= safeR) return; // rota bu yangın bölgesinden güvenli geçiyor

    // Cross-product: yangının rotanın hangi tarafında olduğunu belirle
    // ABu × AC > 0 → yangın SOLda, detour SAĞA (bx=ABu.y, by=-ABu.x)
    // ABu × AC < 0 → yangın SAĞDA, detour SOLA (bx=-ABu.y, by=ABu.x)
    const cross = ABu.x * C.y - ABu.y * C.x;
    const bx = cross >= 0 ?  ABu.y : -ABu.y;
    const by = cross >= 0 ? -ABu.x :  ABu.x;

    if (strategy === 'safe') {
      // 3 noktalı yay: giriş → tepe → çıkış (OSRM'i bölgeden uzak tutar)
      const arcOff = Math.min(safeR * 0.9, ABlen * 0.12);
      const t0 = Math.max(safeR * 0.2, t - arcOff);
      const t2 = Math.min(ABlen - safeR * 0.2, t + arcOff);

      // Her noktayı yangın merkezinden safeR uzaklıkta konumlandır (garanti mesafe)
      const entry = { x: C.x + bx * safeR * 1.05, y: C.y + by * safeR * 1.05 };
      const peak  = { x: C.x + bx * safeR * 1.6,  y: C.y + by * safeR * 1.6  };
      const exit_ = { x: C.x + bx * safeR * 1.05, y: C.y + by * safeR * 1.05 };

      // Giriş ve çıkışı t0/t2 konumuna doğru hafifçe kaydır
      entry.x += ABu.x * (t0 - t) * 0.3;
      entry.y += ABu.y * (t0 - t) * 0.3;
      exit_.x += ABu.x * (t2 - t) * 0.3;
      exit_.y += ABu.y * (t2 - t) * 0.3;

      allBypasses.push({ pt: fromLocal(entry.x, entry.y), t: t0, fireId: fire.id, fireLat: fire.lat, fireLng: fire.lng, safeR });
      allBypasses.push({ pt: fromLocal(peak.x,  peak.y),  t,     fireId: fire.id, fireLat: fire.lat, fireLng: fire.lng, safeR });
      allBypasses.push({ pt: fromLocal(exit_.x, exit_.y), t: t2, fireId: fire.id, fireLat: fire.lat, fireLng: fire.lng, safeR });
    } else {
      // 1 bypass noktası: yangın merkezinden safeR * 1.3 uzaklıkta
      const p = { x: C.x + bx * safeR * 1.3, y: C.y + by * safeR * 1.3 };
      allBypasses.push({ pt: fromLocal(p.x, p.y), t, fireId: fire.id, fireLat: fire.lat, fireLng: fire.lng, safeR });
    }
  });

  if (allBypasses.length === 0) return null;
  allBypasses.sort((a, b) => a.t - b.t);

  const avoidedIds = [...new Set(allBypasses.map(b => b.fireId))];
  const zonesMap = {};
  allBypasses.forEach(b => {
    if (!zonesMap[b.fireId]) zonesMap[b.fireId] = { lat: b.fireLat, lng: b.fireLng, radius: b.safeR * 1000 };
  });

  return {
    waypoints: allBypasses.map(b => b.pt),
    avoided:   avoidedIds,
    zones:     Object.values(zonesMap)
  };
}

// ---- OSRM MULTI-WAYPOINT ROUTING ----
async function fetchOSRMRouteMulti(latLngArray) {
  const coords = latLngArray.map(([lat, lng]) => `${lng},${lat}`).join(';');
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true&annotations=false`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (data.code === 'Ok' && data.routes && data.routes.length > 0) return data.routes[0];
  } catch (e) {
    console.warn('OSRM multi-waypoint hatası:', e.message);
  }
  return null;
}

// ---- OSRM REAL ROAD ROUTING ----
async function fetchOSRMRoute(lat1, lng1, lat2, lng2) {
  const url = `https://router.project-osrm.org/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=full&geometries=geojson&steps=true&annotations=false`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
      return data.routes[0];
    }
  } catch (e) {
    console.warn('OSRM rota alınamadı, düz çizgi kullanılacak:', e.message);
  }
  return null;
}

// GeoJSON koordinatlarını [lat, lng] formatına çevir
function geojsonToLatLng(coords) {
  return coords.map(([lng, lat]) => [lat, lng]);
}

// Adım adım yön talimatları üret
function buildStepsHTML(legs) {
  if (!legs || !legs[0] || !legs[0].steps || legs[0].steps.length === 0) return '';
  const steps = legs[0].steps.slice(0, 8);
  const icons = { 'turn': '↰', 'new name': '→', 'depart': '📍', 'arrive': '🔥', 'roundabout': '↺', 'merge': '⤵', 'fork': '⑂', 'straight': '↑' };
  const rows = steps.map(s => {
    const icon = icons[s.maneuver?.type] || '→';
    const dist = s.distance > 1000 ? (s.distance / 1000).toFixed(1) + ' km' : Math.round(s.distance) + ' m';
    const name = s.name || s.ref || 'Devam';
    return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #21262d;font-size:11px">
      <span style="font-size:15px;min-width:20px">${icon}</span>
      <span style="flex:1;color:#c9d1d9">${name}</span>
      <span style="color:#6e7681">${dist}</span>
    </div>`;
  }).join('');
  return `<div style="margin-top:10px">
    <div style="font-size:10px;color:#6e7681;text-transform:uppercase;margin-bottom:6px">Dönüş Talimatları</div>
    ${rows}
    ${legs[0].steps.length > 8 ? `<div style="font-size:10px;color:#6e7681;padding-top:4px">+${legs[0].steps.length - 8} adım daha...</div>` : ''}
  </div>`;
}

async function calcRoute() {
  const fireId = document.getElementById('routeFireSelect').value;
  const teamId = document.getElementById('routeTeamSelect').value;
  if (!fireId || !teamId) { alert('Yangın ve ekip seçiniz!'); return; }

  const fire = AppState.fires.find(f => f.id === fireId);
  const team = AppState.teams.find(t => t.id === teamId);
  if (!fire || !team) return;

  document.getElementById('routeResult').innerHTML = `
    <div class="card mt-3" style="text-align:center;padding:28px;color:#8b949e">
      <div style="font-size:28px;margin-bottom:8px">🔍</div>
      <div>3 farklı rota hesaplanıyor...</div>
      <div style="font-size:11px;margin-top:4px">En güvenli · Dengeli · En hızlı</div>
    </div>`;
  drawRouteOnMap(routeMap, team, fire, null, null);

  const safeSP     = generateSafePathStrategic(team.lat, team.lng, fire.lat, fire.lng, fireId, 'safe');
  const balancedSP = generateSafePathStrategic(team.lat, team.lng, fire.lat, fire.lng, fireId, 'balanced');

  const makeWpts = sp => sp ? [[team.lat, team.lng], ...sp.waypoints, [fire.lat, fire.lng]] : null;

  // 3 rotayı paralel hesapla
  const [safeOSRM, balancedOSRM, fastOSRM] = await Promise.all([
    makeWpts(safeSP) ? fetchOSRMRouteMulti(makeWpts(safeSP)) : fetchOSRMRoute(team.lat, team.lng, fire.lat, fire.lng),
    makeWpts(balancedSP) ? fetchOSRMRouteMulti(makeWpts(balancedSP)) : fetchOSRMRoute(team.lat, team.lng, fire.lat, fire.lng),
    fetchOSRMRoute(team.lat, team.lng, fire.lat, fire.lng)
  ]);

  const buildOpt = (osrm, sp) => {
    const coords  = osrm ? geojsonToLatLng(osrm.geometry.coordinates) : [[team.lat, team.lng], [fire.lat, fire.lng]];
    const distKm  = osrm ? (osrm.distance / 1000).toFixed(2) : haversine(team.lat, team.lng, fire.lat, fire.lng).toFixed(2);
    const etaMin  = osrm ? Math.round(osrm.duration / 60) : (team.speed > 0 ? Math.round(distKm / team.speed * 60) : 0);
    return { osrm, coords, distKm, etaMin, sp };
  };

  _routeOptions = {
    safe:     buildOpt(safeOSRM,     safeSP),
    balanced: buildOpt(balancedOSRM, balancedSP),
    fast:     buildOpt(fastOSRM,     null)
  };
  _routeCtx = { team, fire, score: teamScore(team, fire) };
  // Tehlike varsa güvenli'yi öner; yoksa hızlıyı öner
  _activeRouteKey = (safeSP && safeSP.avoided.length > 0) ? 'safe' : 'fast';

  renderRouteResult();
}

function selectRouteOption(key) {
  _activeRouteKey = key;
  renderRouteResult();
}

function renderRouteResult() {
  if (!_routeCtx || !_routeOptions.safe) return;
  const { team, fire, score } = _routeCtx;
  const active     = _routeOptions[_activeRouteKey];
  const hasDetour  = active.sp && active.sp.avoided.length > 0;
  const stepsHTML  = active.osrm ? buildStepsHTML(active.osrm.legs) : '';

  // Rota seçenek kartları
  const optCard = (key, icon, label, color) => {
    const opt = _routeOptions[key];
    const on  = key === _activeRouteKey;
    const cnt = opt.sp ? opt.sp.avoided.length : 0;
    return `
      <div class="route-option-card ${on ? 'active' : ''} ${key}-route" onclick="selectRouteOption('${key}')">
        <div class="ro-icon">${icon}</div>
        <div class="ro-label" style="color:${color}">${label}</div>
        <div class="ro-dist">${opt.distKm} km</div>
        <div class="ro-eta">${opt.etaMin} dk</div>
        <div class="ro-avoid" style="color:${cnt > 0 ? '#ff9944' : '#6e7681'}">
          ${cnt > 0 ? cnt + ' yangın atlandı' : 'Direkt rota'}
        </div>
      </div>`;
  };

  const routeLabel = {
    safe:     'OSRM (En Güvenli)',
    balanced: 'OSRM (Dengeli)',
    fast:     active.osrm ? 'OSRM (En Hızlı)' : 'Düz Çizgi'
  }[_activeRouteKey];
  const routeColor = hasDetour ? '#ff9944' : (active.osrm ? '#3fb950' : '#d29922');

  const safeInfoHTML = hasDetour
    ? `<div class="safe-path-info detour">
        <div>
          <div style="font-weight:600;margin-bottom:4px">⚠️ Tehlike Bölgeleri Atlandı — Güvenli Rota Uygulandı</div>
          <div style="opacity:0.9">${active.sp.avoided.length} aktif yangın güzergahtan çıkarıldı. Mesafe ve süre biraz artabilir.</div>
          <div class="safe-path-avoided">${active.sp.avoided.map(id => `<span class="avoided-tag">🔥 ${id}</span>`).join('')}</div>
        </div>
      </div>`
    : `<div class="safe-path-info safe">✅ Güvenli Rota — Aktif yangın yayılım bölgesi geçilmiyor</div>`;

  const detourSteps = hasDetour
    ? [...new Set(active.sp.avoided)].map(avId => `
        <div class="route-step">
          <div class="step-line">
            <div class="step-dot" style="background:#ff9944"></div>
            <div class="step-connector" style="background:#ff9944;opacity:0.35"></div>
          </div>
          <div class="step-info">
            <div class="step-title" style="color:#ff9944">⚠️ ${avId} — Detour uygulandı</div>
            <div class="step-detail">Yangın yayılım bölgesi güvenli şekilde aşıldı</div>
          </div>
        </div>`).join('')
    : '';

  const distPct = Math.round(Math.max(0, 1 - active.distKm / 30) * 100);

  document.getElementById('routeResult').innerHTML = `
    <div class="card mt-3">
      <div class="route-options">
        ${optCard('safe',     '🛡️', 'En Güvenli', '#3fb950')}
        ${optCard('balanced', '⚖️', 'Dengeli',    '#58a6ff')}
        ${optCard('fast',     '🏎️', 'En Hızlı',   '#d29922')}
      </div>

      <div class="card-header" style="padding-top:0">
        <div class="card-icon">🗺</div>
        <div>
          <div class="card-title">Rota Hesaplandı</div>
          <div class="card-subtitle">${team.name} → ${fire.id} · <span style="color:${routeColor}">${routeLabel}</span></div>
        </div>
      </div>

      ${safeInfoHTML}

      <div class="route-step">
        <div class="step-line"><div class="step-dot blue"></div><div class="step-connector"></div></div>
        <div class="step-info">
          <div class="step-title">${team.name} (${team.vehicleId})</div>
          <div class="step-detail">${team.lat.toFixed(4)}, ${team.lng.toFixed(4)} · Su: %${team.water} · ${team.personnel} personel</div>
        </div>
      </div>
      ${detourSteps}
      <div class="route-step">
        <div class="step-line"><div class="step-dot"></div></div>
        <div class="step-info">
          <div class="step-title">${fire.id} Yangın Alanı</div>
          <div class="step-detail">${fire.lat.toFixed(4)}, ${fire.lng.toFixed(4)} · ${terrainLabel(fire.terrain)} · Yarıçap: ${Math.round(fire.radius)}m</div>
        </div>
      </div>

      <div class="sep"></div>
      <div class="info-row"><span class="key">Yol Mesafesi</span><span class="val">${active.distKm} km</span></div>
      <div class="info-row"><span class="key">Tahmini Varış Süresi</span><span class="val" style="color:#3fb950">${active.etaMin} dakika</span></div>
      <div class="info-row"><span class="key">Ekip Uygunluk Skoru</span><span class="val" style="color:#58a6ff">%${Math.round(score * 100)}</span></div>
      <div class="info-row"><span class="key">Güvenlik Seviyesi</span><span class="val" style="color:${routeColor}">${hasDetour ? 'Maksimum — Tehlike önlendi' : (_activeRouteKey === 'fast' ? 'Temel — Tehlike analizi yok' : 'Yüksek')}</span></div>

      <div class="sep"></div>
      <div style="font-size:11px;color:#6e7681;margin-bottom:6px">SKOR ANALİZİ</div>
      <div class="score-bar"><span class="score-label">Su Seviyesi</span><div class="score-track"><div class="score-fill" style="width:${team.water}%"></div></div><span class="score-val">%${team.water}</span></div>
      <div class="score-bar"><span class="score-label">Personel</span><div class="score-track"><div class="score-fill" style="width:${Math.min(100, team.personnel / 5 * 100)}%"></div></div><span class="score-val">${team.personnel}/5</span></div>
      <div class="score-bar"><span class="score-label">Mesafe</span><div class="score-track"><div class="score-fill" style="width:${distPct}%"></div></div><span class="score-val">${active.distKm}km</span></div>

      ${stepsHTML}

      <div class="btn-group">
        ${RoleBasedController.can('route.dispatch') ? `<button class="btn btn-primary" onclick="dispatchSpecific('${team.id}','${fire.id}')">🚒 Bu Ekibi Gönder</button>` : ''}
        <button class="btn btn-secondary" onclick="showRouteOnMap('${team.id}','${fire.id}')">🗺 Ana Haritada Göster</button>
      </div>
    </div>`;

  drawRouteOnMap(routeMap, team, fire, active.coords, active.sp);
  AppState._lastRouteCoords  = active.coords;
  AppState._lastRouteTeamId  = team.id;
  AppState._lastRouteFireId  = fire.id;
}

function drawRouteOnMap(targetMap, team, fire, routeCoords, safeResult) {
  if (!targetMap) return;

  targetMap.eachLayer(l => {
    if (l instanceof L.Marker || l instanceof L.Polyline || l instanceof L.Circle || l instanceof L.CircleMarker) {
      l.remove();
    }
  });

  if (!routeCoords) return;

  const hasDetour = safeResult && safeResult.waypoints && safeResult.waypoints.length > 0;

  // Tehlike bölgelerini önce çiz (arkada kalsın)
  if (safeResult && safeResult.zones) {
    safeResult.zones.forEach(zone => {
      L.circle([zone.lat, zone.lng], {
        color: '#ff7700', fillColor: '#ff7700', fillOpacity: 0.07,
        radius: zone.radius, weight: 1.5, dashArray: '6 4'
      }).addTo(targetMap);
      L.circleMarker([zone.lat, zone.lng], {
        radius: 8, color: '#ff7700', fillColor: '#ff7700', fillOpacity: 0.85, weight: 2
      }).bindTooltip('⚠️ Tehlike Bölgesi', { permanent: false, direction: 'top' }).addTo(targetMap);
    });
  }

  // Detour waypoint'leri
  if (safeResult && safeResult.waypoints) {
    safeResult.waypoints.forEach((wp, i) => {
      L.circleMarker(wp, {
        radius: 6, color: '#ff9944', fillColor: '#ffcc88', fillOpacity: 1, weight: 2
      }).bindTooltip(`Detour ${i + 1}`, { permanent: false }).addTo(targetMap);
    });
  }

  // Ekip markeri
  L.marker([team.lat, team.lng], { icon: teamIcons[team.status] || teamIcons.available })
    .bindPopup(`<b>${team.name}</b><br>Su: %${team.water} · ${team.personnel} personel`)
    .addTo(targetMap)
    .openPopup();

  // Yangın markeri ve yayılma dairesi
  L.marker([fire.lat, fire.lng], { icon: fireIcon })
    .bindPopup(`<b>${fire.id}</b><br>${terrainLabel(fire.terrain)} · ${Math.round(fire.radius)}m`)
    .addTo(targetMap);
  L.circle([fire.lat, fire.lng], {
    color: '#e63946', fillColor: '#e63946', fillOpacity: 0.12, radius: fire.radius, weight: 1.5
  }).addTo(targetMap);

  // Rota çizgisi: detour ise turuncu, normal ise mavi
  const lineColor   = hasDetour ? '#ff9944' : '#58a6ff';
  const shadowColor = hasDetour ? '#3d2200' : '#1a3a5c';
  L.polyline(routeCoords, { color: shadowColor, weight: 6, opacity: 0.55 }).addTo(targetMap);
  L.polyline(routeCoords, { color: lineColor,   weight: 3, opacity: 0.95 }).addTo(targetMap);

  L.circleMarker(routeCoords[0],                      { radius: 7, color: '#58a6ff', fillColor: '#58a6ff', fillOpacity: 1, weight: 2 }).addTo(targetMap);
  L.circleMarker(routeCoords[routeCoords.length - 1], { radius: 7, color: '#e63946', fillColor: '#e63946', fillOpacity: 1, weight: 2 }).addTo(targetMap);

  targetMap.fitBounds(L.latLngBounds(routeCoords), { padding: [40, 40] });
}

function dispatchSpecific(teamId, fireId) {
  const team = AppState.teams.find(t => t.id === teamId);
  const fire = AppState.fires.find(f => f.id === fireId);
  if (!team || !fire) return;
  dbAssignTeam(teamId, fireId);
  dbAddNotification(`${team.name} ${fireId} yangınına gönderildi.`, 'info');
  addLog(`${team.name} → ${fireId} yangınına yönlendirildi`, 'warn');
  alert(team.name + ' ' + fireId + ' yangınına yönlendirildi!');
}

async function showRouteOnMap(teamId, fireId) {
  const team = AppState.teams.find(t => t.id === teamId);
  const fire = AppState.fires.find(f => f.id === fireId);
  if (!team || !fire || !map) return;

  navTo('map');

  // Daha önce hesaplanan rota varsa kullan, yoksa yeniden al
  let coords = null;
  if (AppState._lastRouteTeamId === teamId && AppState._lastRouteFireId === fireId && AppState._lastRouteCoords) {
    coords = AppState._lastRouteCoords;
  } else {
    addLog('Ana harita için yol rotası alınıyor...', 'info');
    const osrm = await fetchOSRMRoute(team.lat, team.lng, fire.lat, fire.lng);
    coords = osrm ? geojsonToLatLng(osrm.geometry.coordinates) : [[team.lat, team.lng], [fire.lat, fire.lng]];
  }

  setTimeout(() => {
    // Önceki rota katmanlarını temizle
    if (routeLayer) {
      if (Array.isArray(routeLayer)) { routeLayer.forEach(l => l.remove()); }
      else { routeLayer.remove(); }
      routeLayer = null;
    }

    const shadow = L.polyline(coords, { color: '#1a3a5c', weight: 6, opacity: 0.6 }).addTo(map);
    const line   = L.polyline(coords, { color: '#58a6ff', weight: 3, opacity: 0.95 }).addTo(map);
    routeLayer = [shadow, line];

    L.circleMarker(coords[0], { radius: 7, color: '#58a6ff', fillColor: '#58a6ff', fillOpacity: 1, weight: 2 }).addTo(map);
    L.circleMarker(coords[coords.length - 1], { radius: 7, color: '#e63946', fillColor: '#e63946', fillOpacity: 1, weight: 2 }).addTo(map);

    const bounds = L.latLngBounds(coords);
    map.fitBounds(bounds, { padding: [60, 60] });
  }, 200);
}

// ---- MANAGEMENT PANEL ----
function renderMgmt() {
  // Users table
  document.getElementById('usersTableBody').innerHTML = AppState.users.map(u => `
    <tr>
      <td>${u.name}</td>
      <td><span class="badge ${u.role === 'merkez' ? 'badge-red' : u.role === 'sef' ? 'badge-yellow' : 'badge-blue'}">${roleLabel(u.role)}</span></td>
      <td>${u.username}</td>
      <td>${u.email}</td>
      <td><span class="badge ${u.active ? 'badge-green' : 'badge-gray'}">${u.active ? 'Aktif' : 'Pasif'}</span></td>
      <td>
        <div style="display:flex;gap:4px;flex-wrap:wrap">
          <button class="btn btn-secondary btn-sm" onclick="showEditUserModal('${u.id}')">✏️</button>
          <button class="btn btn-secondary btn-sm" onclick="toggleUser('${u.id}')">${u.active ? 'Pasif' : 'Aktif'}</button>
          <button class="btn btn-secondary btn-sm" style="color:#f85149" onclick="deleteUser('${u.id}')">🗑</button>
        </div>
      </td>
    </tr>`).join('');

  // Team management
  const tmg = document.getElementById('teamsMgmtContainer');
  if (tmg) {
    tmg.innerHTML = AppState.teams.map(team => {
      const members = AppState.users.filter(u => u.teamId === team.id);
      return `
      <div style="background:#0d1117;border:1px solid #21262d;border-radius:8px;padding:14px;margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div>
            <span style="font-weight:600;color:#e6edf3">${team.name}</span>
            <span style="font-size:11px;color:#6e7681;margin-left:8px">${team.vehicleId} · Şef: ${team.chief}</span>
            <span class="badge ${statusBadgeClass(team.status)}" style="margin-left:6px">${statusLabel(team.status)}</span>
          </div>
          <div style="display:flex;gap:6px">
            <button class="btn btn-secondary btn-sm" onclick="showAddMemberModal('${team.id}')">+ Üye Ekle</button>
            <button class="btn btn-secondary btn-sm" style="color:#f85149" onclick="deleteTeam('${team.id}')">🗑 Sil</button>
          </div>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;min-height:28px">
          ${members.length === 0 ? '<span style="color:#6e7681;font-size:12px">Henüz üye yok</span>' :
            members.map(u => `
              <div style="display:inline-flex;align-items:center;gap:5px;background:#161b22;border:1px solid #30363d;border-radius:20px;padding:3px 8px 3px 8px;font-size:12px">
                <span>${u.role === 'sef' ? '👨‍🚒' : '👷'}</span>
                <span style="color:#c9d1d9">${u.name}</span>
                <span class="badge ${u.role === 'sef' ? 'badge-yellow' : 'badge-blue'}" style="font-size:9px;padding:1px 5px">${roleLabel(u.role)}</span>
                <button onclick="removeMember('${u.id}','${team.id}')" style="background:none;border:none;color:#f85149;cursor:pointer;font-size:13px;line-height:1;padding:0 2px;margin-left:2px" title="Ekipten çıkar">✕</button>
              </div>`).join('')}
        </div>
        <div style="display:flex;gap:16px;margin-top:10px;font-size:11px;color:#8b949e">
          <span>💧 Su: %${team.water}</span>
          <span>👥 Personel: ${team.personnel}</span>
          ${team.assignedFire ? `<span style="color:#d29922">🔥 ${team.assignedFire}</span>` : ''}
        </div>
      </div>`;
    }).join('') || '<div style="color:#6e7681;text-align:center;padding:20px">Henüz ekip yok</div>';
  }

  // Logs
  document.getElementById('logsContainer').innerHTML = AppState.logs.slice(0, 20).map(l => `
    <div class="log-entry">
      <span class="log-time">${l.time.slice(0, 5)}</span>
      <div class="log-dot" style="background:${l.type==='warn'?'#d29922':l.type==='danger'?'#e63946':l.type==='success'?'#3fb950':'#58a6ff'}"></div>
      <span class="log-text">${l.text}</span>
    </div>`).join('') || '<div class="text-muted">Henüz log yok</div>';

  // Incident Reports (merkez only)
  const role = AppState.currentUser?.role;
  let reportsSection = document.getElementById('reportsSection');
  if (role === 'merkez') {
    if (!reportsSection) {
      reportsSection = document.createElement('div');
      reportsSection.id = 'reportsSection';
      reportsSection.className = 'mgmt-section';
      reportsSection.style.gridColumn = '1 / -1';
      document.querySelector('.mgmt-grid').appendChild(reportsSection);
    }
    const reports = (AppState.reports || []).slice().sort((a, b) => b.submittedAt - a.submittedAt);
    reportsSection.innerHTML = `
      <div class="mgmt-section-header">
        <h3>📋 Yangın Söndürme Raporları</h3>
        <span style="font-size:12px;color:#6e7681">${reports.length} rapor</span>
      </div>
      ${reports.length === 0
        ? '<div style="padding:20px;color:#6e7681;text-align:center">Henüz gönderilen rapor yok</div>'
        : reports.map(r => {
            const dur = r.durationMin < 60 ? r.durationMin + ' dk' : Math.floor(r.durationMin/60) + 's ' + (r.durationMin%60) + 'dk';
            return `
            <div style="background:#0d1117;border:1px solid #21262d;border-radius:8px;padding:14px;margin-bottom:10px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
                <div>
                  <span style="font-weight:600;color:#e6edf3;font-size:14px">🔥 ${r.fireId}</span>
                  <span class="badge badge-green" style="margin-left:8px">Söndürüldü</span>
                </div>
                <span style="font-size:11px;color:#6e7681">${r.submittedAtStr}</span>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px">
                <div style="color:#8b949e">Konum: <span style="color:#c9d1d9">${r.fireData.lat.toFixed(4)}, ${r.fireData.lng.toFixed(4)}</span></div>
                <div style="color:#8b949e">Arazi: <span style="color:#c9d1d9">${terrainLabel(r.fireData.terrain)}</span></div>
                <div style="color:#8b949e">Son Yoğunluk: <span style="color:#c9d1d9">${intensityLabel(r.fireData.intensity)}</span></div>
                <div style="color:#8b949e">Son Yarıçap: <span style="color:#c9d1d9">${r.fireData.radius} m</span></div>
                <div style="color:#8b949e">Müdahale Süresi: <span style="color:#3fb950;font-weight:600">${dur}</span></div>
                <div style="color:#8b949e">Raporu Onaylayan: <span style="color:#d29922">${r.approvedBy}</span></div>
                <div style="color:#8b949e;grid-column:1/-1">Müdahale Eden Ekip(ler): <span style="color:#58a6ff">${(r.teamNames || []).join(', ') || '—'}</span></div>
                <div style="color:#8b949e;grid-column:1/-1">Görevli Şef(ler): <span style="color:#d29922">${(r.chiefNames || []).join(', ') || '—'}</span></div>
              </div>
            </div>`;
          }).join('')}`;
  }
}

function toggleUser(userId) {
  const user = AppState.users.find(u => u.id === userId);
  if (!user) return;
  const newActive = !user.active;
  dbToggleUser(userId, newActive);
  addLog(`Kullanıcı ${user.name} ${newActive ? 'aktif' : 'pasif'} hale getirildi`, 'info');
}

function showAddUserModal() {
  document.getElementById('addUserModal').classList.add('open');
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}
function saveUser() {
  const name  = document.getElementById('newUserName').value.trim();
  const role  = document.getElementById('newUserRole').value;
  const uname = document.getElementById('newUserUsername').value.trim();
  const email = document.getElementById('newUserEmail').value.trim();
  const pass  = document.getElementById('newUserPassword').value.trim();
  if (!name || !uname || !email || !pass) { alert('Tüm alanlar zorunludur!'); return; }
  if (AppState.users.some(u => u.username === uname)) { alert('Bu kullanıcı adı zaten kullanılıyor!'); return; }
  const id = 'U' + Date.now();
  dbAddUser({ id, name, role, username: uname, email, password: pass, active: true, teamId: null });
  addLog(`Yeni kullanıcı eklendi: ${name}`, 'success');
  dbAddNotification('Yeni kullanıcı oluşturuldu: ' + name, 'info');
  closeModal('addUserModal');
  ['newUserName','newUserUsername','newUserEmail','newUserPassword'].forEach(id => document.getElementById(id).value = '');
}

// ---- KULLANICI DÜZENLEME & SİLME ----
function showEditUserModal(userId) {
  const u = AppState.users.find(x => x.id === userId);
  if (!u) return;
  document.getElementById('editUserId').value    = userId;
  document.getElementById('editUserName').value  = u.name;
  document.getElementById('editUserRole').value  = u.role;
  document.getElementById('editUserUsername').value = u.username;
  document.getElementById('editUserEmail').value = u.email || '';
  document.getElementById('editUserPassword').value = '';
  document.getElementById('editUserModal').classList.add('open');
}

function saveEditUser() {
  const userId = document.getElementById('editUserId').value;
  const name   = document.getElementById('editUserName').value.trim();
  const role   = document.getElementById('editUserRole').value;
  const uname  = document.getElementById('editUserUsername').value.trim();
  const email  = document.getElementById('editUserEmail').value.trim();
  const pass   = document.getElementById('editUserPassword').value.trim();
  if (!name || !uname) { alert('Ad ve kullanıcı adı zorunludur!'); return; }
  const data = { name, role, username: uname, email };
  if (pass) data.password = pass;
  dbUpdateUser(userId, data);
  addLog('Kullanıcı güncellendi: ' + name, 'info');
  closeModal('editUserModal');
}

function deleteUser(userId) {
  const u = AppState.users.find(x => x.id === userId);
  if (!confirm(`"${u?.name}" kullanıcısını kalıcı olarak silmek istiyor musunuz?`)) return;
  if (u?.teamId) dbRemoveTeamMember(userId, u.teamId);
  dbDeleteUser(userId);
  addLog('Kullanıcı silindi: ' + u?.name, 'warn');
}

// ---- EKİP YÖNETİMİ ----
function showAddTeamModal() {
  // Şef listesi: tüm aktif şefler — birden fazla ekip yönetebilir
  const sefUsers = AppState.users.filter(u => u.role === 'sef' && u.active !== false);
  const chiefSel = document.getElementById('newTeamChiefSelect');
  chiefSel.innerHTML = '<option value="">-- Şef Seçin (İsteğe Bağlı) --</option>' +
    sefUsers.map(u => {
      const teamCount = AppState.teams.filter(t => t.chiefUserId === u.id).length;
      const info = teamCount > 0 ? ` · ${teamCount} ekip yönetiyor` : '';
      return `<option value="${u.id}">${u.name}${info}</option>`;
    }).join('');

  // Araç listesi: kullanımdaki araçları işaretle
  const usedVehicles = new Set(AppState.teams.map(t => t.vehicleId));
  const vehicleSel = document.getElementById('newTeamVehicle');
  vehicleSel.innerHTML = '<option value="">-- Araç Seçin --</option>' +
    VEHICLES.map(v => {
      const inUse = usedVehicles.has(v.id);
      return `<option value="${v.id}" ${inUse ? 'disabled' : ''}>${v.id} · ${v.type}${inUse ? ' (Kullanımda)' : ''}</option>`;
    }).join('');

  // Üye listesi: ekip rolü + henüz ekipsiz
  const ekipUsers = AppState.users.filter(u => u.role === 'ekip' && !u.teamId);
  const membersBox = document.getElementById('newTeamMembersContainer');
  membersBox.innerHTML = ekipUsers.length === 0
    ? '<div style="color:#6e7681;font-size:12px;padding:4px">Ekipsiz ekip üyesi yok</div>'
    : ekipUsers.map(u => `
        <label style="display:flex;align-items:center;gap:8px;padding:5px 0;cursor:pointer;font-size:13px;color:#c9d1d9">
          <input type="checkbox" value="${u.id}" style="accent-color:#e63946;width:14px;height:14px">
          ${u.name}
        </label>`).join('');

  document.getElementById('addTeamModal').classList.add('open');
}

function saveTeam() {
  const name    = document.getElementById('newTeamName').value.trim();
  const vehicle = document.getElementById('newTeamVehicle').value;
  const chiefId = document.getElementById('newTeamChiefSelect').value;
  if (!name || !vehicle) { alert('Ekip adı ve araç seçimi zorunludur!'); return; }
  const vehicleType = VEHICLES.find(v => v.id === vehicle)?.type || '';

  const chiefUser = chiefId ? AppState.users.find(u => u.id === chiefId) : null;
  const chiefName = chiefUser ? chiefUser.name : 'Belirtilmedi';

  const checked = Array.from(document.querySelectorAll('#newTeamMembersContainer input[type="checkbox"]:checked'));
  const memberIds = checked.map(cb => cb.value);

  const personnel = memberIds.length + (chiefId ? 1 : 0);
  const id = 'T' + Date.now();

  // Tek seferde tüm güncellemeleri yaz
  const updates = {};
  updates['teams/' + id] = {
    id, name, vehicleId: vehicle, vehicleType,
    chief: chiefName, chiefUserId: chiefId || null,
    lat: 39.9208, lng: 32.8700,
    status: 'available',
    water: 100, maxWater: 100, personnel,
    equipment: {}, assignedFire: null, speed: 60
  };
  // Şef birden fazla ekip yönetebilir — teamId güncellenmez, chiefUserId takip eder
  memberIds.forEach(uid => { updates['users/' + uid + '/teamId'] = id; });
  db.ref().update(updates);

  addLog(`Yeni ekip oluşturuldu: ${name} (${personnel} personel)`, 'success');
  dbAddNotification('Yeni ekip oluşturuldu: ' + name, 'info');
  closeModal('addTeamModal');
  document.getElementById('newTeamName').value = '';
  document.getElementById('newTeamVehicle').value = '';
}

function showAddMemberModal(teamId) {
  const team = AppState.teams.find(t => t.id === teamId);
  document.getElementById('addMemberTeamId').value = teamId;
  document.getElementById('addMemberTeamName').textContent = team ? team.name : teamId;
  const available = AppState.users.filter(u => !u.teamId);
  const sel = document.getElementById('addMemberSelect');
  sel.innerHTML = '<option value="">-- Kullanıcı Seç --</option>' +
    available.map(u => `<option value="${u.id}">${u.name} (${roleLabel(u.role)})</option>`).join('');
  document.getElementById('addMemberModal').classList.add('open');
}

function saveMember() {
  const teamId = document.getElementById('addMemberTeamId').value;
  const userId = document.getElementById('addMemberSelect').value;
  if (!userId) { alert('Bir kullanıcı seçin!'); return; }
  const user = AppState.users.find(u => u.id === userId);
  const team = AppState.teams.find(t => t.id === teamId);
  dbAddTeamMember(userId, teamId);
  addLog(`${user?.name} → ${team?.name} ekibine eklendi`, 'success');
  closeModal('addMemberModal');
}

function removeMember(userId, teamId) {
  const user = AppState.users.find(u => u.id === userId);
  const team = AppState.teams.find(t => t.id === teamId);
  if (!confirm(`${user?.name} adlı kişiyi ${team?.name} ekibinden çıkarmak istiyor musunuz?`)) return;
  dbRemoveTeamMember(userId, teamId);
  addLog(`${user?.name} ${team?.name} ekibinden çıkarıldı`, 'info');
}

function deleteTeam(teamId) {
  const team = AppState.teams.find(t => t.id === teamId);
  if (!confirm(`"${team?.name}" ekibini silmek istiyor musunuz?\nEkip üyeleri ve araç atamaları kaldırılacak.`)) return;

  const members = AppState.users.filter(u => u.teamId === teamId);
  const updates = {};
  members.forEach(u => { updates['users/' + u.id + '/teamId'] = null; });
  if (team?.assignedFire) {
    updates['fires/' + team.assignedFire + '/assignedTeams/' + teamId] = null;
  }
  db.ref().update(updates).then(() => dbDeleteTeam(teamId));

  addLog(`${team?.name} ekibi silindi`, 'warn');
  dbAddNotification(`${team?.name} ekibi sistemden kaldırıldı`, 'info');
}

// ---- ŞİFRE DEĞİŞTİR ----
function showChangePasswordModal() {
  ['cpCurrentPass','cpNewPass','cpNewPass2'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('changePasswordModal').classList.add('open');
}

function saveChangePassword() {
  const current = document.getElementById('cpCurrentPass').value;
  const newPass  = document.getElementById('cpNewPass').value;
  const newPass2 = document.getElementById('cpNewPass2').value;
  const user = AppState.users.find(u => u.id === AppState.currentUser.id);
  if (!user || user.password !== current) { alert('Mevcut şifre hatalı!'); return; }
  if (!newPass)              { alert('Yeni şifre boş olamaz!'); return; }
  if (newPass !== newPass2)  { alert('Yeni şifreler eşleşmiyor!'); return; }
  dbUpdateUser(AppState.currentUser.id, { password: newPass });
  addLog('Şifre değiştirildi', 'info');
  closeModal('changePasswordModal');
  alert('Şifreniz başarıyla güncellendi!');
}

// ---- TASK PANEL (Ekip Üyesi) ----
function renderTaskPanel() {
  const container = document.getElementById('taskContent');
  if (!container) return;
  const user = AppState.currentUser;
  const myTeam = AppState.teams.find(t => t.id === user.teamId);

  if (!myTeam) {
    container.innerHTML = `
      <div class="card" style="text-align:center;padding:36px">
        <div style="font-size:40px;margin-bottom:12px">🚒</div>
        <div style="font-size:17px;color:#e6edf3;margin-bottom:8px">Ekip Atanmamış</div>
        <div style="color:#8b949e;font-size:13px">Bu hesap henüz bir ekibe bağlı değil.</div>
      </div>`;
    return;
  }

  const fire = myTeam.assignedFire ? AppState.fires.find(f => f.id === myTeam.assignedFire) : null;
  const wp = myTeam.water;
  const wc = wp >= 70 ? 'high' : wp >= 40 ? 'mid' : 'low';
  const requiredEquip = ['maske', 'hortum', 'söndürücü'];
  const equipTags = requiredEquip.map(e => {
    const has = myTeam.equipment.includes(e);
    return `<span class="equip-tag ${has ? '' : 'missing'}">${has ? '✓' : '✗'} ${e}</span>`;
  }).join('');

  // Bireysel tamamlama bilgisi
  let fireSection = '';
  if (fire) {
    const teamCompletions = (fire.taskCompletions || {})[myTeam.id] || {};
    const allMembers = AppState.users.filter(u => u.teamId === myTeam.id && u.active !== false);
    const myDone = teamCompletions[user.id] || false;
    const doneCount = allMembers.filter(u => teamCompletions[u.id]).length;

    const memberRows = allMembers.map(u => {
      const done = teamCompletions[u.id];
      return `<div style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:12px">
        <span>${done ? '✅' : '⏳'}</span>
        <span style="color:${done ? '#c9d1d9' : '#6e7681'}">${u.name}</span>
        ${u.id === user.id ? '<span style="font-size:10px;color:#58a6ff">(Siz)</span>' : ''}
      </div>`;
    }).join('');

    const actionSection = myDone
      ? `<div style="padding:10px 12px;background:rgba(63,185,80,0.1);border:1px solid #3fb950;border-radius:6px;font-size:12px;color:#3fb950;margin-top:4px">
          ✅ Görevinizi tamamladınız &nbsp;·&nbsp; ${doneCount}/${allMembers.length} üye tamamladı
         </div>`
      : `<div class="btn-group">
          <button class="btn btn-success btn-sm" onclick="memberCompleteTask()">✅ Görevi Tamamla</button>
          <button class="btn btn-secondary btn-sm" onclick="focusOnMap('${fire.id}')">🗺 Haritada Gör</button>
         </div>`;

    fireSection = `
    <div class="card">
      <div class="card-header">
        <div class="card-icon">🔥</div>
        <div>
          <div class="card-title">Aktif Görev: ${fire.id}</div>
          <div class="card-subtitle">${terrainLabel(fire.terrain)} · Başlangıç: ${timeStr(fire.startTime)}</div>
        </div>
        <div class="card-status">
          <span class="badge ${fire.intensity === 'high' ? 'badge-red' : fire.intensity === 'medium' ? 'badge-yellow' : 'badge-green'}">${intensityLabel(fire.intensity)}</span>
        </div>
      </div>
      <div class="info-row"><span class="key">Konum</span><span class="val">${fire.lat.toFixed(4)}, ${fire.lng.toFixed(4)}</span></div>
      <div class="info-row"><span class="key">Yarıçap</span><span class="val">${Math.round(fire.radius)} m</span></div>
      <div class="info-row"><span class="key">Geçen Süre</span><span class="val">${elapsed(fire.startTime)}</span></div>
      <div style="margin-top:10px;padding:10px;background:#0d1117;border-radius:6px;border:1px solid #21262d">
        <div style="font-size:10px;color:#6e7681;text-transform:uppercase;margin-bottom:6px">Ekip Tamamlama Durumu</div>
        ${memberRows}
      </div>
      ${actionSection}
    </div>`;
  } else {
    fireSection = `
    <div class="card" style="text-align:center;padding:28px;color:#8b949e">
      <div style="font-size:36px;margin-bottom:10px">✅</div>
      <div style="font-size:15px;color:#3fb950;margin-bottom:6px">Aktif Görev Yok</div>
      <div style="font-size:12px">Şu anda atanmış bir yangın bulunmuyor.</div>
    </div>`;
  }

  container.innerHTML = `
    <div class="card mb-3">
      <div class="card-header">
        <div class="card-icon">🚒</div>
        <div>
          <div class="card-title">${myTeam.name}</div>
          <div class="card-subtitle">${myTeam.vehicleId} · Şef: ${myTeam.chief}</div>
        </div>
        <div class="card-status">
          <span class="badge ${statusBadgeClass(myTeam.status)}">${statusLabel(myTeam.status)}</span>
        </div>
      </div>
      <div class="info-row"><span class="key">Personel</span><span class="val">${myTeam.personnel} kişi</span></div>
      <div class="info-row"><span class="key">Su Seviyesi</span><span class="val">${wp}%</span></div>
      <div class="progress-bar"><div class="progress-fill ${wc}" style="width:${wp}%"></div></div>
      <div class="info-row mt-2"><span class="key">Ekipman</span><span class="val">${myTeam.equipment.join(', ')}</span></div>
      <div class="equip-tags" style="margin-top:8px">${equipTags}</div>
      <div class="btn-group" style="margin-top:12px">
        <button class="btn btn-secondary btn-sm" onclick="updateTeamWater('${myTeam.id}')">💧 Su Seviyesi Güncelle</button>
        <button class="btn btn-secondary btn-sm" onclick="focusOnTeam('${myTeam.id}')">🗺 Haritada Gör</button>
      </div>
    </div>
    ${fireSection}
  `;
}

function memberCompleteTask() {
  const user   = AppState.currentUser;
  const myTeam = AppState.teams.find(t => t.id === user.teamId);
  if (!myTeam?.assignedFire) return;
  dbMarkMemberComplete(myTeam.assignedFire, myTeam.id, user.id);
  addLog('Görev tamamlama bildirimi gönderildi', 'info');
}

// ---- NOTIFICATIONS ----
function toggleNotif() {
  document.getElementById('notifPanel').classList.toggle('open');
}
function updateNotifBadge() {
  const count = unreadCount();
  const badge = document.getElementById('notifBadge');
  badge.textContent = count;
  badge.style.display = count > 0 ? 'flex' : 'none';
}
function markAllRead() {
  dbMarkAllNotifsRead();
}
function renderNotifPanel() {
  document.getElementById('notifList').innerHTML = AppState.notifications.slice(0, 8).map(n => `
    <div class="notif-item ${n.read ? '' : 'unread'}" onclick="markNotifRead(${n.id})">
      <div class="ntext">${n.type === 'danger' ? '🚨' : n.type === 'warning' ? '⚠️' : n.type === 'success' ? '✅' : 'ℹ️'} ${n.text}</div>
      <div class="ntime">${n.time}</div>
    </div>`).join('');
}
function markNotifRead(id) {
  dbMarkNotifRead(id);
}

document.addEventListener('click', e => {
  const panel = document.getElementById('notifPanel');
  const btn = document.getElementById('notifBtn');
  if (!panel.contains(e.target) && !btn.contains(e.target)) panel.classList.remove('open');
});

// ---- RENDER ALL ----
function renderAll() {
  renderMapInfo();
  updateNotifBadge();
  renderNotifPanel();
}


function logout() {
  if (confirm('Çıkış yapmak istiyor musunuz?')) {
    sessionStorage.removeItem('fc_user');
    window.location.href = 'index.html';
  }
}
