// ============================================================
//  FireCoord — App State & Utilities
// ============================================================

const AppState = {
  currentUser: null,
  windDirection: 'NE',
  windSpeed: 25,
  temperature: 32,
  humidity: 28,
  simRunning: false,
  simTick: 0,
  selectedFire: null,
  selectedTeam: null,
  logs: [],

  fires: [],
  teams: [],
  users: [],
  notifications: [],
  reports: [],

  _lastRouteCoords: null,
  _lastRouteTeamId: null,
  _lastRouteFireId: null
};

// ---- Firebase listener başlatma ----
let _locationWriteTick = 0;
let _simWriteTick = 0;

// Otomatik söndürme için: ekibi olan yangınları takip et
const _wasAssigned = new Set();

function initFirebaseListeners() {
  seedIfEmpty();

  listenFires(fires => {
    AppState.fires = fires;

    // Otomatik söndürme: tüm ekipler görevi bitirince
    fires.forEach(fire => {
      if (fire.status !== 'active') return;
      if (fire.assignedTeams.length > 0) {
        _wasAssigned.add(fire.id);
      } else if (_wasAssigned.has(fire.id)) {
        _wasAssigned.delete(fire.id);
        dbExtinguishFire(fire.id);
        dbAddNotification(fire.id + ' yangını söndürüldü — tüm ekipler görevi tamamladı!', 'success');
        addLog(fire.id + ' otomatik söndürüldü (tüm ekipler tamamladı).', 'success');
      }
    });

    renderMapMarkers();
    renderMapInfo();
    if (document.getElementById('panel-fires').classList.contains('active')) renderFires();
    if (document.getElementById('panel-route').classList.contains('active')) renderRoute();
    if (document.getElementById('panel-task').classList.contains('active')) renderTaskPanel();
    const badge = document.getElementById('fireBadge');
    if (badge) badge.textContent = fires.filter(f => f.status === 'active').length;
  });

  listenTeams(teams => {
    AppState.teams = teams;
    renderMapMarkers();
    if (document.getElementById('panel-fires').classList.contains('active')) renderFires();
    if (document.getElementById('panel-teams').classList.contains('active')) renderTeams();
    if (document.getElementById('panel-route').classList.contains('active')) renderRoute();
    if (document.getElementById('panel-task').classList.contains('active')) renderTaskPanel();
    if (document.getElementById('panel-mgmt').classList.contains('active')) renderMgmt();
  });

  listenNotifications(notifs => {
    AppState.notifications = notifs;
    renderNotifPanel();
    updateNotifBadge();
  });

  listenUsers(users => {
    AppState.users = users;
    if (document.getElementById('panel-mgmt').classList.contains('active')) renderMgmt();
  });

  listenReports(reports => {
    AppState.reports = reports;
    if (document.getElementById('panel-mgmt').classList.contains('active')) renderMgmt();
  });
}

// ---- Helpers ----

function statusLabel(s) {
  return { available: 'Uygun', on_duty: 'Görevde', maintenance: 'Bakımda', on_route: 'Yolda', extinguished: 'Söndürüldü', task_complete: 'Tamamlandı', pending_report: 'Onay Bekliyor' }[s] || s;
}

function statusBadgeClass(s) {
  return { available: 'badge-green', on_duty: 'badge-yellow', maintenance: 'badge-red', on_route: 'badge-blue', extinguished: 'badge-gray', task_complete: 'badge-green', pending_report: 'badge-yellow' }[s] || 'badge-gray';
}

function intensityLabel(i) {
  return { high: 'Yüksek', medium: 'Orta', low: 'Düşük' }[i] || i;
}

function terrainLabel(t) {
  return { forest: 'Orman', urban: 'Kentsel', field: 'Tarla', mountain: 'Dağlık' }[t] || t;
}

function roleLabel(r) {
  return { merkez: 'Merkez Op.', sef: 'İtfaiye Şefi', ekip: 'Ekip Üyesi' }[r] || r;
}

function elapsed(startTime) {
  const m = Math.floor((Date.now() - startTime) / 60000);
  if (m < 60) return m + ' dk';
  return Math.floor(m / 60) + 's ' + (m % 60) + 'dk';
}

function timeStr(d) {
  return (d instanceof Date ? d : new Date(d)).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

function nowStr() {
  return new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function teamScore(team, fire) {
  if (team.status === 'maintenance') return 0;
  const dist = haversine(team.lat, team.lng, fire.lat, fire.lng);
  const waterScore = team.water / team.maxWater;
  const personnelScore = Math.min(team.personnel / 5, 1);
  const distScore = Math.max(0, 1 - dist / 30);
  const statusBonus = team.status === 'available' ? 0.2 : 0;
  return waterScore * 0.35 + personnelScore * 0.25 + distScore * 0.3 + statusBonus;
}

function getBestTeam(fireId) {
  const fire = AppState.fires.find(f => f.id === fireId);
  if (!fire) return null;
  let best = null, bestScore = -1;
  AppState.teams.forEach(t => {
    const s = teamScore(t, fire);
    if (s > bestScore) { bestScore = s; best = t; }
  });
  return best ? { team: best, score: Math.round(bestScore * 100), distance: haversine(best.lat, best.lng, fire.lat, fire.lng).toFixed(1) } : null;
}

function addLog(text, type = 'info') {
  AppState.logs.unshift({ text, type, time: nowStr() });
  if (AppState.logs.length > 50) AppState.logs.pop();
}

function unreadCount() {
  return AppState.notifications.filter(n => !n.read).length;
}

// Yangın yayılım simülasyonu (kural tabanlı karar ağacı)
function spreadFire(fire) {
  const terrainMultiplier = { forest: 1.4, field: 1.1, urban: 0.8, mountain: 0.7 }[fire.terrain] || 1.0;
  const windMultiplier = AppState.windSpeed / 20;
  const humidityFactor = Math.max(0.3, 1 - AppState.humidity / 100);

  const windOpposite = { N: 'S', NE: 'SW', E: 'W', SE: 'NW', S: 'N', SW: 'NE', W: 'E', NW: 'SE' };
  fire.direction = windOpposite[AppState.windDirection] || AppState.windDirection;

  const growthPerTick = fire.spread_rate * terrainMultiplier * windMultiplier * humidityFactor;
  const suppressionFactor = fire.assignedTeams.length * 0.6;
  const netGrowth = Math.max(-20, growthPerTick - suppressionFactor);

  fire.radius = Math.max(50, fire.radius + netGrowth);

  if (fire.radius > 1000) fire.intensity = 'high';
  else if (fire.radius > 400) fire.intensity = 'medium';
  else fire.intensity = 'low';

  return netGrowth;
}
