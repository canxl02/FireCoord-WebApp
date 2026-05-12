// ============================================================
//  FireCoord — Offline Cache Manager
//  Çevrimdışı işlem kuyruğu ve yerel durum önbelleği
// ============================================================

const OfflineCacheManager = {
  _queue: [],
  _syncing: false,

  init() {
    try {
      const stored = localStorage.getItem('fc_offline_queue');
      if (stored) this._queue = JSON.parse(stored);
    } catch (_) { this._queue = []; }

    window.addEventListener('online',  () => { this._updateUI(true);  this._onOnline();  });
    window.addEventListener('offline', () => { this._updateUI(false); this._onOffline(); });

    this._updateUI(navigator.onLine);

    if (this._queue.length > 0) {
      setTimeout(() => addLog(`Çevrimdışı kuyrukta ${this._queue.length} bekleyen işlem var.`, 'warn'), 800);
    }
  },

  isOnline() { return navigator.onLine; },

  // Çevrimiçi ise fn() çalıştır; değilse işlemi kuyruğa al
  wrapWrite(opName, data, fn) {
    if (this.isOnline()) return fn();
    this.storeOfflineData(opName, data);
    return Promise.resolve({ queued: true });
  },

  // Manuel olarak kuyruğa ekle
  storeOfflineData(opName, data) {
    const entry = {
      id: Date.now() + '_' + Math.random().toString(36).slice(2),
      op: opName,
      data,
      ts: Date.now()
    };
    this._queue.push(entry);
    this._persist();
    this._updateSyncBadge();
    addLog(`[Çevrimdışı] "${opName}" kuyruğa alındı (toplam: ${this._queue.length})`, 'warn');
    return entry;
  },

  // AppState anlık görüntüsünü localStorage'a yaz (sayfa yenilendiğinde okunur)
  cacheState() {
    try {
      localStorage.setItem('fc_state_cache', JSON.stringify({
        fires: AppState.fires.map(f => ({
          ...f,
          startTime: f.startTime instanceof Date ? f.startTime.getTime() : f.startTime
        })),
        teams: AppState.teams,
        ts: Date.now()
      }));
    } catch (_) {}
  },

  // Çevrimdışı sayfa yüklemesi için önbellekten oku
  loadCachedState() {
    try {
      const raw = localStorage.getItem('fc_state_cache');
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  },

  async _onOnline() {
    if (this._queue.length === 0 || this._syncing) return;
    this._syncing = true;
    addLog(`Çevrimiçi: ${this._queue.length} işlem Firebase'e senkronize ediliyor...`, 'success');
    await this._syncQueue();
    this._syncing = false;
  },

  _onOffline() {
    addLog('Çevrimdışı moda geçildi. Yazma işlemleri yerel kuyruğa alınacak.', 'warn');
  },

  async _syncQueue() {
    const batch = [...this._queue];
    this._queue = [];
    this._persist();

    const failed = [];
    for (const entry of batch) {
      try {
        await this._execute(entry);
        addLog(`Senkronize edildi: ${entry.op}`, 'success');
      } catch (e) {
        console.error('[OfflineSync] Başarısız:', entry.op, e);
        failed.push(entry);
        addLog(`Senkronizasyon hatası: ${entry.op}`, 'danger');
      }
    }

    if (failed.length > 0) {
      this._queue = failed;
      this._persist();
    }
    this._updateSyncBadge();

    if (failed.length === 0 && batch.length > 0) {
      dbAddNotification(`${batch.length} çevrimdışı işlem başarıyla senkronize edildi.`, 'success');
    }
  },

  _execute(entry) {
    const d = entry.data;
    switch (entry.op) {
      case 'addFire':          return dbAddFire(d);
      case 'extinguishFire':   return dbExtinguishFire(d.fireId);
      case 'assignTeam':       return dbAssignTeam(d.teamId, d.fireId);
      case 'unassignTeam':     return dbUnassignTeam(d.teamId, d.fireId, d.water);
      case 'updateWater':      return dbUpdateTeamWater(d.teamId, d.water);
      case 'submitReport':     return dbSubmitReport(d);
      case 'addNotif':         return dbAddNotification(d.text, d.type);
      case 'markComplete':     return dbMarkMemberComplete(d.fireId, d.teamId, d.userId);
      case 'updateTeamStatus': return dbUpdateTeamStatus(d.teamId, d.status);
      default:
        console.warn('[OfflineSync] Bilinmeyen işlem:', entry.op);
        return Promise.resolve();
    }
  },

  _persist() {
    try { localStorage.setItem('fc_offline_queue', JSON.stringify(this._queue)); } catch (_) {}
  },

  _updateUI(online) {
    const bar = document.getElementById('offlineBar');
    if (bar) bar.style.display = online ? 'none' : 'flex';

    const dot = document.getElementById('connectivityDot');
    if (dot) dot.className = online ? 'sys-dot' : 'sys-dot red';

    const label = document.getElementById('connectivityLabel');
    if (label) label.textContent = online ? 'Çevrimiçi' : 'Çevrimdışı';

    this._updateSyncBadge();
  },

  _updateSyncBadge() {
    const badge = document.getElementById('syncQueueBadge');
    if (!badge) return;
    if (this._queue.length > 0) {
      badge.textContent = this._queue.length;
      badge.style.display = 'inline-flex';
    } else {
      badge.style.display = 'none';
    }
  }
};
