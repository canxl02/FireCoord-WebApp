// ============================================================
//  FireCoord — Firebase Service
//  Mobil app ile aynı Realtime Database kullanır
// ============================================================

const firebaseConfig = {
  apiKey: "AIzaSyBdaHQtzyi097rtIH13EScBy17IWNMBLVk",
  authDomain: "firecoord-2da06.firebaseapp.com",
  databaseURL: "https://firecoord-2da06-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "firecoord-2da06",
  storageBucket: "firecoord-2da06.firebasestorage.app",
  messagingSenderId: "988925603140"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// ---- Dönüşüm yardımcıları ----
function mapToArr(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.filter(Boolean);
  return Object.values(val).filter(Boolean);
}

function mapKeysToArr(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.filter(Boolean);
  return Object.keys(val).filter(k => val[k]);
}

function parseFire(data) {
  return {
    id: data.id,
    lat: Number(data.lat),
    lng: Number(data.lng),
    radius: Number(data.radius) || 100,
    direction: data.direction || 'N',
    intensity: data.intensity || 'low',
    terrain: data.terrain || 'forest',
    startTime: data.startTime ? new Date(Number(data.startTime)) : new Date(),
    status: data.status || 'active',
    reportedBy: data.reportedBy || '-',
    assignedTeams: mapKeysToArr(data.assignedTeams),
    assignedChiefs: mapKeysToArr(data.assignedChiefs),
    spread_rate: Number(data.spreadRate || data.spread_rate) || 8,
    taskCompletions: data.taskCompletions || {}
  };
}

function parseTeam(data) {
  return {
    id: data.id,
    name: data.name || 'Ekip',
    vehicleId: data.vehicleId || '-',
    vehicleType: data.vehicleType || '',
    lat: Number(data.lat),
    lng: Number(data.lng),
    status: data.status || 'available',
    water: Number(data.water) || 0,
    maxWater: Number(data.maxWater) || 100,
    personnel: Number(data.personnel) || 0,
    equipment: mapToArr(data.equipment),
    chief: data.chief || '-',
    chiefUserId: data.chiefUserId || null,
    assignedFire: data.assignedFire || null,
    speed: Number(data.speed) || 60
  };
}

function parseUser(data) {
  return {
    id: data.id,
    name: data.name,
    role: data.role,
    username: data.username,
    email: data.email || '',
    password: data.password || '',
    teamId: data.teamId || null,
    active: data.active !== false
  };
}

// ---- Real-time listener: Yangınlar ----
function listenFires(callback) {
  db.ref('fires').on('value', snap => {
    const val = snap.val();
    if (!val) { callback([]); return; }
    const fires = Object.values(val)
      .filter(d => d && d.lat && d.lng)
      .map(parseFire);
    callback(fires);
  }, err => console.error('[FireCoord] fires listener error:', err));
}

// ---- Real-time listener: Ekipler ----
function listenTeams(callback) {
  db.ref('teams').on('value', snap => {
    const val = snap.val();
    if (!val) { callback([]); return; }
    const teams = Object.entries(val)
      .filter(([key, data]) => key && key !== 'undefined' && data && data.id)
      .map(([, data]) => parseTeam(data))
      .filter(t => t.lat && t.lng && !isNaN(t.lat) && !isNaN(t.lng));
    callback(teams);
  }, err => console.error('[FireCoord] teams listener error:', err));
}

// ---- Real-time listener: Bildirimler ----
function listenNotifications(callback) {
  db.ref('notifications').on('value', snap => {
    const val = snap.val();
    const notifs = val ? Object.values(val).map(n => ({
      id: n.id,
      text: n.text,
      type: n.type || 'info',
      time: n.time || '',
      read: n.read || false
    })).sort((a, b) => b.id - a.id) : [];
    callback(notifs);
  });
}

// ---- Real-time listener: Kullanıcılar ----
function listenUsers(callback) {
  db.ref('users').on('value', snap => {
    const val = snap.val();
    callback(val ? Object.values(val).map(parseUser) : []);
  });
}

// ---- Yangın yazma ----
function dbAddFire(fire) {
  return db.ref('fires/' + fire.id).set({
    id: fire.id,
    lat: fire.lat,
    lng: fire.lng,
    radius: fire.radius,
    direction: fire.direction,
    intensity: fire.intensity,
    terrain: fire.terrain,
    startTime: fire.startTime.getTime(),
    status: 'active',
    reportedBy: fire.reportedBy,
    assignedTeams: {},
    spreadRate: fire.spread_rate
  });
}

function dbExtinguishFire(fireId) {
  return db.ref('fires/' + fireId).update({ status: 'extinguished', assignedTeams: {} });
}

function dbUpdateFireRadius(fireId, radius, intensity) {
  return db.ref('fires/' + fireId).update({ radius, intensity });
}

// ---- Ekip yazma ----
function dbAssignTeam(teamId, fireId) {
  const updates = {};
  updates['teams/' + teamId + '/assignedFire'] = fireId;
  updates['teams/' + teamId + '/status'] = 'on_route';
  updates['fires/' + fireId + '/assignedTeams/' + teamId] = true;
  return db.ref().update(updates);
}

function dbUnassignTeam(teamId, fireId, waterLeft) {
  const updates = {};
  updates['teams/' + teamId + '/assignedFire'] = null;
  updates['teams/' + teamId + '/status'] = 'available';
  updates['teams/' + teamId + '/water'] = waterLeft;
  if (fireId) updates['fires/' + fireId + '/assignedTeams/' + teamId] = null;
  return db.ref().update(updates);
}

function dbUpdateTeamWater(teamId, water) {
  return db.ref('teams/' + teamId + '/water').set(water);
}

function dbUpdateTeamLocation(teamId, lat, lng, status) {
  const update = { lat, lng };
  if (status) update.status = status;
  return db.ref('teams/' + teamId).update(update);
}

function dbAssignChief(chiefId, fireId) {
  return db.ref('fires/' + fireId + '/assignedChiefs/' + chiefId).set(true);
}

function dbUpdateTeamEquipment(teamId, equipment) {
  const equip = {};
  equipment.forEach((e, i) => { equip[i] = e; });
  return db.ref('teams/' + teamId + '/equipment').set(equip);
}

function dbUpdateTeamStatus(teamId, status) {
  return db.ref('teams/' + teamId + '/status').set(status);
}

// ---- Bildirim yazma ----
function dbAddNotification(text, type) {
  const id = Date.now();
  return db.ref('notifications/' + id).set({
    id, text, type,
    time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
    read: false
  });
}

function dbMarkNotifRead(id) {
  return db.ref('notifications/' + id + '/read').set(true);
}

// ---- Kullanıcı yazma ----
function dbAddUser(user) {
  return db.ref('users/' + user.id).set(user);
}

function dbUpdateUser(userId, data) {
  return db.ref('users/' + userId).update(data);
}

function dbDeleteUser(userId) {
  return db.ref('users/' + userId).remove();
}

function dbToggleUser(userId, active) {
  return db.ref('users/' + userId + '/active').set(active);
}

// ---- Ekip yazma ----
function dbAddTeam(team) {
  return db.ref('teams/' + team.id).set(team);
}

function dbAddTeamMember(userId, teamId) {
  const updates = {};
  updates['users/' + userId + '/teamId'] = teamId;
  return db.ref().update(updates).then(() =>
    db.ref('teams/' + teamId + '/personnel').transaction(n => (n || 0) + 1)
  );
}

function dbRemoveTeamMember(userId, teamId) {
  const updates = {};
  updates['users/' + userId + '/teamId'] = null;
  return db.ref().update(updates).then(() =>
    db.ref('teams/' + teamId + '/personnel').transaction(n => Math.max(0, (n || 1) - 1))
  );
}

function dbDeleteTeam(teamId) {
  return db.ref('teams/' + teamId).remove();
}

// ---- Üye bazlı görev tamamlama ----
// Kullanıcı tamamladı → ekip 'task_complete' → tüm ekipler bittiyse yangın 'pending_report'
function dbMarkMemberComplete(fireId, teamId, userId) {
  return db.ref('fires/' + fireId + '/taskCompletions/' + teamId + '/' + userId).set(true)
    .then(() => Promise.all([
      db.ref('fires/' + fireId + '/taskCompletions/' + teamId).once('value'),
      db.ref('users').once('value')
    ]))
    .then(([compSnap, usersSnap]) => {
      const completions = compSnap.val() || {};
      const allUsers    = usersSnap.val() || {};
      const members = Object.values(allUsers).filter(u => u.teamId === teamId && u.active !== false);
      if (members.length > 0 && members.every(u => completions[u.id])) {
        // Bu ekibin tüm üyeleri tamamladı — ekip durumunu task_complete yap
        return db.ref('teams/' + teamId + '/status').set('task_complete')
          .then(() => db.ref('fires/' + fireId).once('value'))
          .then(fireSnap => {
            const fireData = fireSnap.val();
            if (!fireData || fireData.status !== 'active') return;
            const assignedTeamIds = Object.keys(fireData.assignedTeams || {}).filter(k => fireData.assignedTeams[k]);
            if (assignedTeamIds.length === 0) return;
            // Atanan tüm ekipler task_complete mi?
            return Promise.all(assignedTeamIds.map(tid =>
              db.ref('teams/' + tid + '/status').once('value')
            )).then(snaps => {
              if (snaps.every(s => s.val() === 'task_complete')) {
                return db.ref('fires/' + fireId + '/status').set('pending_report');
              }
            });
          });
      }
    });
}

// ---- Rapor gönderme — yangını söndürür, ekipleri serbest bırakır ----
function dbSubmitReport(report) {
  const updates = {};
  updates['reports/' + report.id] = report;
  updates['fires/' + report.fireId + '/status'] = 'extinguished';
  updates['fires/' + report.fireId + '/assignedTeams'] = {};
  (report.teamIds || []).forEach(tid => {
    updates['teams/' + tid + '/assignedFire'] = null;
    updates['teams/' + tid + '/status'] = 'available';
  });
  return db.ref().update(updates);
}

// ---- Real-time listener: Raporlar ----
function listenReports(callback) {
  db.ref('reports').on('value', snap => {
    const val = snap.val();
    callback(val ? Object.values(val).sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0)) : []);
  });
}

function dbMarkAllNotifsRead() {
  db.ref('notifications').once('value', snap => {
    const val = snap.val();
    if (!val) return;
    const updates = {};
    Object.keys(val).forEach(k => { updates['notifications/' + k + '/read'] = true; });
    db.ref().update(updates);
  });
}

// ---- Kullanıcılara teamId ekle (mevcut DB için bir kez çalışır) ----
function patchUserTeamIds() {
  const teamMap = { U002: 'T001', U003: 'T002', U004: 'T001', U005: 'T002' };
  db.ref('users').once('value', snap => {
    const val = snap.val();
    if (!val) return;
    const updates = {};
    Object.keys(teamMap).forEach(uid => {
      if (val[uid] && val[uid].teamId === undefined) {
        updates['users/' + uid + '/teamId'] = teamMap[uid];
      }
    });
    if (Object.keys(updates).length > 0) db.ref().update(updates);
  });
}

// ---- Ekiplere chiefUserId alanı ekle (bir kez çalışır) ----
function patchTeamChiefIds() {
  db.ref('_patches/teamChiefIds').once('value', snap => {
    if (snap.val()) return;
    Promise.all([
      db.ref('teams').once('value'),
      db.ref('users').once('value')
    ]).then(([teamsSnap, usersSnap]) => {
      const teams = teamsSnap.val() || {};
      const users = usersSnap.val() || {};
      const updates = { '_patches/teamChiefIds': true };
      Object.values(users).forEach(u => {
        if (u.role === 'sef' && u.teamId && teams[u.teamId] && !teams[u.teamId].chiefUserId) {
          updates['teams/' + u.teamId + '/chiefUserId'] = u.id;
        }
      });
      db.ref().update(updates);
    });
  });
}

// ---- Tüm kullanıcı şifrelerini '1' yap (bir kez çalışır) ----
function patchPasswordsToOne() {
  db.ref('_patches/passwordsToOne').once('value', snap => {
    if (snap.val()) return;
    db.ref('users').once('value', uSnap => {
      const val = uSnap.val();
      if (!val) return;
      const updates = { '_patches/passwordsToOne': true };
      Object.keys(val).forEach(uid => { updates['users/' + uid + '/password'] = '1'; });
      db.ref().update(updates);
    });
  });
}

// ---- Seed: Veritabanı boşsa başlangıç verisi ekle ----
function seedIfEmpty() {
  patchPasswordsToOne();
  patchTeamChiefIds();
  db.ref('fires').once('value', snap => {
    if (snap.val()) { patchUserTeamIds(); return; }

    const now = Date.now();
    db.ref('fires').set({
      F001: {
        id: 'F001', lat: 39.9334, lng: 32.8597, radius: 350,
        direction: 'NE', intensity: 'high', terrain: 'forest',
        startTime: now - 45 * 60000, status: 'active',
        reportedBy: 'Sensör-A12', assignedTeams: { T002: true }, spreadRate: 12
      },
      F002: {
        id: 'F002', lat: 39.9050, lng: 32.8820, radius: 180,
        direction: 'E', intensity: 'medium', terrain: 'urban',
        startTime: now - 15 * 60000, status: 'active',
        reportedBy: 'İhbar Hattı', assignedTeams: {}, spreadRate: 6
      }
    });

    db.ref('teams').set({
      T001: {
        id: 'T001', name: 'Ekip Alpha', vehicleId: 'V001',
        lat: 39.9208, lng: 32.8541, status: 'available',
        water: 80, maxWater: 100, personnel: 4,
        equipment: { 0: 'maske', 1: 'hortum', 2: 'söndürücü' },
        chief: 'Ahmet Yılmaz', assignedFire: null, speed: 60
      },
      T002: {
        id: 'T002', name: 'Ekip Beta', vehicleId: 'V002',
        lat: 39.9280, lng: 32.8650, status: 'on_duty',
        water: 45, maxWater: 100, personnel: 3,
        equipment: { 0: 'maske', 1: 'hortum' },
        chief: 'Mehmet Demir', assignedFire: 'F001', speed: 55
      },
      T003: {
        id: 'T003', name: 'Ekip Gamma', vehicleId: 'V003',
        lat: 39.9420, lng: 32.8380, status: 'available',
        water: 95, maxWater: 100, personnel: 5,
        equipment: { 0: 'maske', 1: 'hortum', 2: 'söndürücü' },
        chief: 'Ayşe Kaya', assignedFire: null, speed: 65
      },
      T004: {
        id: 'T004', name: 'Ekip Delta', vehicleId: 'V004',
        lat: 39.9080, lng: 32.8940, status: 'maintenance',
        water: 20, maxWater: 100, personnel: 2,
        equipment: { 0: 'maske' },
        chief: 'Ali Şahin', assignedFire: null, speed: 0
      }
    });

    db.ref('users').set({
      U001: { id: 'U001', name: 'Merkez Komutanı', role: 'merkez', username: 'admin', email: 'merkez@firecoord.tr', password: '1234', active: true, teamId: null },
      U002: { id: 'U002', name: 'Ahmet Yılmaz', role: 'sef', username: 'ahmet', email: 'ahmet@firecoord.tr', password: '1234', active: true, teamId: 'T001' },
      U003: { id: 'U003', name: 'Mehmet Demir', role: 'sef', username: 'mehmet', email: 'mehmet@firecoord.tr', password: '1234', active: true, teamId: 'T002' },
      U004: { id: 'U004', name: 'Ekip Üyesi 1', role: 'ekip', username: 'ekip1', email: 'ekip1@firecoord.tr', password: '1234', active: true, teamId: 'T001' },
      U005: { id: 'U005', name: 'Ekip Üyesi 2', role: 'ekip', username: 'ekip2', email: 'ekip2@firecoord.tr', password: '1234', active: false, teamId: 'T002' }
    });

    db.ref('notifications').set({
      1: { id: 1, text: 'F001 yangın alanı hızla büyüyor! Rüzgar NE yönünde 25 km/s.', type: 'danger', time: '14:35', read: false },
      2: { id: 2, text: 'Ekip Beta (V002) F001 yangın alanına yönlendirildi.', type: 'info', time: '14:33', read: false },
      3: { id: 3, text: 'Yeni yangın bildirimi: F002 - Kentsel bölge', type: 'warning', time: '15:10', read: false }
    });
  });
}
