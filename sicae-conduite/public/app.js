/* ============================================================
   SICAE – Conduite GRD  |  app.js
   ============================================================ */

'use strict';

const API = '/api';

/* ---- Utilitaires généraux --------------------------------- */

function nowHHMM() {
  const d = new Date();
  return d.toTimeString().slice(0, 5);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function dureeSince(heureDebut) {
  if (!heureDebut) return '–';
  const [hh, mm] = heureDebut.split(':').map(Number);
  const now = new Date();
  const start = new Date(now);
  start.setHours(hh, mm, 0, 0);
  let diff = Math.floor((now - start) / 60000);
  if (diff < 0) diff += 1440;
  const h = Math.floor(diff / 60);
  const m = diff % 60;
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`;
}

function statutClass(s) {
  const map = {
    'En cours':     'en-cours',
    'Terminée':     'terminee',
    'Suspendue':    'suspendue',
    'En transfert': 'en-transfert',
    'Archivée':     'archivee',
  };
  return 'statut-' + (map[s] || (s || '').toLowerCase());
}

function badgeClass(s) {
  const map = {
    'En cours':     'en-cours',
    'Terminée':     'terminee',
    'Suspendue':    'suspendue',
    'En transfert': 'en-transfert',
    'Archivée':     'archivee',
  };
  return 'badge badge-' + (map[s] || (s || '').toLowerCase());
}

/* ---- Supabase Realtime ------------------------------------ */

async function initRealtimeClient() {
  try {
    const res = await fetch(API + '/auth/config');
    const cfg = await res.json();
    if (!cfg.supabase_url || !cfg.supabase_anon_key) return;
    supabaseRt = window.supabase?.createClient(cfg.supabase_url, cfg.supabase_anon_key, {
      realtime: { params: { eventsPerSecond: 2 } },
    });
  } catch { /* Realtime indisponible — fallback sur visibilitychange */ }
}

async function connectRealtime() {
  if (!supabaseRt || !currentUser?.access_token) return;
  try {
    await supabaseRt.auth.setSession({
      access_token:  currentUser.access_token,
      refresh_token: currentUser.refresh_token || '',
    });
    if (realtimeChannel) {
      supabaseRt.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }
    realtimeChannel = supabaseRt
      .channel('transferts-inbox')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'transferts_conduite',
        filter: `to_email=eq.${currentUser.email}`,
      }, () => {
        loadPendingTransferts(true);
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          realtimeChannel = null; // laisse visibilitychange prendre le relais
        }
      });
  } catch {
    realtimeChannel = null;
  }
}

function disconnectRealtime() {
  if (realtimeChannel && supabaseRt) {
    supabaseRt.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}

/* ---- Toast ------------------------------------------------ */

function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// Toast persistant avec bouton "Voir" pour les notifications de transfert
function toastTransfert(msg) {
  // Supprimer un éventuel toast transfert déjà affiché
  document.querySelectorAll('.toast-transfert').forEach(el => el.remove());
  const el = document.createElement('div');
  el.className = 'toast toast-info toast-transfert';
  el.style.cssText = 'cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:12px';
  el.innerHTML = `<span>${msg}</span><strong style="white-space:nowrap">→ Voir</strong>`;
  el.addEventListener('click', () => { switchTab('dashboard'); el.remove(); });
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 8000); // 8 secondes pour laisser le temps de lire
}

/* ---- API helpers ------------------------------------------ */

async function apiFetch(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (currentUser?.access_token) {
    headers['Authorization'] = `Bearer ${currentUser.access_token}`;
  }
  const res = await fetch(API + path, { ...opts, headers });
  if (res.status === 401) {
    logout();
    throw new Error('Session expirée — veuillez vous reconnecter');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

/* ---- État global ------------------------------------------ */

let allInterventions = [];
let listes = {};
let histFilter = 'tous';
let chartBar = null;
let chartPie = null;
let rapportData = [];
let currentUser = null;        // { access_token, refresh_token, email, display_name }
let appUsers = [];             // autres utilisateurs pour le dropdown transfert
let lastTransfertCount = 0;   // pour détecter les nouveaux transferts entrants
let supabaseRt = null;        // client Supabase Realtime (anon key)
let realtimeChannel = null;   // canal Postgres Changes actif

/* ============================================================
   HORLOGE
   ============================================================ */

function updateClock() {
  const now = new Date();
  document.getElementById('clock-time').textContent =
    now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  document.getElementById('clock-date').textContent =
    now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/* ============================================================
   NAVIGATION ONGLETS
   ============================================================ */

function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + tabId).classList.add('active');
  document.querySelector(`.nav-btn[data-tab="${tabId}"]`).classList.add('active');
}

/* ============================================================
   TABLEAU DE BORD
   ============================================================ */

async function loadDashboard(notifyTransferts = false) {
  try {
    await loadPendingTransferts(notifyTransferts);
    const data = await apiFetch(`/interventions?today=1`);
    allInterventions = data;

    const enCours   = data.filter(i => i.statut === 'En cours');
    const terminees = data.filter(i => i.statut === 'Terminée');

    document.getElementById('cnt-en-cours').textContent   = enCours.length;
    document.getElementById('cnt-terminees').textContent  = terminees.length;
    document.getElementById('cnt-total').textContent      = data.length;

    // Tableau opérations en cours
    const tbody = document.getElementById('tbody-en-cours');
    if (enCours.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-msg">Aucune opération en cours</td></tr>';
    } else {
      tbody.innerHTML = enCours.map(i => `
        <tr>
          <td>${esc(i.type)}</td>
          <td>${esc(i.ouvrage)}</td>
          <td>${esc(i.commune)}</td>
          <td>${esc(i.heure_debut)}</td>
          <td class="duree-cell" data-debut="${esc(i.heure_debut)}">${dureeSince(i.heure_debut)}</td>
          <td><button class="btn btn-sm btn-orange" onclick="ouvrirCloture('${esc(i.id)}')">Clôturer</button></td>
        </tr>`).join('');
    }

    // Cards du jour
    const container = document.getElementById('cards-today');
    if (data.length === 0) {
      container.innerHTML = '<div class="empty-msg">Aucune intervention aujourd\'hui</div>';
    } else {
      container.innerHTML = data.map(cardHTML).join('');
    }
  } catch (e) {
    toast('Erreur chargement tableau de bord : ' + e.message, 'error');
  }
}

/* Rafraîchit uniquement les durées (toutes les 60 s) */
function refreshDurees() {
  document.querySelectorAll('.duree-cell[data-debut]').forEach(cell => {
    cell.textContent = dureeSince(cell.dataset.debut);
  });
}

/* ============================================================
   CARTE INTERVENTION
   ============================================================ */

function cardHTML(i) {
  const sc = statutClass(i.statut);
  const bc = badgeClass(i.statut);
  const isEnCours    = i.statut === 'En cours';
  const isArchivee   = i.statut === 'Archivée';
  const isEnTransfert = i.statut === 'En transfert';
  const agentLabel   = i.agent_email ? `<span>👤 ${esc(i.agent_email)}</span>` : '';

  const cloturBtn   = isEnCours
    ? `<button class="btn btn-sm btn-orange" onclick="ouvrirCloture('${esc(i.id)}')">Clôturer</button>` : '';
  const transfertBtn = isEnCours
    ? `<button class="btn btn-sm btn-primary" onclick="ouvrirTransfert('${esc(i.id)}','${esc(i.type)}','${esc(i.ouvrage)}')">⇄ Transférer</button>` : '';
  const archiverBtn = !isArchivee
    ? `<button class="btn btn-sm btn-ghost" onclick="archiverIntervention('${esc(i.id)}')">Archiver</button>` : '';
  const desarchiverBtn = isArchivee
    ? `<button class="btn btn-sm btn-ghost" onclick="desarchiverIntervention('${esc(i.id)}')">Désarchiver</button>` : '';

  return `
    <div class="card ${sc}">
      <div class="card-header">
        <span class="card-type">${esc(i.type)}</span>
        <span class="${bc}">${esc(i.statut)}</span>
      </div>
      <div class="card-meta">
        <span>📅 ${formatDate(i.date)}</span>
        <span>🕐 ${esc(i.heure_debut)}${i.heure_fin ? ' → ' + esc(i.heure_fin) : ''}</span>
        <span>📍 ${esc(i.commune)}</span>
        ${agentLabel}
      </div>
      <div class="card-ouvrage">🔌 ${esc(i.ouvrage)}</div>
      ${i.observations ? `<div class="card-obs">${esc(i.observations)}</div>` : ''}
      ${isEnTransfert ? '<div class="card-obs" style="color:var(--blue)">⇄ Transfert de conduite en attente…</div>' : ''}
      <div class="card-actions">
        ${cloturBtn}
        ${transfertBtn}
        ${archiverBtn}
        ${desarchiverBtn}
      </div>
    </div>`;
}

function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ============================================================
   NOUVELLE INTERVENTION
   ============================================================ */

async function initFormInterventions() {
  document.getElementById('f-date').value = todayISO();
  document.getElementById('f-heure-debut').value = nowHHMM();
  populateSelects();
}

function populateSelects() {
  fillSelect('f-type',    listes['Type intervention'] || []);
  fillSelect('f-commune', listes['Commune'] || []);
}

function fillSelect(id, values) {
  const sel = document.getElementById(id);
  const cur = sel.value;
  sel.innerHTML = '<option value="">— Sélectionner —</option>';
  values.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    if (v === cur) opt.selected = true;
    sel.appendChild(opt);
  });
}

async function soumettreIntervention(e) {
  e.preventDefault();
  const form = document.getElementById('form-intervention');

  const date        = document.getElementById('f-date').value;
  const statut      = document.getElementById('f-statut').value;
  const heure_debut = document.getElementById('f-heure-debut').value;
  const heure_fin   = document.getElementById('f-heure-fin').value || null;
  const type        = document.getElementById('f-type').value;
  const commune     = document.getElementById('f-commune').value;
  const ouvrage     = document.getElementById('f-ouvrage').value.trim();
  const observations = document.getElementById('f-observations').value.trim() || null;

  if (!date || !heure_debut || !type || !commune || !ouvrage) {
    toast('Veuillez remplir tous les champs obligatoires.', 'error');
    return;
  }

  const id = `INT-${Date.now()}`;

  try {
    await apiFetch('/interventions', {
      method: 'POST',
      body: JSON.stringify({ id, date, statut, heure_debut, heure_fin, type, commune, ouvrage, observations }),
    });
    toast('Intervention enregistrée avec succès.', 'success');
    form.reset();
    document.getElementById('f-date').value = todayISO();
    document.getElementById('f-heure-debut').value = nowHHMM();
    await loadDashboard();
    await loadHistorique();
  } catch (err) {
    toast('Erreur : ' + err.message, 'error');
  }
}

/* ============================================================
   HISTORIQUE
   ============================================================ */

async function loadHistorique() {
  try {
    const includeArchived = histFilter === 'Archivée' ? '?include_archived=1' : '';
    const data = await apiFetch('/interventions' + includeArchived);
    allInterventions = data;
    renderHistorique(data);
  } catch (e) {
    toast('Erreur chargement historique : ' + e.message, 'error');
  }
}

function renderHistorique(data) {
  const filtered = histFilter === 'tous' ? data : data.filter(i => i.statut === histFilter);
  const container = document.getElementById('cards-historique');
  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-msg">Aucune intervention trouvée</div>';
  } else {
    container.innerHTML = filtered.map(cardHTML).join('');
  }
}

/* ============================================================
   SUPPRESSION / CLÔTURE
   ============================================================ */

async function supprimerIntervention(id) {
  if (!confirm('Supprimer cette intervention ?')) return;
  try {
    await apiFetch(`/interventions/${encodeURIComponent(id)}`, { method: 'DELETE' });
    toast('Intervention supprimée.', 'success');
    await loadDashboard();
    await loadHistorique();
  } catch (e) {
    toast('Erreur suppression : ' + e.message, 'error');
  }
}

function ouvrirCloture(id) {
  document.getElementById('modal-id').value = id;
  document.getElementById('modal-heure-fin').value = nowHHMM();
  document.getElementById('modal-statut').value = 'Terminée';
  document.getElementById('modal-cloture').classList.remove('hidden');
}

function fermerCloture() {
  document.getElementById('modal-cloture').classList.add('hidden');
}

async function confirmerCloture() {
  const id       = document.getElementById('modal-id').value;
  const heure_fin = document.getElementById('modal-heure-fin').value;
  const statut   = document.getElementById('modal-statut').value;

  try {
    await apiFetch(`/interventions/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ heure_fin, statut }),
    });
    toast('Intervention clôturée.', 'success');
    fermerCloture();
    await loadDashboard();
    await loadHistorique();
  } catch (e) {
    toast('Erreur clôture : ' + e.message, 'error');
  }
}

/* ============================================================
   PARAMÈTRES – LISTES
   ============================================================ */

async function loadListes() {
  try {
    listes = await apiFetch('/listes');
    renderListes();
    populateSelects();
  } catch (e) {
    toast('Erreur chargement listes : ' + e.message, 'error');
  }
}

function renderListes() {
  const container = document.getElementById('listes-container');
  const noms = Object.keys(listes);
  if (noms.length === 0) {
    container.innerHTML = '<div class="empty-msg">Aucune liste configurée.</div>';
    return;
  }

  container.innerHTML = noms.map(nom => `
    <div class="param-card liste-bloc">
      <div class="liste-nom">
        <span>${esc(nom)}</span>
        <button class="btn btn-sm btn-red" onclick="supprimerListe('${esc(nom)}')">Supprimer la liste</button>
      </div>
      <div class="liste-valeurs" id="valeurs-${slugify(nom)}">
        ${(listes[nom] || []).map(v => `
          <div class="liste-valeur-row">
            <span>${esc(v)}</span>
            <button class="btn-suppr-valeur" title="Supprimer" onclick="supprimerValeur('${esc(nom)}', '${esc(v)}')">✕</button>
          </div>`).join('')}
      </div>
      <div class="add-valeur-row">
        <input type="text" id="add-input-${slugify(nom)}" placeholder="Nouvelle valeur…" />
        <button class="btn btn-sm btn-primary" onclick="ajouterValeur('${esc(nom)}')">Ajouter</button>
      </div>
    </div>`).join('');
}

function slugify(s) {
  return s.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
}

async function ajouterValeur(nom_liste) {
  const inp = document.getElementById('add-input-' + slugify(nom_liste));
  const valeur = inp.value.trim();
  if (!valeur) { toast('Saisissez une valeur.', 'error'); return; }
  try {
    await apiFetch('/listes', { method: 'POST', body: JSON.stringify({ nom_liste, valeur }) });
    toast(`Valeur "${valeur}" ajoutée.`, 'success');
    inp.value = '';
    await loadListes();
  } catch (e) {
    toast('Erreur : ' + e.message, 'error');
  }
}

async function supprimerValeur(nom_liste, valeur) {
  if (!confirm(`Supprimer la valeur "${valeur}" ?`)) return;
  try {
    await apiFetch('/listes', { method: 'DELETE', body: JSON.stringify({ nom_liste, valeur }) });
    toast('Valeur supprimée.', 'success');
    await loadListes();
  } catch (e) {
    toast('Erreur : ' + e.message, 'error');
  }
}

async function supprimerListe(nom_liste) {
  if (!confirm(`Supprimer toute la liste "${nom_liste}" ?`)) return;
  try {
    await apiFetch('/listes/liste', { method: 'DELETE', body: JSON.stringify({ nom_liste }) });
    toast(`Liste "${nom_liste}" supprimée.`, 'success');
    await loadListes();
  } catch (e) {
    toast('Erreur : ' + e.message, 'error');
  }
}

async function creerListe() {
  const nom_liste     = document.getElementById('new-liste-nom').value.trim();
  const premiere_valeur = document.getElementById('new-liste-valeur').value.trim();
  if (!nom_liste || !premiere_valeur) {
    toast('Renseignez le nom et la première valeur.', 'error');
    return;
  }
  try {
    await apiFetch('/listes/creer', { method: 'POST', body: JSON.stringify({ nom_liste, premiere_valeur }) });
    toast(`Liste "${nom_liste}" créée.`, 'success');
    document.getElementById('new-liste-nom').value = '';
    document.getElementById('new-liste-valeur').value = '';
    await loadListes();
  } catch (e) {
    toast('Erreur : ' + e.message, 'error');
  }
}

/* ============================================================
   PARAMÈTRES – SAUVEGARDE / RESTAURATION
   ============================================================ */

async function exporterSauvegarde() {
  try {
    const data = await apiFetch('/backup/export');
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const yyyy = today.getFullYear();
    const filename = `SICAE-sauvegarde-${dd}-${mm}-${yyyy}.json`;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast('Sauvegarde téléchargée.', 'success');
  } catch (e) {
    toast('Erreur export : ' + e.message, 'error');
  }
}

async function importerListes() {
  const file = document.getElementById('import-listes-file').files[0];
  if (!file) { toast('Sélectionnez un fichier JSON.', 'error'); return; }
  try {
    const text = await file.text();
    const json = JSON.parse(text);
    const listes = json.listes || [];
    await apiFetch('/backup/import-listes', { method: 'POST', body: JSON.stringify({ listes }) });
    toast(`${listes.length} entrées de listes importées.`, 'success');
    document.getElementById('import-listes-file').value = '';
    await loadListes();
  } catch (e) {
    toast('Erreur import listes : ' + e.message, 'error');
  }
}

async function importerInterventions() {
  const file = document.getElementById('import-interventions-file').files[0];
  if (!file) { toast('Sélectionnez un fichier JSON.', 'error'); return; }
  try {
    const text = await file.text();
    const json = JSON.parse(text);
    const interventions = json.interventions || [];
    const res = await apiFetch('/backup/import-interventions', {
      method: 'POST',
      body: JSON.stringify({ interventions }),
    });
    toast(`${res.imported} intervention(s) importée(s).`, 'success');
    document.getElementById('import-interventions-file').value = '';
    await loadDashboard();
    await loadHistorique();
  } catch (e) {
    toast('Erreur import interventions : ' + e.message, 'error');
  }
}

/* ============================================================
   AUTHENTIFICATION
   ============================================================ */

function showLoginScreen() {
  document.getElementById('login-overlay').classList.remove('hidden');
}

function hideLoginScreen() {
  document.getElementById('login-overlay').classList.add('hidden');
}

function updateHeaderUser() {
  if (!currentUser) return;
  const initials = (currentUser.display_name || currentUser.email)
    .split(/[\s@]/)[0].slice(0, 2).toUpperCase();
  document.getElementById('user-avatar').textContent      = initials;
  document.getElementById('user-display-name').textContent = currentUser.display_name || currentUser.email;
  document.getElementById('compte-email').textContent     = currentUser.email;
}

async function login() {
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('login-error');
  errEl.textContent = '';

  if (!email || !password) { errEl.textContent = 'Email et mot de passe requis.'; return; }

  try {
    const data = await fetch(API + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }).then(async r => {
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Identifiants incorrects');
      return j;
    });

    currentUser = {
      access_token:  data.access_token,
      refresh_token: data.refresh_token,
      email:         data.email,
      display_name:  data.display_name,
    };
    sessionStorage.setItem('sicae_user', JSON.stringify(currentUser));

    hideLoginScreen();
    updateHeaderUser();
    await Promise.all([loadListes(), loadDashboard(), loadHistorique(), loadAppUsers()]);
    initFormInterventions();
    await connectRealtime();
    toast(`Bienvenue, ${currentUser.display_name} !`, 'success');
  } catch (e) {
    errEl.textContent = e.message;
  }
}

function logout() {
  disconnectRealtime();
  currentUser = null;
  sessionStorage.removeItem('sicae_user');
  showLoginScreen();
  document.getElementById('login-password').value = '';
  document.getElementById('login-error').textContent = '';
}

function checkSession() {
  const stored = sessionStorage.getItem('sicae_user');
  if (stored) {
    try { currentUser = JSON.parse(stored); } catch { currentUser = null; }
  }
  return !!currentUser;
}

async function changerMotDePasse() {
  const newPwd     = document.getElementById('new-pwd').value;
  const confirmPwd = document.getElementById('new-pwd-confirm').value;
  if (!newPwd) { toast('Saisissez un nouveau mot de passe.', 'error'); return; }
  if (newPwd.length < 6) { toast('6 caractères minimum.', 'error'); return; }
  if (newPwd !== confirmPwd) { toast('Les mots de passe ne correspondent pas.', 'error'); return; }
  try {
    await apiFetch('/auth/change-password', { method: 'POST', body: JSON.stringify({ new_password: newPwd }) });
    toast('Mot de passe modifié.', 'success');
    document.getElementById('new-pwd').value = '';
    document.getElementById('new-pwd-confirm').value = '';
  } catch (e) {
    toast('Erreur : ' + e.message, 'error');
  }
}

async function loadAppUsers() {
  try {
    appUsers = await apiFetch('/auth/users');
    const sel = document.getElementById('transfert-to-email');
    sel.innerHTML = '<option value="">— Sélectionner un agent —</option>';
    if (appUsers.length === 0) {
      sel.innerHTML += '<option disabled>Aucun autre agent disponible</option>';
      return;
    }
    appUsers.forEach(u => {
      const opt = document.createElement('option');
      opt.value       = u.email;
      opt.textContent = `${u.display_name} (${u.email})`;
      sel.appendChild(opt);
    });
  } catch (e) {
    toast('Impossible de charger la liste des agents : ' + e.message, 'error');
  }
}

/* ============================================================
   ARCHIVE
   ============================================================ */

async function archiverIntervention(id) {
  if (!confirm('Archiver cette intervention ? Elle sera masquée des vues actives.')) return;
  try {
    await apiFetch(`/interventions/${encodeURIComponent(id)}`, {
      method: 'PUT', body: JSON.stringify({ statut: 'Archivée' }),
    });
    toast('Intervention archivée.', 'success');
    await loadDashboard();
    await loadHistorique();
  } catch (e) { toast('Erreur : ' + e.message, 'error'); }
}

async function desarchiverIntervention(id) {
  try {
    await apiFetch(`/interventions/${encodeURIComponent(id)}`, {
      method: 'PUT', body: JSON.stringify({ statut: 'Suspendue' }),
    });
    toast('Intervention remise en Suspendue.', 'success');
    await loadDashboard();
    await loadHistorique();
  } catch (e) { toast('Erreur : ' + e.message, 'error'); }
}

/* ============================================================
   TRANSFERT DE CONDUITE
   ============================================================ */

function ouvrirTransfert(id, type, ouvrage) {
  document.getElementById('transfert-intervention-id').value   = id;
  document.getElementById('transfert-intervention-label').textContent = `${type} — ${ouvrage}`;
  document.getElementById('transfert-to-email').value    = '';
  document.getElementById('transfert-observation').value = '';
  document.getElementById('modal-transfert').classList.remove('hidden');
}

function fermerTransfert() {
  document.getElementById('modal-transfert').classList.add('hidden');
}

async function confirmerTransfert() {
  const intervention_id = document.getElementById('transfert-intervention-id').value;
  const to_email        = document.getElementById('transfert-to-email').value;
  const observation     = document.getElementById('transfert-observation').value.trim() || null;
  if (!to_email) { toast('Sélectionnez un agent destinataire.', 'error'); return; }
  try {
    await apiFetch('/transferts', {
      method: 'POST',
      body: JSON.stringify({ intervention_id, to_email, observation }),
    });
    toast('Transfert envoyé — en attente d\'acceptation.', 'success');
    fermerTransfert();
    await loadDashboard();
    await loadHistorique();
  } catch (e) { toast('Erreur : ' + e.message, 'error'); }
}

async function loadPendingTransferts(notify = false) {
  try {
    const data = await apiFetch('/transferts?pending=1');
    const section   = document.getElementById('section-transferts-attente');
    const badge     = document.getElementById('badge-transferts');
    const container = document.getElementById('cards-transferts');

    const newCount = data.length;

    // Notification si de nouveaux transferts sont arrivés depuis la dernière vérification
    if (notify && newCount > lastTransfertCount) {
      const diff = newCount - lastTransfertCount;
      toastTransfert(`⇄ ${diff} nouveau transfert${diff > 1 ? 's' : ''} de conduite en attente`);
    }
    lastTransfertCount = newCount;

    if (newCount === 0) {
      section.classList.add('hidden');
      badge.classList.add('hidden');
      return;
    }

    badge.textContent = newCount;
    badge.classList.remove('hidden');
    section.classList.remove('hidden');

    container.innerHTML = data.map(t => {
      const int = t.intervention || {};
      return `
        <div class="transfert-card">
          <div class="transfert-info">
            <div class="transfert-title">⇄ Transfert de conduite — ${esc(int.type || '?')}</div>
            <div class="transfert-meta">
              📍 ${esc(int.ouvrage || '?')} · ${esc(int.commune || '')} ·
              De : <strong>${esc(t.from_email)}</strong>
            </div>
            ${t.observation ? `<div class="transfert-obs">"${esc(t.observation)}"</div>` : ''}
          </div>
          <div class="transfert-actions">
            <button class="btn btn-sm btn-primary" onclick="accepterTransfert(${t.id})">✓ Accepter</button>
            <button class="btn btn-sm btn-red"     onclick="refuserTransfert(${t.id})">✕ Refuser</button>
          </div>
        </div>`;
    }).join('');
  } catch { /* silencieux — on ne bloque pas si offline */ }
}

async function accepterTransfert(id) {
  try {
    await apiFetch(`/transferts/${id}/accept`, { method: 'PUT' });
    toast('Transfert accepté — intervention reprise.', 'success');
    await loadDashboard();
    await loadHistorique();
  } catch (e) { toast('Erreur : ' + e.message, 'error'); }
}

async function refuserTransfert(id) {
  if (!confirm('Refuser ce transfert ?')) return;
  try {
    await apiFetch(`/transferts/${id}/refuse`, { method: 'PUT' });
    toast('Transfert refusé.', 'success');
    await loadDashboard();
    await loadHistorique();
  } catch (e) { toast('Erreur : ' + e.message, 'error'); }
}

/* ============================================================
   RAPPORTS
   ============================================================ */

function groupBy(arr, key) {
  return arr.reduce((acc, item) => {
    const k = item[key] || 'Non renseigné';
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
    return acc;
  }, {});
}

function calculerDureeMin(i) {
  if (!i.heure_debut || !i.heure_fin) return null;
  const [h1, m1] = i.heure_debut.split(':').map(Number);
  const [h2, m2] = i.heure_fin.split(':').map(Number);
  let diff = (h2 * 60 + m2) - (h1 * 60 + m1);
  if (diff < 0) diff += 1440;
  return diff;
}

function formatDureeMin(min) {
  if (min === null || min === undefined) return '–';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`;
}

async function genererRapport() {
  const dateDebut     = document.getElementById('r-date-debut').value;
  const dateFin       = document.getElementById('r-date-fin').value;
  const groupe        = document.getElementById('r-groupe').value;
  const statutFiltre  = document.getElementById('r-statut-filtre').value;

  try {
    let data = await apiFetch('/interventions');
    if (dateDebut)    data = data.filter(i => i.date >= dateDebut);
    if (dateFin)      data = data.filter(i => i.date <= dateFin);
    if (statutFiltre) data = data.filter(i => i.statut === statutFiltre);

    rapportData = data;

    if (data.length === 0) {
      toast('Aucune intervention trouvée pour ces critères.', 'info');
      document.getElementById('rapport-resultats').classList.add('hidden');
      return;
    }

    // KPIs
    const terminees = data.filter(i => i.statut === 'Terminée');
    const durees = terminees.map(calculerDureeMin).filter(d => d !== null);
    const dureeMoy = durees.length ? Math.round(durees.reduce((a, b) => a + b, 0) / durees.length) : null;

    document.getElementById('rapport-kpis').innerHTML = `
      <div class="kpi-card"><div class="kpi-value">${data.length}</div><div class="kpi-label">Total</div></div>
      <div class="kpi-card kpi-orange"><div class="kpi-value">${data.filter(i => i.statut === 'En cours').length}</div><div class="kpi-label">En cours</div></div>
      <div class="kpi-card kpi-green"><div class="kpi-value">${terminees.length}</div><div class="kpi-label">Terminées</div></div>
      <div class="kpi-card kpi-yellow"><div class="kpi-value">${data.filter(i => i.statut === 'Suspendue').length}</div><div class="kpi-label">Suspendues</div></div>
      <div class="kpi-card kpi-blue"><div class="kpi-value">${formatDureeMin(dureeMoy)}</div><div class="kpi-label">Durée moy.</div></div>`;

    // Label groupe
    const groupeLabels = { commune: 'commune', type: "type d'intervention", ouvrage: 'ouvrage' };
    document.getElementById('chart-groupe-label').textContent = groupeLabels[groupe] || groupe;

    // Données groupées
    const grouped  = groupBy(data, groupe);
    const groupKeys = Object.keys(grouped).sort();
    const COLORS_BAR = ['#2a5298','#1a3a5c','#3a72d8','#4a82e8','#5a92f8','#6aa2ff','#7ab2ff','#8ac2ff'];

    // Chart Bar — destruction propre avant recréation
    if (chartBar) { chartBar.destroy(); chartBar = null; }
    chartBar = new Chart(document.getElementById('chart-bar'), {
      type: 'bar',
      data: {
        labels: groupKeys,
        datasets: [{
          label: 'Interventions',
          data: groupKeys.map(k => grouped[k].length),
          backgroundColor: groupKeys.map((_, i) => COLORS_BAR[i % COLORS_BAR.length]),
          borderRadius: 5,
        }],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
      },
    });

    // Chart Doughnut statuts
    if (chartPie) { chartPie.destroy(); chartPie = null; }
    const statutKeys   = ['En cours', 'Terminée', 'Suspendue'];
    const statutColors = ['#e67e22', '#27ae60', '#f39c12'];
    chartPie = new Chart(document.getElementById('chart-pie'), {
      type: 'doughnut',
      data: {
        labels: statutKeys,
        datasets: [{
          data: statutKeys.map(s => data.filter(i => i.statut === s).length),
          backgroundColor: statutColors,
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'bottom' } },
      },
    });

    // Tableau détail
    document.getElementById('rapport-detail-tbody').innerHTML = data.map(i => `
      <tr>
        <td>${formatDate(i.date)}</td>
        <td>${esc(i.type)}</td>
        <td>${esc(i.ouvrage)}</td>
        <td>${esc(i.commune)}</td>
        <td>${esc(i.heure_debut)}${i.heure_fin ? ' → ' + esc(i.heure_fin) : ''}</td>
        <td>${formatDureeMin(calculerDureeMin(i))}</td>
        <td><span class="${badgeClass(i.statut)}">${esc(i.statut)}</span></td>
        <td>${esc(i.observations || '')}</td>
      </tr>`).join('');

    document.getElementById('rapport-resultats').classList.remove('hidden');
  } catch (e) {
    toast('Erreur génération rapport : ' + e.message, 'error');
  }
}

function exportExcel() {
  if (!rapportData.length) { toast('Générez d\'abord un rapport.', 'error'); return; }
  const groupe = document.getElementById('r-groupe').value;

  const wb = XLSX.utils.book_new();

  // Feuille 1 : détail
  const ws1 = XLSX.utils.json_to_sheet(rapportData.map(i => ({
    'Date':           formatDate(i.date),
    'Type':           i.type,
    'Ouvrage':        i.ouvrage,
    'Commune':        i.commune,
    'Heure début':    i.heure_debut,
    'Heure fin':      i.heure_fin || '',
    'Durée (min)':    calculerDureeMin(i) ?? '',
    'Statut':         i.statut,
    'Observations':   i.observations || '',
  })));
  ws1['!cols'] = [{wch:12},{wch:22},{wch:30},{wch:15},{wch:12},{wch:10},{wch:12},{wch:12},{wch:40}];
  XLSX.utils.book_append_sheet(wb, ws1, 'Interventions');

  // Feuille 2 : résumé par groupe
  const grouped = groupBy(rapportData, groupe);
  const groupeLabel = { commune: 'Commune', type: "Type d'intervention", ouvrage: 'Ouvrage' }[groupe];
  const ws2 = XLSX.utils.json_to_sheet(
    Object.entries(grouped).sort().map(([key, items]) => {
      const d = items.map(calculerDureeMin).filter(x => x !== null);
      return {
        [groupeLabel]: key,
        'Total':        items.length,
        'En cours':     items.filter(i => i.statut === 'En cours').length,
        'Terminées':    items.filter(i => i.statut === 'Terminée').length,
        'Suspendues':   items.filter(i => i.statut === 'Suspendue').length,
        'Durée moy. (min)': d.length ? Math.round(d.reduce((a, b) => a + b, 0) / d.length) : '',
      };
    })
  );
  ws2['!cols'] = [{wch:25},{wch:8},{wch:10},{wch:12},{wch:12},{wch:18}];
  XLSX.utils.book_append_sheet(wb, ws2, 'Résumé');

  const d = new Date();
  XLSX.writeFile(wb, `SICAE-rapport-${String(d.getDate()).padStart(2,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${d.getFullYear()}.xlsx`);
  toast('Export Excel téléchargé.', 'success');
}

function exportPDF() {
  if (!rapportData.length) { toast('Générez d\'abord un rapport.', 'error'); return; }

  const groupe       = document.getElementById('r-groupe').value;
  const dateDebut    = document.getElementById('r-date-debut').value;
  const dateFin      = document.getElementById('r-date-fin').value;
  const statutFiltre = document.getElementById('r-statut-filtre').value;
  const groupeLabel  = { commune: 'Commune', type: "Type d'intervention", ouvrage: 'Ouvrage' }[groupe];

  const terminees = rapportData.filter(i => i.statut === 'Terminée');
  const durees    = terminees.map(calculerDureeMin).filter(d => d !== null);
  const dureeMoy  = durees.length ? Math.round(durees.reduce((a, b) => a + b, 0) / durees.length) : null;

  const grouped = groupBy(rapportData, groupe);

  const lignesResume = Object.entries(grouped).sort().map(([key, items]) => `
    <tr>
      <td>${esc(key)}</td>
      <td><b>${items.length}</b></td>
      <td>${items.filter(i => i.statut === 'En cours').length}</td>
      <td>${items.filter(i => i.statut === 'Terminée').length}</td>
      <td>${items.filter(i => i.statut === 'Suspendue').length}</td>
    </tr>`).join('');

  const lignesDetail = rapportData.map(i => {
    const sc = i.statut === 'En cours' ? '#e67e22' : i.statut === 'Terminée' ? '#27ae60' : '#f39c12';
    return `<tr>
      <td>${formatDate(i.date)}</td>
      <td>${esc(i.type)}</td>
      <td>${esc(i.ouvrage)}</td>
      <td>${esc(i.commune)}</td>
      <td>${esc(i.heure_debut)}${i.heure_fin ? ' → ' + esc(i.heure_fin) : ''}</td>
      <td>${formatDureeMin(calculerDureeMin(i))}</td>
      <td><span style="background:${sc}22;color:${sc};padding:2px 8px;border-radius:50px;font-size:8pt;font-weight:700">${esc(i.statut)}</span></td>
      <td style="font-size:8pt;color:#6c757d">${esc(i.observations || '')}</td>
    </tr>`;
  }).join('');

  const now = new Date();
  const dateGen = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"/>
<title>Rapport SICAE – ${now.toLocaleDateString('fr-FR')}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Arial,sans-serif;font-size:11pt;color:#212529;background:#fff}
.page{max-width:210mm;margin:0 auto;padding:12mm 15mm}
.no-print{margin-bottom:12px}
.print-btn{padding:9px 22px;background:#2a5298;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:10pt;font-weight:700;margin-right:8px}
.print-btn:hover{background:#1a3a5c}

.header{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #1a3a5c;padding-bottom:10px;margin-bottom:16px}
.brand{display:flex;align-items:center;gap:10px}
.logo{font-size:26pt}
h1{color:#1a3a5c;font-size:16pt}
h2.sub{color:#2a5298;font-size:11pt;font-weight:normal}
.header-right{text-align:right;font-size:9pt;color:#6c757d;line-height:1.6}

.kpis{display:flex;gap:10px;margin-bottom:16px}
.kpi{flex:1;border-radius:8px;padding:10px;text-align:center;border-top:4px solid #1a3a5c}
.kpi-v{font-size:18pt;font-weight:800;color:#1a3a5c}
.kpi-l{font-size:7.5pt;color:#6c757d;text-transform:uppercase;letter-spacing:.4px}
.k-or{border-top-color:#e67e22}.k-or .kpi-v{color:#e67e22}
.k-gr{border-top-color:#27ae60}.k-gr .kpi-v{color:#27ae60}
.k-ye{border-top-color:#f39c12}.k-ye .kpi-v{color:#f39c12}
.k-bl{border-top-color:#2a5298}.k-bl .kpi-v{color:#2a5298}

.sec{font-size:11pt;font-weight:700;color:#1a3a5c;margin:16px 0 7px;padding-bottom:4px;border-bottom:2px solid #dee2e6}
table{width:100%;border-collapse:collapse;font-size:9pt;margin-bottom:14px}
th{background:#1a3a5c;color:#fff;padding:7px 8px;text-align:left;font-size:8pt}
td{padding:5px 8px;border-bottom:1px solid #dee2e6;vertical-align:top}
tr:nth-child(even) td{background:#f8f9fa}
.footer{margin-top:16px;padding-top:8px;border-top:1px solid #dee2e6;font-size:8pt;color:#6c757d;text-align:center}
@media print{.no-print{display:none}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><div class="page">

<div class="no-print">
  <button class="print-btn" onclick="window.print()">🖨️ Imprimer / Enregistrer en PDF</button>
</div>

<div class="header">
  <div class="brand"><span class="logo">⚡</span><div><h1>SICAE – Conduite GRD</h1><h2 class="sub">Rapport d'activité</h2></div></div>
  <div class="header-right">
    <div>Généré le ${dateGen}</div>
    <div>Période : ${dateDebut ? formatDate(dateDebut) : '–'} → ${dateFin ? formatDate(dateFin) : '–'}</div>
    ${statutFiltre ? `<div>Statut filtré : ${statutFiltre}</div>` : ''}
    <div>Regroupé par : ${groupeLabel}</div>
  </div>
</div>

<div class="kpis">
  <div class="kpi"><div class="kpi-v">${rapportData.length}</div><div class="kpi-l">Total</div></div>
  <div class="kpi k-or"><div class="kpi-v">${rapportData.filter(i=>i.statut==='En cours').length}</div><div class="kpi-l">En cours</div></div>
  <div class="kpi k-gr"><div class="kpi-v">${terminees.length}</div><div class="kpi-l">Terminées</div></div>
  <div class="kpi k-ye"><div class="kpi-v">${rapportData.filter(i=>i.statut==='Suspendue').length}</div><div class="kpi-l">Suspendues</div></div>
  <div class="kpi k-bl"><div class="kpi-v">${formatDureeMin(dureeMoy)}</div><div class="kpi-l">Durée moy.</div></div>
</div>

<div class="sec">Résumé par ${groupeLabel}</div>
<table>
  <thead><tr><th>${groupeLabel}</th><th>Total</th><th>En cours</th><th>Terminées</th><th>Suspendues</th></tr></thead>
  <tbody>${lignesResume}</tbody>
</table>

<div class="sec">Détail des interventions (${rapportData.length})</div>
<table>
  <thead><tr><th>Date</th><th>Type</th><th>Ouvrage</th><th>Commune</th><th>Horaires</th><th>Durée</th><th>Statut</th><th>Observations</th></tr></thead>
  <tbody>${lignesDetail}</tbody>
</table>

<div class="footer">SICAE – Conduite GRD &nbsp;·&nbsp; Rapport généré le ${now.toLocaleString('fr-FR')} &nbsp;·&nbsp; ${rapportData.length} intervention(s)</div>
</div></body></html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  window.open(url, '_blank');
  toast('Page PDF ouverte — utilise "Imprimer → Enregistrer en PDF".', 'success');
}

/* ============================================================
   INITIALISATION
   ============================================================ */

async function init() {
  // Horloge
  updateClock();
  setInterval(updateClock, 1000);
  setInterval(refreshDurees, 60000);

  // Login / logout
  document.getElementById('btn-login').addEventListener('click', login);
  document.getElementById('login-password').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
  document.getElementById('btn-logout').addEventListener('click', logout);

  // Navigation — le clic sur "Tableau de bord" rafraîchit les données
  // Notifie les transferts seulement si Realtime n'est pas connecté (fallback)
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab);
      if (btn.dataset.tab === 'dashboard' && currentUser) {
        loadDashboard(!realtimeChannel);
      }
    });
  });

  // Vérification des transferts au retour sur l'onglet navigateur
  // Fallback uniquement si Realtime WebSocket n'est pas connecté
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && currentUser && !realtimeChannel) {
      loadPendingTransferts(true);
    }
  });

  // Filtres historique — recharge depuis API si filtre Archivée change
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      histFilter = btn.dataset.filter;
      await loadHistorique();
    });
  });

  // Form nouvelle intervention
  document.getElementById('form-intervention').addEventListener('submit', soumettreIntervention);

  // Modale clôture
  document.getElementById('btn-confirmer-cloture').addEventListener('click', confirmerCloture);
  document.getElementById('btn-annuler-cloture').addEventListener('click', fermerCloture);
  document.getElementById('modal-cloture').addEventListener('click', function(e) { if (e.target === this) fermerCloture(); });

  // Modale transfert
  document.getElementById('btn-confirmer-transfert').addEventListener('click', confirmerTransfert);
  document.getElementById('btn-annuler-transfert').addEventListener('click', fermerTransfert);
  document.getElementById('modal-transfert').addEventListener('click', function(e) { if (e.target === this) fermerTransfert(); });

  // Paramètres — compte
  document.getElementById('btn-change-pwd').addEventListener('click', changerMotDePasse);

  // Paramètres — listes
  document.getElementById('btn-creer-liste').addEventListener('click', creerListe);
  document.getElementById('btn-export').addEventListener('click', exporterSauvegarde);
  document.getElementById('btn-import-listes').addEventListener('click', importerListes);
  document.getElementById('btn-import-interventions').addEventListener('click', importerInterventions);

  // Rapports
  document.getElementById('btn-generer-rapport').addEventListener('click', genererRapport);
  document.getElementById('btn-export-excel').addEventListener('click', exportExcel);
  document.getElementById('btn-export-pdf').addEventListener('click', exportPDF);

  // Initialiser le client Realtime (récupère anon key via /auth/config)
  await initRealtimeClient();

  // Vérifier session existante
  if (checkSession()) {
    hideLoginScreen();
    updateHeaderUser();
    await Promise.all([loadListes(), loadDashboard(), loadHistorique(), loadAppUsers()]);
    initFormInterventions();
    await connectRealtime();
  } else {
    showLoginScreen();
  }
}

document.addEventListener('DOMContentLoaded', init);

/* Exposer les fonctions appelées en onclick inline */
window.ouvrirCloture          = ouvrirCloture;
window.supprimerIntervention  = supprimerIntervention;
window.ajouterValeur          = ajouterValeur;
window.supprimerValeur        = supprimerValeur;
window.supprimerListe         = supprimerListe;
window.ouvrirTransfert        = ouvrirTransfert;
window.accepterTransfert      = accepterTransfert;
window.refuserTransfert       = refuserTransfert;
window.archiverIntervention   = archiverIntervention;
window.desarchiverIntervention = desarchiverIntervention;
