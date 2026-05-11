// ============================================================
//  FireCoord — Role-Based Access Controller
//  Tüm rol/yetki kontrollerinin tek merkezi noktası.
//  Kullanım: RoleBasedController.can('fires.dispatch')
//            RoleBasedController.can('teams.update', { teamId: 'T001' })
// ============================================================

const RoleBasedController = {

  // ----------------------------------------------------------
  //  İzin Haritası
  //  Her rol için hangi kaynakta hangi işleme izin var?
  // ----------------------------------------------------------
  PERMISSIONS: {

    merkez: {
      fires:      { view: true,  add: true,  dispatch: true,  extinguish: true  },
      teams:      { viewAll: true,  updateAny: true,  completeAny: true         },
      route:      { view: true,  dispatch: true                                  },
      simulation: { run: true                                                    },
      management: { view: true                                                   },
      task:       { view: false                                                  }
    },

    sef: {
      fires:      { view: true,  add: false, dispatch: false, extinguish: false  },
      teams:      { viewAll: true,  updateOwn: true,  completeOwn: true         },
      route:      { view: true,  dispatch: false                                 },
      simulation: { run: false                                                   },
      management: { view: false                                                  },
      task:       { view: false                                                  }
    },

    ekip: {
      fires:      { view: false                                                  },
      teams:      { viewAll: false, updateOwn: true                             },
      route:      { view: false                                                  },
      simulation: { run: false                                                   },
      management: { view: false                                                  },
      task:       { view: true                                                   }
    }
  },

  // ----------------------------------------------------------
  //  can(action, context?)
  //  action : 'fires.dispatch' | 'teams.update' | 'route.view' …
  //  context: { teamId } — kendi ekibi mi kontrolü için
  // ----------------------------------------------------------
  can(action, context = {}) {
    const role = AppState.currentUser?.role;
    if (!role) return false;

    const perms = this.PERMISSIONS[role];
    if (!perms) return false;

    const dot = action.indexOf('.');
    const resource = action.slice(0, dot);
    const perm     = action.slice(dot + 1);
    const rp = perms[resource];
    if (!rp) return false;

    // "update" ve "complete" izinleri kendi ekibi bağlamında değerlendirilen özel durumlar
    if (perm === 'update') {
      if (rp.updateAny) return true;
      if (rp.updateOwn) return context.teamId === AppState.currentUser?.teamId;
      return false;
    }
    if (perm === 'complete') {
      if (rp.completeAny) return true;
      if (rp.completeOwn) return context.teamId === AppState.currentUser?.teamId;
      return false;
    }

    return rp[perm] === true;
  },

  // ----------------------------------------------------------
  //  applyUI()
  //  Giriş yapan kullanıcının rolüne göre DOM'dan yetkisiz
  //  öğeleri gizler / görünür kılar.
  // ----------------------------------------------------------
  applyUI() {
    const role = AppState.currentUser?.role;
    if (!role || role === 'merkez') return;

    if (role === 'sef') {
      // Yönetim paneli ve yangın ekleme / simülasyon gizle
      this._hide(['nav-mgmt', 'nav-section-mgmt', 'mapCtrlButtons', 'newFireBtnWrapper']);
    }

    if (role === 'ekip') {
      // Sadece "Görevim" sekmesi görünür
      this._hide([
        'nav-fires', 'nav-teams', 'nav-route',
        'nav-mgmt',  'nav-section-mgmt',
        'mapCtrlButtons', 'newFireBtnWrapper'
      ]);
      this._show('nav-task', 'flex');
      navTo('task');
    }
  },

  // ----------------------------------------------------------
  //  Yardımcılar
  // ----------------------------------------------------------
  _hide(ids) {
    (Array.isArray(ids) ? ids : [ids]).forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  },

  _show(id, display = 'block') {
    const el = document.getElementById(id);
    if (el) el.style.display = display;
  }
};
