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
let listesParents = {};  // { childListName: 'parentList::parentValue' }
let currentListeCat = 'interventions';
const LISTE_CATS = [
  { id: 'interventions', label: 'Interventions', icon: '⚡', roots: ['Type intervention'] },
  { id: 'entreprises',   label: 'Entreprises',   icon: '🏭', roots: ['Entreprises'] },
  { id: 'sites',         label: 'Sites',          icon: '📍', roots: ['Site'] },
  { id: 'autres',        label: 'Autres',         icon: '📋', roots: null },
];
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
  document.querySelectorAll('.nav-btn, .nav-drop-item').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('drop-open'));

  document.getElementById('tab-' + tabId)?.classList.add('active');

  const directBtn = document.querySelector(`.nav-btn[data-tab="${tabId}"]`);
  if (directBtn) {
    directBtn.classList.add('active');
  } else {
    const subBtn = document.querySelector(`.nav-drop-item[data-tab="${tabId}"]`);
    if (subBtn) {
      subBtn.classList.add('active');
      subBtn.closest('.nav-item')?.querySelector('.nav-btn')?.classList.add('active');
    }
  }

  if (tabId === 'journal') loadJournal();
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
          <td>${i.sous_type ? `${esc(i.type)} › ${esc(i.sous_type)}` : esc(i.type)}</td>
          <td>${esc(i.ouvrage)}</td>
          <td>${esc(i.site || '')}</td>
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

  const editerBtn   = !isArchivee
    ? `<button class="btn btn-sm btn-secondary" onclick="ouvrirEditionIntervention('${esc(i.id)}')">✏️ Modifier</button>` : '';
  const cloturBtn   = isEnCours
    ? `<button class="btn btn-sm btn-orange" onclick="ouvrirCloture('${esc(i.id)}')">Clôturer</button>` : '';
  const transfertBtn = isEnCours
    ? `<button class="btn btn-sm btn-primary" onclick="ouvrirTransfert('${esc(i.id)}','${esc(i.type)}','${esc(i.ouvrage)}')">⇄ Transférer</button>` : '';
  const archiverBtn = !isArchivee
    ? `<button class="btn btn-sm btn-ghost" onclick="archiverIntervention('${esc(i.id)}')">Archiver</button>` : '';
  const desarchiverBtn = isArchivee
    ? `<button class="btn btn-sm btn-ghost" onclick="desarchiverIntervention('${esc(i.id)}')">Désarchiver</button>` : '';

  const typeLabel = i.sous_type ? `${esc(i.type)} › ${esc(i.sous_type)}` : esc(i.type);

  return `
    <div class="card ${sc}">
      <div class="card-header">
        <span class="card-type">${typeLabel}</span>
        <span class="${bc}">${esc(i.statut)}</span>
      </div>
      <div class="card-meta">
        <span>📅 ${formatDate(i.date)}</span>
        <span>🕐 ${esc(i.heure_debut)}${i.heure_fin ? ' → ' + esc(i.heure_fin) : ''}</span>
        ${i.site ? `<span>📍 ${esc(i.site)}</span>` : ''}
        ${agentLabel}
      </div>
      ${i.ouvrage ? `<div class="card-ouvrage">🔌 ${esc(i.ouvrage)}</div>` : ''}
      ${i.observations ? `<div class="card-obs">${esc(i.observations)}</div>` : ''}
      ${i.intervenants && i.intervenants.length > 0 ? `<div class="card-intervenants">${i.intervenants.map(iv => `<span class="intervenant-chip-sm">${esc(iv.entreprise)} — ${esc(iv.agent)}</span>`).join('')}</div>` : ''}
      ${isEnTransfert ? '<div class="card-obs" style="color:var(--blue)">⇄ Transfert de conduite en attente…</div>' : ''}
      <div class="card-actions">
        ${editerBtn}
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
  fillSelect('f-type', listes['Type intervention'] || []);
  fillSelect('f-site', listes['Site'] || []);
  fillSelect('f-entreprise', listes['Entreprises'] || []);
}

/* ---------- Intervenants en cascade ---------- */

let selectedIntervenants = [];  // [{entreprise, agent}, ...]

function onEntrepriseChange() {
  const entreprise = document.getElementById('f-entreprise').value;
  const box = document.getElementById('agents-checkboxes');
  if (!entreprise || !box) return;
  if (!entreprise) { box.innerHTML = ''; return; }

  const childListName = findChildList('Entreprises', entreprise)
                     || `Agents ${entreprise}`;  // fallback ancienne convention
  const agents = listes[childListName] || [];

  if (agents.length === 0) {
    box.innerHTML = '<span class="agents-empty">Aucun personnel configuré pour cette entreprise</span>';
    return;
  }
  box.innerHTML = agents.map(a => {
    const selected = selectedIntervenants.some(i => i.entreprise === entreprise && i.agent === a);
    return `<button type="button" class="agent-pill${selected ? ' selected' : ''}"
      onclick="toggleAgentPill(this,'${esc(entreprise)}','${esc(a)}')">${esc(a)}</button>`;
  }).join('');
}

function toggleAgentPill(btn, entreprise, agent) {
  const isSelected = btn.classList.toggle('selected');
  majIntervenants(entreprise, agent, isSelected);
}

function majIntervenants(entreprise, agent, checked) {
  if (checked) {
    if (!selectedIntervenants.find(i => i.entreprise === entreprise && i.agent === agent)) {
      selectedIntervenants.push({ entreprise, agent });
    }
  } else {
    selectedIntervenants = selectedIntervenants.filter(i => !(i.entreprise === entreprise && i.agent === agent));
  }
  renderIntervenantsChips();
}

function renderIntervenantsChips() {
  const el = document.getElementById('intervenants-selected');
  if (!el) return;
  el.innerHTML = selectedIntervenants.map((i, idx) => `
    <span class="intervenant-chip">
      <strong>${esc(i.entreprise)}</strong> — ${esc(i.agent)}
      <button onclick="retirerIntervenant(${idx})" title="Retirer">✕</button>
    </span>`).join('');
}

function retirerIntervenant(idx) {
  selectedIntervenants.splice(idx, 1);
  renderIntervenantsChips();
  onEntrepriseChange(); // resynchronise les cases de l'entreprise affichée
}


function fillSelect(id, values, selectedValue) {
  const sel = document.getElementById(id);
  if (!sel) return;
  const cur = selectedValue !== undefined ? selectedValue : sel.value;
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
  const { type, sous_type } = getCascadeValues();
  const site        = document.getElementById('f-site').value || null;
  const observations = document.getElementById('f-observations').value.trim() || null;

  if (!date || !heure_debut || !type) {
    toast('Veuillez remplir tous les champs obligatoires.', 'error');
    return;
  }

  const id = `INT-${Date.now()}`;

  try {
    await apiFetch('/interventions', {
      method: 'POST',
      body: JSON.stringify({ id, date, statut, heure_debut, heure_fin, type, sous_type, site, observations, intervenants: selectedIntervenants }),
    });
    toast('Intervention enregistrée avec succès.', 'success');
    form.reset();
    document.getElementById('f-date').value = todayISO();
    document.getElementById('f-heure-debut').value = nowHHMM();
    document.getElementById('cascade-container').innerHTML = '';
    selectedIntervenants = [];
    if (document.getElementById('intervenants-selected')) document.getElementById('intervenants-selected').innerHTML = '';
    if (document.getElementById('agents-checkboxes'))    document.getElementById('agents-checkboxes').innerHTML = '';
    if (document.getElementById('f-entreprise'))         document.getElementById('f-entreprise').value = '';
    populateSelects();
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
   JOURNAL DES INTERVENTIONS
   ============================================================ */

let journalData = [];

async function loadJournal() {
  try {
    const data = await apiFetch('/interventions?include_archived=1');
    journalData = data;
    filterJournal();
  } catch (e) {
    toast('Erreur chargement journal : ' + e.message, 'error');
  }
}

function filterJournal() {
  const search = (document.getElementById('journal-search')?.value || '').toLowerCase();
  const statut = document.getElementById('journal-statut-filter')?.value || '';
  const dateD  = document.getElementById('journal-date-debut')?.value || '';
  const dateF  = document.getElementById('journal-date-fin')?.value || '';

  let data = journalData;
  if (search) data = data.filter(i =>
    (i.type || '').toLowerCase().includes(search) ||
    (i.ouvrage || '').toLowerCase().includes(search) ||
    (i.site || '').toLowerCase().includes(search) ||
    (i.observations || '').toLowerCase().includes(search)
  );
  if (statut) data = data.filter(i => i.statut === statut);
  if (dateD)  data = data.filter(i => i.date >= dateD);
  if (dateF)  data = data.filter(i => i.date <= dateF);

  renderJournal(data);
  const cnt = document.getElementById('journal-count');
  if (cnt) cnt.textContent = data.length < journalData.length
    ? `${data.length} résultat(s) sur ${journalData.length} intervention(s)`
    : `${data.length} intervention(s) au total`;
}

function renderJournal(data) {
  const tbody = document.getElementById('journal-tbody');
  if (!tbody) return;
  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-msg">Aucune intervention trouvée</td></tr>';
    return;
  }
  tbody.innerHTML = data.map(i => {
    const bc = badgeClass(i.statut);
    const intervenantsText = (i.intervenants && i.intervenants.length > 0)
      ? i.intervenants.map(iv => `${iv.entreprise} – ${iv.agent}`).join(', ')
      : '';
    const agentNom = i.agent_email ? i.agent_email.split('@')[0] : '–';
    return `<tr>
      <td style="white-space:nowrap">${formatDate(i.date)}</td>
      <td>${esc(i.type)}</td>
      <td><strong>${esc(i.ouvrage)}</strong></td>
      <td>${esc(i.site || '–')}</td>
      <td style="white-space:nowrap">${esc(i.heure_debut)}${i.heure_fin ? ' → ' + esc(i.heure_fin) : ''}</td>
      <td><span class="${bc}">${esc(i.statut)}</span></td>
      <td style="font-size:.82rem">${esc(agentNom)}</td>
      <td style="font-size:.75rem;color:var(--gray-500);max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(intervenantsText)}">${esc(intervenantsText) || '–'}</td>
      <td>
        <div class="journal-actions">
          <button class="btn btn-sm btn-primary" title="Modifier" onclick="ouvrirEditionIntervention('${esc(i.id)}')">✏️ Éditer</button>
          <button class="btn btn-sm btn-red" title="Supprimer" onclick="supprimerDepuisJournal('${esc(i.id)}')">🗑️</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

/* ---------- Modale édition ---------- */

function ouvrirEditionIntervention(id) {
  const i = journalData.find(x => x.id === id) || allInterventions.find(x => x.id === id);
  if (!i) { toast('Intervention introuvable.', 'error'); return; }
  document.getElementById('edition-id').value           = id;
  document.getElementById('edition-date').value         = i.date || '';
  document.getElementById('edition-statut').value       = i.statut || 'En cours';
  document.getElementById('edition-heure-debut').value  = i.heure_debut || '';
  document.getElementById('edition-heure-fin').value    = i.heure_fin || '';
  document.getElementById('edition-observations').value = i.observations || '';
  fillSelect('edition-type', listes['Type intervention'] || [], i.type);
  fillSelect('edition-site', listes['Site'] || [], i.site);
  // Sous-type cascade
  const childListEdition = findChildList('Type intervention', i.type);
  const grpEdition = document.getElementById('edition-sous-type-group');
  if (childListEdition && listes[childListEdition]) {
    fillSelect('edition-sous-type', listes[childListEdition], i.sous_type);
    if (grpEdition) grpEdition.style.display = '';
  } else {
    if (grpEdition) grpEdition.style.display = 'none';
  }
  document.getElementById('modal-edition').classList.remove('hidden');
}

function fermerEdition() {
  document.getElementById('modal-edition').classList.add('hidden');
}

async function sauvegarderEdition() {
  const id = document.getElementById('edition-id').value;
  const updates = {
    date:         document.getElementById('edition-date').value,
    statut:       document.getElementById('edition-statut').value,
    heure_debut:  document.getElementById('edition-heure-debut').value,
    heure_fin:    document.getElementById('edition-heure-fin').value || null,
    type:         document.getElementById('edition-type').value,
    sous_type:    document.getElementById('edition-sous-type')?.value || null,
    site:         document.getElementById('edition-site').value || null,
    observations: document.getElementById('edition-observations').value.trim() || null,
  };
  if (!updates.date || !updates.heure_debut || !updates.type) {
    toast('Champs obligatoires manquants (date, heure début, type).', 'error');
    return;
  }
  try {
    await apiFetch(`/interventions/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
    toast('Intervention modifiée avec succès.', 'success');
    fermerEdition();
    await Promise.all([loadJournal(), loadDashboard(), loadHistorique()]);
  } catch (e) {
    toast('Erreur : ' + e.message, 'error');
  }
}

async function supprimerDepuisJournal(id) {
  const i = journalData.find(x => x.id === id) || allInterventions.find(x => x.id === id);
  const label = i ? `${i.type} – ${i.ouvrage} (${formatDate(i.date)})` : id;
  if (!confirm(`Supprimer définitivement :\n« ${label } »\n\nCette action est irréversible.`)) return;
  try {
    await apiFetch(`/interventions/${encodeURIComponent(id)}`, { method: 'DELETE' });
    toast('Intervention supprimée.', 'success');
    await Promise.all([loadJournal(), loadDashboard(), loadHistorique()]);
  } catch (e) {
    toast('Erreur : ' + e.message, 'error');
  }
}

/* ---------- Historique des modifications (admin) ---------- */

async function loadJournalModifications() {
  const tbody = document.getElementById('audit-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" class="empty-msg">Chargement…</td></tr>';
  try {
    const data = await apiFetch('/journal');
    renderJournalModifications(data);
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-msg">Erreur : ${esc(e.message)}</td></tr>`;
  }
}

function renderJournalModifications(data) {
  const tbody = document.getElementById('audit-tbody');
  if (!tbody) return;
  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-msg">Aucune modification enregistrée.</td></tr>';
    return;
  }
  tbody.innerHTML = data.map(m => {
    const actionClass = m.action === 'Création' ? 'badge badge-en-cours'
      : m.action === 'Suppression' ? 'badge badge-archivee'
      : 'badge badge-suspendue';
    let details = '–';
    if (m.details) {
      const d = typeof m.details === 'string' ? JSON.parse(m.details) : m.details;
      const champs = Object.entries(d)
        .filter(([k]) => !['id', 'created_at', 'agent_email'].includes(k))
        .map(([k, v]) => `${k}: ${v === null ? '–' : v}`)
        .join(' | ');
      details = champs || '–';
    }
    const agentNom = m.fait_par_email ? m.fait_par_email.split('@')[0] : '–';
    return `<tr>
      <td style="white-space:nowrap;font-size:.82rem">${formatDateHMS(m.fait_a)}</td>
      <td><span class="${actionClass}">${esc(m.action)}</span></td>
      <td style="font-family:monospace;font-size:.78rem">${esc(m.intervention_id)}</td>
      <td style="font-size:.82rem">${esc(agentNom)}</td>
      <td class="audit-details" title="${esc(details)}">${esc(details)}</td>
    </tr>`;
  }).join('');
}

/* ============================================================
   PARAMÈTRES – LISTES
   ============================================================ */

async function loadListes() {
  try {
    const data = await apiFetch('/listes');
    listesParents = data.__parents__ || {};
    delete data.__parents__;
    listes = data;
    renderListes();
    populateSelects();
  } catch (e) {
    toast('Erreur chargement listes : ' + e.message, 'error');
  }
}

function renderListes() {
  const container = document.getElementById('listes-container');
  const childListNames = new Set(Object.keys(listesParents));
  const rootNoms = Object.keys(listes).filter(n => !childListNames.has(n));

  const knownRoots = new Set(LISTE_CATS.flatMap(c => c.roots || []));
  const autresRoots = rootNoms.filter(n => !knownRoots.has(n));

  const navHTML = LISTE_CATS.map(cat => {
    const roots = cat.roots ? cat.roots.filter(r => rootNoms.includes(r)) : autresRoots;
    const total = roots.reduce((a, r) => a + (listes[r]?.length || 0), 0);
    const badge = total > 0 ? ` <span class="listes-tab-badge">${total}</span>` : '';
    return `<button class="listes-tab${cat.id === currentListeCat ? ' active' : ''}"
      onclick="switchListeCat('${cat.id}')">${cat.icon} ${cat.label}${badge}</button>`;
  }).join('');

  const cat = LISTE_CATS.find(c => c.id === currentListeCat);
  const catRoots = cat.roots ? cat.roots.filter(r => rootNoms.includes(r)) : autresRoots;

  const treeHTML = catRoots.length === 0
    ? '<div class="empty-msg" style="padding:1.5rem 0">Aucune liste dans cette catégorie.</div>'
    : catRoots.map(nom => renderTreeListe(nom)).join('');

  container.innerHTML = `<div class="listes-subnav">${navHTML}</div><div class="listes-tree">${treeHTML}</div>`;
}

function switchListeCat(catId) {
  currentListeCat = catId;
  renderListes();
}

function renderTreeListe(nom) {
  const valeurs = listes[nom] || [];
  const slug = slugify(nom);
  const iconMap = { 'Type intervention': '⚡', 'Entreprises': '🏭', 'Site': '📍' };
  const icon = iconMap[nom] || '📋';
  const esc_nom = esc(nom).replace(/'/g, '&#39;');

  const valeursHTML = valeurs.map(v => renderTreeValeur(nom, v)).join('');

  return `
    <div class="tree-root">
      <div class="tree-root-header">
        <span>${icon} ${esc(nom)}</span>
        <span class="tree-root-count">${valeurs.length} valeur${valeurs.length !== 1 ? 's' : ''}</span>
        <button class="btn btn-xs btn-red" onclick="supprimerListe('${esc_nom}')">Supprimer</button>
      </div>
      <div class="tree-root-body">
        ${valeursHTML || '<div class="tree-empty">Aucune valeur</div>'}
        <div class="tree-add-row">
          <input type="text" id="add-input-${slug}" placeholder="Nouvelle valeur…"
            onkeydown="if(event.key==='Enter') ajouterValeur('${esc(nom)}')" />
          <button class="btn btn-sm btn-primary" onclick="ajouterValeur('${esc(nom)}')">+ Ajouter</button>
        </div>
        <div class="coller-toggle" onclick="toggleColler('${slug}')">▸ Coller depuis Excel / texte</div>
        <div id="coller-zone-${slug}" class="coller-zone hidden">
          <textarea id="coller-input-${slug}" placeholder="Une valeur par ligne…" rows="4"></textarea>
          <button class="btn btn-sm btn-secondary" onclick="collerValeurs('${esc(nom)}')">Importer</button>
        </div>
      </div>
    </div>`;
}

function renderTreeValeur(parentNom, v) {
  const childListName = findChildList(parentNom, v);
  const nodeId = `tnode-${slugify(parentNom)}-${slugify(v)}`;
  const esc_nom = esc(parentNom).replace(/'/g, '&#39;');
  const esc_v   = esc(v).replace(/'/g, '&#39;');

  let childHTML = '';
  if (childListName) {
    const childSlug = slugify(childListName);
    const childValeurs = listes[childListName] || [];
    const esc_cln = esc(childListName).replace(/'/g, '&#39;');
    const leafsHTML = childValeurs.map(cv => {
      const esc_cv = esc(cv).replace(/'/g, '&#39;');
      return `<div class="tree-leaf">
        <span class="tree-leaf-dot">·</span>
        <span class="tree-leaf-label">${esc(cv)}</span>
        <button class="btn-suppr-valeur tree-leaf-del" title="Supprimer" onclick="supprimerValeur('${esc_cln}','${esc_cv}')">✕</button>
      </div>`;
    }).join('');

    childHTML = `
      <div class="tree-child" id="${nodeId}-child">
        <div class="tree-child-header">
          <span class="tree-child-list-label">${esc(childListName)}</span>
          <span class="tree-child-count">${childValeurs.length}</span>
        </div>
        ${leafsHTML || '<div class="tree-empty">Aucune valeur</div>'}
        <div class="tree-add-row tree-add-child">
          <input type="text" id="add-input-${childSlug}" placeholder="Nouvelle valeur…"
            onkeydown="if(event.key==='Enter') ajouterValeur('${esc(childListName)}')" />
          <button class="btn btn-sm btn-primary" onclick="ajouterValeur('${esc(childListName)}')">+ Ajouter</button>
        </div>
      </div>`;
  }

  return `
    <div class="tree-node${childListName ? ' tree-has-child' : ''}" id="${nodeId}">
      <div class="tree-node-row" ${childListName ? `onclick="toggleTreeNode('${nodeId}')"` : ''}>
        <span class="tree-node-arrow">${childListName ? '▶' : '·'}</span>
        <span class="tree-node-label">${esc(v)}</span>
        <div class="tree-node-actions">
          ${!childListName
            ? `<button class="btn btn-xs btn-outline" onclick="event.stopPropagation();ouvrirCreerEnfant('${esc_nom}','${esc_v}')">+ Sous-liste</button>`
            : ''}
          <button class="btn-suppr-valeur" title="Supprimer" onclick="event.stopPropagation();supprimerValeur('${esc_nom}','${esc_v}')">✕</button>
        </div>
      </div>
      ${childHTML}
    </div>`;
}

function toggleTreeNode(nodeId) {
  const el = document.getElementById(nodeId);
  if (el) el.classList.toggle('tree-open');
}

function findChildList(parentListName, parentValue) {
  const key = `${parentListName}::${parentValue}`;
  return Object.keys(listesParents).find(n => listesParents[n] === key) || null;
}

/* ---- Cascade multi-niveaux dans le formulaire ---- */

function onTypeChange() {
  const container = document.getElementById('cascade-container');
  if (!container) return;
  container.innerHTML = '';
  const type = document.getElementById('f-type').value;
  buildCascadeLevels(container, 'Type intervention', type, 1);
}

function buildCascadeLevels(container, parentListName, parentValue, level) {
  if (!parentValue) return;
  const childListName = findChildList(parentListName, parentValue);
  if (!childListName || !listes[childListName] || listes[childListName].length === 0) return;

  const levelId = `f-cascade-${level}`;
  const row = document.createElement('div');
  row.className = 'form-row';
  row.id = `cascade-row-${level}`;
  const safeList = childListName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  row.innerHTML = `
    <div class="form-group cascade-level" style="flex:1">
      <label for="${levelId}">${esc(childListName)}</label>
      <select id="${levelId}" onchange="onCascadeChange(${level}, '${safeList}')">
        <option value="">— Sélectionner —</option>
        ${listes[childListName].map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('')}
      </select>
    </div>`;
  container.appendChild(row);
}

function onCascadeChange(level, listName) {
  const value = document.getElementById(`f-cascade-${level}`)?.value || '';
  const container = document.getElementById('cascade-container');
  for (let i = level + 1; i <= 10; i++) {
    const el = document.getElementById(`cascade-row-${i}`);
    if (el) el.remove(); else break;
  }
  buildCascadeLevels(container, listName, value, level + 1);
}

function getCascadeValues() {
  const type = document.getElementById('f-type').value;
  const parts = [];
  for (let i = 1; i <= 10; i++) {
    const sel = document.getElementById(`f-cascade-${i}`);
    if (!sel) break;
    if (sel.value) parts.push(sel.value);
  }
  return { type, sous_type: parts.length ? parts.join(' › ') : null };
}

/* ---- Créer une sous-liste depuis Paramètres ---- */

function ouvrirCreerEnfant(parentListe, parentValeur) {
  document.getElementById('creer-enfant-parent-liste').value = parentListe;
  document.getElementById('creer-enfant-parent-valeur').value = parentValeur;
  document.getElementById('creer-enfant-context').textContent =
    `Sous-liste pour la valeur « ${parentValeur} » de la liste « ${parentListe} »`;
  document.getElementById('creer-enfant-nom').value = '';
  document.getElementById('creer-enfant-premiere-valeur').value = '';
  document.getElementById('modal-creer-enfant').classList.remove('hidden');
}

async function confirmerCreerEnfant() {
  const parentListe    = document.getElementById('creer-enfant-parent-liste').value;
  const parentValeur   = document.getElementById('creer-enfant-parent-valeur').value;
  const nom_liste      = document.getElementById('creer-enfant-nom').value.trim();
  const premiere_valeur = document.getElementById('creer-enfant-premiere-valeur').value.trim();
  if (!nom_liste || !premiere_valeur) {
    toast('Renseignez le nom et la première valeur.', 'error'); return;
  }
  const parent_key = `${parentListe}::${parentValeur}`;
  try {
    await apiFetch('/listes/creer', {
      method: 'POST',
      body: JSON.stringify({ nom_liste, premiere_valeur, parent_key }),
    });
    toast(`Sous-liste "${nom_liste}" créée.`, 'success');
    document.getElementById('modal-creer-enfant').classList.add('hidden');
    await loadListes();
  } catch (e) { toast('Erreur : ' + e.message, 'error'); }
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

function toggleColler(slug) {
  const zone = document.getElementById('coller-zone-' + slug);
  zone.classList.toggle('hidden');
}

async function collerValeurs(nom_liste) {
  const slug  = slugify(nom_liste);
  const texte = document.getElementById('coller-input-' + slug)?.value || '';
  const valeurs = texte
    .split(/\r?\n/)
    .map(line => line.split('\t')[0].trim())  // garde uniquement la 1re colonne Excel
    .filter(v => v.length > 0);

  if (valeurs.length === 0) { toast('Aucune valeur à importer.', 'error'); return; }

  try {
    const res = await apiFetch('/listes/bulk', {
      method: 'POST',
      body: JSON.stringify({ nom_liste, valeurs }),
    });
    toast(`${res.inserted} valeur(s) importée(s).`, 'success');
    document.getElementById('coller-input-' + slug).value = '';
    document.getElementById('coller-zone-' + slug).classList.add('hidden');
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

async function importerComplet() {
  const file = document.getElementById('import-complet-file')?.files[0];
  if (!file) { toast('Sélectionnez un fichier de sauvegarde JSON.', 'error'); return; }
  try {
    const text = await file.text();
    const json = JSON.parse(text);
    const msg = [];

    if (Array.isArray(json.listes) && json.listes.length > 0) {
      await apiFetch('/backup/import-listes', { method: 'POST', body: JSON.stringify({ listes: json.listes }) });
      msg.push(`${json.listes.length} valeurs de listes`);
      await loadListes();
    }
    if (Array.isArray(json.interventions) && json.interventions.length > 0) {
      const res = await apiFetch('/backup/import-interventions', {
        method: 'POST',
        body: JSON.stringify({ interventions: json.interventions }),
      });
      msg.push(`${res.imported} intervention(s)`);
      await loadDashboard();
      await loadHistorique();
    }

    if (msg.length === 0) {
      toast('Aucune donnée reconnue dans ce fichier.', 'error');
    } else {
      document.getElementById('import-complet-file').value = '';
      toast(`Import réussi : ${msg.join(' + ')}.`, 'success');
    }
  } catch (e) {
    toast('Erreur import : ' + e.message, 'error');
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
  const initials = (currentUser.display_name || '?')
    .split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase();
  document.getElementById('user-avatar').textContent       = initials;
  document.getElementById('user-display-name').textContent = currentUser.display_name || '–';
  const compteNomEl = document.getElementById('compte-nom');
  if (compteNomEl) compteNomEl.textContent = currentUser.display_name || '–';

  const adminNav = document.getElementById('nav-sub-admin');
  if (currentUser.is_admin) adminNav?.classList.remove('hidden');
  else                      adminNav?.classList.add('hidden');
}

async function login() {
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('login-error');
  errEl.textContent = '';

  if (!username || !password) { errEl.textContent = 'Nom et mot de passe requis.'; return; }

  try {
    const data = await fetch(API + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
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
      is_admin:      data.is_admin || false,
    };
    sessionStorage.setItem('sicae_user', JSON.stringify(currentUser));

    hideLoginScreen();
    updateHeaderUser();
    await Promise.all([loadListes(), loadDashboard(), loadHistorique(), loadAppUsers()]);
    initFormInterventions();
    await loadConduite();
    if (currentUser.is_admin) await loadUsers();
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
  document.getElementById('nav-sub-admin')?.classList.add('hidden');
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

    // Dropdown transfert de conduite (modal)
    const selTransfert = document.getElementById('transfert-to-email');
    if (selTransfert) {
      selTransfert.innerHTML = '<option value="">— Sélectionner un agent —</option>';
      if (appUsers.length === 0) {
        selTransfert.innerHTML += '<option disabled>Aucun autre agent disponible</option>';
      } else {
        appUsers.forEach(u => {
          const opt = document.createElement('option');
          opt.value = u.email;
          opt.textContent = u.display_name;
          selTransfert.appendChild(opt);
        });
      }
    }

    // Dropdown passation de conduite (tab conduite)
    populateConduiteSelect();
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
              📍 ${esc(int.ouvrage || '?')} ·
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
    const groupeLabels = { site: 'site', type: "type d'intervention", ouvrage: 'ouvrage' };
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
        <td>${esc(i.site || '')}</td>
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
    'Site':           i.site || '',
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
  const groupeLabel = { site: 'Site', type: "Type d'intervention", ouvrage: 'Ouvrage' }[groupe];
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
  const groupeLabel  = { site: 'Site', type: "Type d'intervention", ouvrage: 'Ouvrage' }[groupe];

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
      <td>${esc(i.site || '')}</td>
      <td>${esc(i.heure_debut)}${i.heure_fin ? ' → ' + esc(i.heure_fin) : ''}</td>
      <td>${formatDureeMin(calculerDureeMin(i))}</td>
      <td><span style="background:${sc}22;color:${sc};padding:2px 8px;border-radius:50px;font-size:8pt;font-weight:700">${esc(i.statut)}</span></td>
      <td style="font-size:8pt;color:#6c757d">${esc(i.observations || '')}</td>
      <td style="font-size:8pt">${(i.intervenants && i.intervenants.length > 0) ? i.intervenants.map(iv => `${esc(iv.entreprise)} – ${esc(iv.agent)}`).join('<br>') : ''}</td>
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
  <thead><tr><th>Date</th><th>Type</th><th>Ouvrage</th><th>Site</th><th>Horaires</th><th>Durée</th><th>Statut</th><th>Observations</th><th>Intervenants</th></tr></thead>
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
   TRANSFERT DE CONDUITE RÉSEAU
   ============================================================ */

function formatHMS(isoStr) {
  if (!isoStr) return '–';
  const d = new Date(isoStr);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatDateHMS(isoStr) {
  if (!isoStr) return '–';
  const d = new Date(isoStr);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function dureeSinceISO(isoStr) {
  if (!isoStr) return '';
  const diff = Math.floor((Date.now() - new Date(isoStr)) / 1000);
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  if (h > 0) return `depuis ${h}h${String(m).padStart(2,'0')}`;
  return `depuis ${m} min`;
}

async function loadConduite() {
  try {
    const data = await apiFetch('/conduite');
    renderConducteurActuel(data.conducteurActuel);
    renderConduiteAttente(data.enAttentePourMoi || []);
    renderJournalConduite(data.journal || []);
    populateConduiteSelect();

    const badge = document.getElementById('badge-conduite');
    const n = (data.enAttentePourMoi || []).length;
    if (n > 0) { badge.textContent = n; badge.classList.remove('hidden'); }
    else badge.classList.add('hidden');
  } catch (e) {
    toast('Erreur chargement conduite : ' + e.message, 'error');
  }
}

function renderConducteurActuel(c) {
  const nameEl  = document.getElementById('conducteur-name');
  const sinceEl = document.getElementById('conducteur-since');
  if (!c) {
    nameEl.textContent  = 'Non défini';
    sinceEl.textContent = '';
    return;
  }
  const isMoi = c.email === currentUser?.email;
  nameEl.textContent  = c.name + (isMoi ? ' (vous)' : '');
  sinceEl.textContent = `Prise en charge le ${formatDateHMS(c.depuis)} — ${dureeSinceISO(c.depuis)}`;
}

function renderConduiteAttente(items) {
  const section = document.getElementById('conduite-attente-section');
  const cards   = document.getElementById('conduite-attente-cards');
  if (items.length === 0) { section.classList.add('hidden'); return; }
  section.classList.remove('hidden');
  cards.innerHTML = items.map(r => `
    <div class="param-card" style="border-left:4px solid var(--orange);margin-bottom:.75rem">
      <div style="font-weight:700;margin-bottom:.35rem">
        Passation de <strong>${esc(r.from_name)}</strong>
      </div>
      <div style="font-size:.85rem;color:var(--gray-600);margin-bottom:.5rem">
        Demandée le ${formatDateHMS(r.demande_at)}
      </div>
      ${r.observations ? `<div class="card-obs" style="margin-bottom:.75rem">"${esc(r.observations)}"</div>` : ''}
      <div style="display:flex;gap:.5rem">
        <button class="btn btn-sm btn-primary" onclick="accepterPassation(${r.id})">✓ Accepter la conduite</button>
        <button class="btn btn-sm btn-red"     onclick="refuserPassation(${r.id})">✕ Refuser</button>
      </div>
    </div>`).join('');
}

function renderJournalConduite(journal) {
  const tbody = document.getElementById('conduite-journal-tbody');
  if (journal.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-msg">Aucune passation enregistrée</td></tr>';
    return;
  }
  tbody.innerHTML = journal.map(r => {
    const statutClass = r.statut === 'Accepté' ? 'badge-terminee' : r.statut === 'Refusé' ? 'badge-en-transfert' : 'badge-suspendue';
    const d = new Date(r.demande_at);
    const dateStr = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
    return `
      <tr>
        <td>${dateStr}</td>
        <td>${esc(r.from_name)}</td>
        <td>${esc(r.to_name)}</td>
        <td style="font-variant-numeric:tabular-nums;white-space:nowrap">${formatHMS(r.demande_at)}</td>
        <td style="font-variant-numeric:tabular-nums;white-space:nowrap">${r.accepte_at ? formatHMS(r.accepte_at) : '–'}</td>
        <td><span class="badge ${statutClass}">${esc(r.statut)}</span></td>
        <td style="font-size:.82rem;color:var(--gray-600)">${esc(r.observations || '')}</td>
      </tr>`;
  }).join('');
}

function populateConduiteSelect() {
  const sel = document.getElementById('conduite-to');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">— Sélectionner un agent —</option>';
  appUsers.forEach(u => {
    const opt = document.createElement('option');
    opt.value       = u.email;
    opt.dataset.name = u.display_name;
    opt.textContent = u.display_name;
    if (u.email === cur) opt.selected = true;
    sel.appendChild(opt);
  });
}

async function initierPassation() {
  const sel  = document.getElementById('conduite-to');
  const obs  = document.getElementById('conduite-obs').value.trim() || null;
  const to_email = sel.value;
  const to_name  = sel.options[sel.selectedIndex]?.dataset.name || '';
  if (!to_email) { toast('Sélectionnez un agent destinataire.', 'error'); return; }
  try {
    await apiFetch('/conduite', { method: 'POST', body: JSON.stringify({ to_email, to_name, observations: obs }) });
    toast('Passation initiée — en attente d\'acceptation.', 'success');
    document.getElementById('conduite-to').value = '';
    document.getElementById('conduite-obs').value = '';
    await loadConduite();
  } catch (e) { toast('Erreur : ' + e.message, 'error'); }
}

async function accepterPassation(id) {
  try {
    await apiFetch(`/conduite/${id}/accept`, { method: 'PUT' });
    toast('Conduite acceptée — vous êtes maintenant conducteur.', 'success');
    await loadConduite();
  } catch (e) { toast('Erreur : ' + e.message, 'error'); }
}

async function refuserPassation(id) {
  if (!confirm('Refuser cette passation de conduite ?')) return;
  try {
    await apiFetch(`/conduite/${id}/refuse`, { method: 'PUT' });
    toast('Passation refusée.', 'success');
    await loadConduite();
  } catch (e) { toast('Erreur : ' + e.message, 'error'); }
}

/* ============================================================
   ADMINISTRATION UTILISATEURS
   ============================================================ */

let adminUsers = [];

async function loadUsers() {
  try {
    adminUsers = await apiFetch('/users');
    renderUsers();
  } catch (e) {
    toast('Erreur chargement utilisateurs : ' + e.message, 'error');
  }
}

function renderUsers() {
  const tbody = document.getElementById('admin-users-tbody');
  if (!tbody) return;
  if (adminUsers.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-msg">Aucun utilisateur</td></tr>';
    return;
  }
  tbody.innerHTML = adminUsers.map(u => {
    const isSelf = u.email === currentUser?.email;
    const roleBadge = u.is_admin
      ? '<span class="badge badge-en-cours" style="background:#1a3a5c">Admin</span>'
      : '<span class="badge" style="background:#6c757d;color:#fff">Agent</span>';
    const toggleLabel = u.is_admin ? 'Rétrograder agent' : 'Promouvoir admin';
    return `
      <tr>
        <td><strong>${esc(u.display_name)}</strong></td>
        <td>${roleBadge}</td>
        <td style="min-width:220px">
          <div style="display:flex;gap:.5rem;align-items:center">
            <input type="password" id="pwd-${esc(u.email)}" placeholder="Nouveau mot de passe"
              style="flex:1;padding:.35rem .6rem;border:1px solid var(--gray-300);border-radius:6px;font-size:.85rem" />
            <button class="btn btn-sm btn-secondary" onclick="resetMotDePasse('${esc(u.email)}')">OK</button>
          </div>
        </td>
        <td>
          <div style="display:flex;gap:.5rem;flex-wrap:wrap">
            ${!isSelf ? `<button class="btn btn-sm btn-ghost" onclick="toggleAdmin('${esc(u.email)}',${!u.is_admin})">${toggleLabel}</button>` : ''}
            ${!isSelf ? `<button class="btn btn-sm btn-red" onclick="supprimerUtilisateur('${esc(u.email)}','${esc(u.display_name)}')">Supprimer</button>` : '<span style="font-size:.8rem;color:var(--gray-500)">(vous)</span>'}
          </div>
        </td>
      </tr>`;
  }).join('');
}

async function creerUtilisateur() {
  const username = document.getElementById('admin-new-nom').value.trim();
  const password = document.getElementById('admin-new-pwd').value;
  const is_admin = document.getElementById('admin-new-is-admin').checked;

  if (!username || !password) { toast('Nom et mot de passe requis.', 'error'); return; }
  if (password.length < 6) { toast('Mot de passe : 6 caractères minimum.', 'error'); return; }

  try {
    await apiFetch('/users', { method: 'POST', body: JSON.stringify({ username, password, is_admin }) });
    toast(`Utilisateur "${username}" créé.`, 'success');
    document.getElementById('admin-new-nom').value = '';
    document.getElementById('admin-new-pwd').value = '';
    document.getElementById('admin-new-is-admin').checked = false;
    await loadUsers();
    await loadAppUsers();
  } catch (e) {
    toast('Erreur : ' + e.message, 'error');
  }
}

async function supprimerUtilisateur(email, nom) {
  if (!confirm(`Supprimer l'utilisateur "${nom}" ? Cette action est irréversible.`)) return;
  try {
    await apiFetch(`/users/${encodeURIComponent(email)}`, { method: 'DELETE' });
    toast(`Utilisateur "${nom}" supprimé.`, 'success');
    await loadUsers();
    await loadAppUsers();
  } catch (e) {
    toast('Erreur : ' + e.message, 'error');
  }
}

async function resetMotDePasse(email) {
  const input = document.getElementById(`pwd-${email}`);
  const password = input?.value || '';
  if (!password) { toast('Saisissez un nouveau mot de passe.', 'error'); return; }
  if (password.length < 6) { toast('6 caractères minimum.', 'error'); return; }
  try {
    await apiFetch(`/users/${encodeURIComponent(email)}/password`, {
      method: 'PUT', body: JSON.stringify({ password }),
    });
    toast('Mot de passe réinitialisé.', 'success');
    if (input) input.value = '';
  } catch (e) {
    toast('Erreur : ' + e.message, 'error');
  }
}

async function toggleAdmin(email, is_admin) {
  const action = is_admin ? 'Promouvoir administrateur' : 'Rétrograder en agent';
  if (!confirm(`${action} ?`)) return;
  try {
    await apiFetch(`/users/${encodeURIComponent(email)}/admin`, {
      method: 'PUT', body: JSON.stringify({ is_admin }),
    });
    toast('Rôle modifié.', 'success');
    await loadUsers();
  } catch (e) {
    toast('Erreur : ' + e.message, 'error');
  }
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
  document.getElementById('login-username').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
  document.getElementById('login-password').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
  document.getElementById('btn-logout').addEventListener('click', logout);

  // Transfert de conduite
  document.getElementById('btn-initier-passation').addEventListener('click', initierPassation);

  // Administration utilisateurs
  document.getElementById('btn-admin-creer').addEventListener('click', creerUtilisateur);

  // Audit (admin)
  document.getElementById('btn-refresh-audit').addEventListener('click', loadJournalModifications);

  // Journal des interventions
  document.getElementById('btn-journal-refresh').addEventListener('click', loadJournal);
  document.getElementById('journal-search').addEventListener('input', filterJournal);
  document.getElementById('journal-statut-filter').addEventListener('change', filterJournal);
  document.getElementById('journal-date-debut').addEventListener('change', filterJournal);
  document.getElementById('journal-date-fin').addEventListener('change', filterJournal);

  // Modale édition intervention
  document.getElementById('btn-sauvegarder-edition').addEventListener('click', sauvegarderEdition);
  document.getElementById('btn-annuler-edition').addEventListener('click', fermerEdition);
  document.getElementById('modal-edition').addEventListener('click', function(e) { if (e.target === this) fermerEdition(); });

  // Cascade sous-type dans l'édition
  document.getElementById('edition-type').addEventListener('change', () => {
    const type = document.getElementById('edition-type').value;
    const childListName = findChildList('Type intervention', type);
    const grp = document.getElementById('edition-sous-type-group');
    if (childListName && listes[childListName]) {
      fillSelect('edition-sous-type', listes[childListName]);
      if (grp) grp.style.display = '';
    } else {
      if (grp) grp.style.display = 'none';
    }
  });

  // Modale créer sous-liste
  document.getElementById('btn-confirmer-enfant').addEventListener('click', confirmerCreerEnfant);
  document.getElementById('btn-annuler-enfant').addEventListener('click', () => {
    document.getElementById('modal-creer-enfant').classList.add('hidden');
  });
  document.getElementById('modal-creer-enfant').addEventListener('click', function(e) {
    if (e.target === this) this.classList.add('hidden');
  });

  // FAB — nouvelle intervention
  document.getElementById('btn-fab-new').addEventListener('click', () => switchTab('nouvelle'));

  // Navigation : boutons directs (avec data-tab)
  document.querySelectorAll('.nav-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab);
      if (btn.dataset.tab === 'dashboard' && currentUser) loadDashboard(!realtimeChannel);
    });
  });

  // Navigation : toggles dropdown (avec data-group)
  document.querySelectorAll('.nav-drop-toggle').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const item = btn.closest('.nav-item');
      const isOpen = item.classList.contains('drop-open');
      document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('drop-open'));
      if (!isOpen) item.classList.add('drop-open');
    });
  });

  // Navigation : sous-items dans les dropdowns
  document.querySelectorAll('.nav-drop-item[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab);
      if (btn.dataset.tab === 'dashboard' && currentUser) loadDashboard(!realtimeChannel);
    });
  });

  // Fermer les dropdowns en cliquant ailleurs
  document.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('drop-open'));
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


  // Paramètres — sauvegarde
  document.getElementById('btn-export').addEventListener('click', exporterSauvegarde);
  document.getElementById('btn-import-complet').addEventListener('click', importerComplet);

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
    await loadConduite();
    if (currentUser?.is_admin) await loadUsers();
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
window.accepterPassation      = accepterPassation;
window.refuserPassation       = refuserPassation;
window.toggleColler           = toggleColler;
window.collerValeurs          = collerValeurs;
window.supprimerUtilisateur   = supprimerUtilisateur;
window.resetMotDePasse        = resetMotDePasse;
window.toggleAdmin            = toggleAdmin;
window.ouvrirEditionIntervention = ouvrirEditionIntervention;
window.supprimerDepuisJournal = supprimerDepuisJournal;
window.onEntrepriseChange  = onEntrepriseChange;
window.toggleAgentPill     = toggleAgentPill;
window.majIntervenants     = majIntervenants;
window.retirerIntervenant  = retirerIntervenant;
window.onTypeChange        = onTypeChange;
window.onCascadeChange     = onCascadeChange;
window.ouvrirCreerEnfant   = ouvrirCreerEnfant;
window.switchListeCat      = switchListeCat;
window.toggleTreeNode      = toggleTreeNode;
