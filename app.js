(() => {
  'use strict';

  const SEED = window.APEX_INITIAL_DATA;
  if (!SEED || !Array.isArray(SEED.records)) throw new Error('APEX admissions data could not be loaded.');
  const STORAGE_KEY = 'apex_os_local_v2';
  const OLD_KEYS = ['apex_os_local_v1'];
  const DIRTY_KEY = 'apex_os_cloud_dirty_user_v2';
  const CONFIG = window.APEX_SUPABASE_CONFIG || {};
  const supabaseUrl = String(CONFIG.url || '').trim();
  const publishableKey = String(CONFIG.publishableKey || '').trim();
  const sb = window.supabase?.createClient && /^https:\/\//i.test(supabaseUrl) && publishableKey
    ? window.supabase.createClient(supabaseUrl, publishableKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      }) : null;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const clone = value => JSON.parse(JSON.stringify(value));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
  const safeUrl = value => {
    try {
      const parsed = new URL(value);
      return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : '';
    } catch { return ''; }
  };
  const getSeedRecord = id => SEED.records.find(record => record.id === id);
  const seedIds = new Set(SEED.records.map(record => record.id));

  function emptyWorkspace() {
    const workspace = {};
    for (const record of SEED.records) {
      workspace[record.id] = { status: 'Researching', priority: false, note: '' };
    }
    return workspace;
  }

  function normaliseWorkspace(input) {
    const out = emptyWorkspace();
    if (!input || typeof input !== 'object') return out;
    for (const id of seedIds) {
      const source = input[id];
      if (!source || typeof source !== 'object') continue;
      out[id] = {
        status: ['Researching', 'Shortlisted', 'Applying', 'Submitted', 'Admitted', 'Declined', 'Not pursuing'].includes(source.status)
          ? source.status : 'Researching',
        priority: source.priority === true,
        note: typeof source.note === 'string' ? source.note.slice(0, 20000) : ''
      };
    }
    return out;
  }

  function normalisePreferences(input) {
    const source = input && typeof input === 'object' ? input : {};
    return {
      theme: ['dark', 'light', 'system'].includes(source.theme) ? source.theme : 'dark',
      accent: ['lime', 'blue', 'violet', 'teal', 'rose', 'amber'].includes(source.accent) ? source.accent : 'lime',
      density: ['comfortable', 'compact'].includes(source.density) ? source.density : 'comfortable',
      fontScale: ['normal', 'large'].includes(source.fontScale) ? source.fontScale : 'normal',
      reducedMotion: source.reducedMotion === true
    };
  }

  function readStorage() {
    for (const key of [STORAGE_KEY, ...OLD_KEYS]) {
      try {
        const raw = localStorage.getItem(key);
        if (raw) return JSON.parse(raw);
      } catch (error) { console.warn('Ignoring unreadable APEX local state:', error); }
    }
    return null;
  }

  const previousState = readStorage();
  let state = {
    schemaVersion: 2,
    datasetVersion: SEED.datasetVersion,
    workspace: normaliseWorkspace(previousState?.workspace),
    preferences: normalisePreferences(previousState?.preferences),
    createdAt: previousState?.createdAt || new Date().toISOString(),
    updatedAt: previousState?.updatedAt || new Date().toISOString()
  };
  let activeView = 'overview';
  let activeRecordId = null;
  let activeTab = 'overview';
  let activeFilter = 'all';
  let searchTerm = '';
  let toastTimer = null;
  let saveTimer = null;
  let cloudTimer = null;
  let cloudUser = null;
  let cloudReady = false;
  let cloudDirty = false;
  let cloudBusy = false;
  let cloudChannel = null;
  let lastCloudVersion = 0;
  const content = $('#content');
  const accentMap = {
    lime: ['#b7ee83', '#d0f5a7'], blue: ['#83b7ff', '#a6ccff'], violet: ['#a895ff', '#c1b5ff'],
    teal: ['#65d7bd', '#91ebd5'], rose: ['#ef9ac1', '#f5b4d1'], amber: ['#f2c879', '#f6d99b']
  };

  function applyPreferences() {
    const prefs = state.preferences;
    let theme = prefs.theme;
    if (theme === 'system') theme = window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    const accent = accentMap[prefs.accent] || accentMap.lime;
    document.documentElement.style.setProperty('--accent', accent[0]);
    document.documentElement.style.setProperty('--accent-2', accent[1]);
    document.body.dataset.density = prefs.density;
    document.body.dataset.font = prefs.fontScale;
    document.body.dataset.motion = prefs.reducedMotion ? 'reduce' : 'normal';
  }

  function toast(message) {
    const element = $('#toast');
    if (!element) return;
    element.textContent = message;
    element.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove('show'), 2500);
  }

  function setSaveLabel(message) {
    const element = $('#saveState');
    if (element) element.textContent = message;
  }

  function setCloudStatus(status, label) {
    const dot = $('#cloudDot');
    const text = $('#cloudLabel');
    if (dot) dot.className = 'cloud-dot ' + status;
    if (text) text.textContent = label || ({ local: 'Local workspace', saving: 'Syncing workspace…', ok: 'Cloud synchronised', off: 'Cloud unavailable' }[status] || 'Local workspace');
  }

  function persist({ cloud = true, message = 'Saved locally' } = {}) {
    state.updatedAt = new Date().toISOString();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      setSaveLabel(message);
    } catch (error) {
      console.error('APEX local save failed:', error);
      setSaveLabel('Local storage unavailable');
      toast('Could not save in this browser. Export a backup.');
      return;
    }
    if (cloud) queueCloudSave();
  }

  function safeCloudPayload(raw) {
    const data = raw && typeof raw === 'object' ? raw : {};
    return {
      schemaVersion: 2,
      datasetVersion: SEED.datasetVersion,
      workspace: normaliseWorkspace(data.workspace),
      preferences: normalisePreferences(data.preferences),
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: data.updatedAt || new Date().toISOString()
    };
  }

  function queueCloudSave() {
    if (!sb || !cloudUser || !cloudReady) return;
    cloudDirty = true;
    try { localStorage.setItem(DIRTY_KEY, cloudUser.id); } catch { /* ignore */ }
    setCloudStatus('saving');
    clearTimeout(cloudTimer);
    cloudTimer = setTimeout(cloudSave, 650);
  }

  async function cloudSave() {
    if (!sb || !cloudUser || !cloudReady || !cloudDirty) return;
    if (cloudBusy) {
      clearTimeout(cloudTimer);
      cloudTimer = setTimeout(cloudSave, 900);
      return;
    }
    cloudBusy = true;
    cloudTimer = null;
    const snapshot = clone(state);
    const sentAt = snapshot.updatedAt || new Date().toISOString();
    setCloudStatus('saving');
    try {
      const { data, error } = await sb.from('apex_cloud_state').upsert({
        user_id: cloudUser.id,
        data: snapshot,
        client_updated_at: sentAt
      }, { onConflict: 'user_id' }).select('client_updated_at,version').single();
      if (error) throw error;
      lastCloudVersion = Date.parse(data?.server_updated_at || data?.client_updated_at || sentAt) || Date.now();
      cloudDirty = false;
      try { localStorage.removeItem(DIRTY_KEY); } catch { /* ignore */ }
      setCloudStatus('ok');
      setSaveLabel('Cloud saved');
      if (state.updatedAt !== sentAt) {
        cloudDirty = true;
        queueCloudSave();
      }
    } catch (error) {
      console.error('APEX cloud save failed:', error);
      setCloudStatus('off', 'Cloud sync issue');
      setSaveLabel('Saved locally · cloud retry pending');
      const auth = $('#authmsg');
      if (auth) auth.textContent = error.message || 'Cloud save failed. Your local workspace is safe.';
    } finally {
      cloudBusy = false;
    }
  }

  async function cloudLoad() {
    if (!sb || !cloudUser) return;
    cloudReady = false;
    setCloudStatus('saving');
    try {
      const { data, error } = await sb.from('apex_cloud_state')
        .select('data,version,client_updated_at,server_updated_at')
        .eq('user_id', cloudUser.id).maybeSingle();
      if (error) throw error;
      let dirtyUser = '';
      try { dirtyUser = localStorage.getItem(DIRTY_KEY) || ''; } catch { /* ignore */ }
      if (dirtyUser === cloudUser.id) {
        cloudReady = true;
        cloudDirty = true;
        await cloudSave();
        return;
      }
      if (data?.data) {
        state = safeCloudPayload(data.data);
        lastCloudVersion = Date.parse(data.server_updated_at || data.client_updated_at || '') || 0;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        cloudReady = true;
        cloudDirty = false;
        setCloudStatus('ok');
        render();
      } else {
        cloudReady = true;
        cloudDirty = true;
        await cloudSave();
      }
    } catch (error) {
      console.error('APEX cloud load failed:', error);
      cloudReady = false;
      setCloudStatus('off', 'Cloud sync unavailable');
      authMessage(error.message || 'Could not load cloud data.', true);
    }
  }

  function subscribeCloud() {
    if (!sb || !cloudUser) return;
    if (cloudChannel) sb.removeChannel(cloudChannel);
    const userId = cloudUser.id;
    cloudChannel = sb.channel('apex-state-' + userId)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'apex_cloud_state', filter: 'user_id=eq.' + userId
      }, payload => {
        const row = payload.new;
        if (!row?.data || cloudDirty || cloudBusy || cloudTimer) return;
        const incomingVersion = Date.parse(row.server_updated_at || row.client_updated_at || '') || 0;
        if (incomingVersion > lastCloudVersion) {
          state = safeCloudPayload(row.data);
          lastCloudVersion = incomingVersion;
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
          setCloudStatus('ok');
          render();
        }
      }).subscribe();
  }

  async function initCloud() {
    if (!sb) {
      setCloudStatus('local', 'Local workspace');
      return;
    }
    try {
      const { data, error } = await sb.auth.getSession();
      if (error) throw error;
      cloudUser = data.session?.user || null;
      if (cloudUser) {
        $('#authOpen').textContent = cloudUser.email || 'Account';
        await cloudLoad();
        subscribeCloud();
      } else {
        setCloudStatus('local', 'Signed out · local only');
        $('#authOpen').textContent = '☁';
      }
    } catch (error) {
      console.error('APEX auth initialisation failed:', error);
      setCloudStatus('off', 'Cloud unavailable');
    }
    sb.auth.onAuthStateChange(async (_event, session) => {
      const newUser = session?.user || null;
      if (newUser?.id === cloudUser?.id) return;
      cloudUser = newUser;
      cloudReady = false;
      cloudDirty = false;
      if (cloudChannel) { sb.removeChannel(cloudChannel); cloudChannel = null; }
      if (cloudUser) {
        $('#authOpen').textContent = cloudUser.email || 'Account';
        await cloudLoad();
        subscribeCloud();
      } else {
        $('#authOpen').textContent = '☁';
        setCloudStatus('local', 'Signed out · local only');
      }
    });
  }

  function authMessage(message, bad = false) {
    const element = $('#authmsg');
    if (!element) return;
    element.textContent = message;
    element.classList.toggle('bad', bad);
    element.classList.toggle('ok', !bad);
  }

  function openAuth() {
    if (!sb) {
      authMessage('Cloud configuration is unavailable. Local saving still works.', true);
    } else {
      authMessage(cloudUser ? `Signed in as ${cloudUser.email || 'your account'}. Your workspace syncs automatically.` : 'Sign in or create an account to sync your APEX workspace.');
    }
    $('#authbox').classList.remove('hidden');
    $('#authEmail').focus();
  }

  function closeAuth() { $('#authbox').classList.add('hidden'); }

  async function signIn(signUp = false) {
    if (!sb) return authMessage('Supabase is not configured.', true);
    const email = $('#authEmail').value.trim();
    const password = $('#authPassword').value;
    if (!email || !password) return authMessage('Enter your email and password.', true);
    const button = signUp ? $('#signUpButton') : $('#signInButton');
    button.disabled = true;
    try {
      const result = signUp
        ? await sb.auth.signUp({ email, password })
        : await sb.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      if (signUp && !result.data.session) authMessage('Account created. Check your email to confirm it, then sign in.');
      else authMessage('Signed in. Preparing your private cloud workspace…');
    } catch (error) {
      authMessage(error.message || 'Authentication failed.', true);
    } finally { button.disabled = false; }
  }

  async function signOut() {
    if (!sb) return;
    const { error } = await sb.auth.signOut();
    if (error) authMessage(error.message, true);
    else authMessage('Signed out. This browser copy remains available locally.');
  }

  function getWorkspace(recordId) {
    if (!state.workspace[recordId]) state.workspace[recordId] = { status: 'Researching', priority: false, note: '' };
    return state.workspace[recordId];
  }

  function dateStatus(record) {
    const dates = record.dates || {};
    if (dates.status === 'confirmed') return { label: '2028 dates published', className: 'ok' };
    if (dates.status === 'recurring_window') return { label: 'Annual window · year not confirmed', className: 'warn' };
    return { label: '2028 dates not announced', className: 'warn' };
  }

  function recordCard(record) {
    const work = getWorkspace(record.id);
    const status = dateStatus(record);
    return `<article class="record-card" data-action="open-record" data-record="${esc(record.id)}" tabindex="0" role="button" aria-label="Open ${esc(record.name)} profile">
      <div class="record-top"><span class="type-tag">${record.type === 'university' ? 'UNIVERSITY' : 'GOVERNMENT SCHOLARSHIP'}</span><button class="priority-star ${work.priority ? 'active' : ''}" data-action="toggle-priority" data-record="${esc(record.id)}" aria-label="${work.priority ? 'Remove from' : 'Add to'} priority list">${work.priority ? '★' : '☆'}</button></div>
      <h3>${esc(record.name)}</h3><div class="record-meta">${esc(record.country)} · ${esc(record.region)}</div>
      <p class="record-desc">${esc(record.description)}</p>
      <div class="record-footer"><span class="date-alert">◷ ${esc(status.label)}</span><strong>OPEN PROFILE ↗</strong></div>
    </article>`;
  }

  function statCard(label, value, note, icon) {
    return `<div class="stat-card"><div class="stat-top"><span>${esc(label.toUpperCase())}</span><span class="stat-icon">${icon}</span></div><div class="stat-value">${esc(value)}</div><div class="stat-note">${esc(note)}</div></div>`;
  }

  function renderOverview() {
    const universities = SEED.records.filter(record => record.type === 'university');
    const scholarships = SEED.records.filter(record => record.type === 'scholarship');
    const priorities = SEED.records.filter(record => getWorkspace(record.id).priority);
    const announced = SEED.records.filter(record => record.dates?.status === 'confirmed').length;
    const upcomingDates = SEED.records.filter(record => record.dates?.status === 'recurring_window').length;
    const featured = [...priorities, ...universities.filter(r => !priorities.some(p => p.id === r.id))].slice(0, 4);
    content.innerHTML = `<section class="hero"><div><div class="eyebrow">GLOBAL UNDERGRADUATE ADMISSIONS · FALL 2028</div><h1>Make your next move<br>with a clear view.</h1><p>A focused research workspace for your 13 university profiles and 5 government scholarship routes. Official source links and intake-specific date status stay visible on every profile.</p></div><div class="hero-actions"><button class="btn primary" data-view="universities">Explore universities</button><button class="btn" data-view="scholarships">Government scholarships</button></div></section>
      <div class="notice"><span class="notice-icon">ⓘ</span><div><strong>Fall 2028 date integrity.</strong> No cycle-specific Fall 2028 / AY 2028–29 deadlines were published on the official sources checked as of ${esc(SEED.asOf)}. Earlier-cycle dates, where available, are shown separately as reference only. The target dates are not guessed.</div></div>
      <div class="stats-grid">${statCard('Universities', universities.length, 'Direct application profiles', '▤')}${statCard('Government scholarships', scholarships.length, 'National scholarship routes', '◇')}${statCard('Priorities', priorities.length, 'Profiles you have starred', '✧')}${statCard('2028 dates confirmed', announced, `${upcomingDates} annual window(s) without 2028 confirmation`, '◷')}</div>
      <div class="section-head"><div><h2>Your focused shortlist</h2><p>Open any profile for official links, 2028 date status and personal notes.</p></div><button class="text-link" data-view="universities">View all universities →</button></div>
      <div class="directory-grid">${featured.length ? featured.map(recordCard).join('') : '<div class="empty-state">No university profiles available.</div>'}</div>
      <div class="section-head"><div><h2>Government scholarship routes</h2><p>Application schedules differ by government programme and intake calendar.</p></div><button class="text-link" data-view="scholarships">View all 5 routes →</button></div>
      <div class="directory-grid">${scholarships.map(recordCard).join('')}</div>
      <p class="footer-note">Official links were checked on ${esc(SEED.asOf)}. Link verification confirms the authority/domain and page destination; it does not independently validate every scholarship eligibility or funding claim in the original user-supplied research.</p>`;
    setBreadcrumb('Overview');
  }

  function setBreadcrumb(label) { $('#breadcrumbCurrent').textContent = label; }

  function renderDirectory(type) {
    const records = SEED.records.filter(record => record.type === type);
    const title = type === 'university' ? 'Universities' : 'Government scholarships';
    const description = type === 'university'
      ? 'Your 13 direct university profiles, with institution-owned admissions and financial-aid links.'
      : 'Your 5 government scholarship routes, with the official administrator and programme links.';
    const filters = ['all', ...new Set(records.map(record => record.country))];
    const visible = records.filter(record => activeFilter === 'all' || record.country === activeFilter)
      .filter(record => !searchTerm || `${record.name} ${record.country} ${record.description}`.toLowerCase().includes(searchTerm));
    content.innerHTML = `<section class="hero"><div><div class="eyebrow">APEX DIRECTORY · ${type === 'university' ? '01' : '02'}</div><h1>${esc(title)}</h1><p>${esc(description)}</p></div><div class="hero-actions"><span class="soft-tag">${records.length} OFFICIAL SOURCE-LINKED PROFILES</span></div></section>
      <div class="notice"><span class="notice-icon">ⓘ</span><div><strong>Target intake: Fall 2028 / AY 2028–29.</strong> Dates are marked unpublished unless an official source explicitly identifies the 2028 intake. Previous-cycle references are not deadlines for your application.</div></div>
      <div class="directory-toolbar"><div class="filter-row">${filters.map(country => `<button class="filter-btn ${activeFilter === country ? 'active' : ''}" data-action="filter-country" data-filter="${esc(country)}">${country === 'all' ? 'All countries' : esc(country)}</button>`).join('')}</div><span class="status-line">Showing ${visible.length} of ${records.length}</span></div>
      <div class="directory-grid">${visible.length ? visible.map(recordCard).join('') : '<div class="empty-state"><h3>No matching profiles</h3><p>Try another country filter or search term.</p></div>'}</div>`;
    setBreadcrumb(title);
  }

  function renderPriorities() {
    const records = SEED.records.filter(record => getWorkspace(record.id).priority);
    content.innerHTML = `<section class="hero"><div><div class="eyebrow">PERSONAL WORKSPACE</div><h1>Priority list</h1><p>Keep the institutions and government routes that matter most to your current strategy close at hand.</p></div></section>
      ${records.length ? `<div class="directory-grid">${records.map(recordCard).join('')}</div>` : '<div class="empty-state"><h3>Your priority list is empty</h3><p>Star a university or scholarship profile to pin it here.</p></div>'}`;
    setBreadcrumb('Priority list');
  }

  function renderProfile(record) {
    const work = getWorkspace(record.id);
    const date = dateStatus(record);
    const tabs = [
      ['overview', 'Overview'], ['dates', '2028 Dates'], ['links', 'Official links'], ['notes', 'My notes']
    ];
    const activeContent = activeTab === 'dates' ? renderDates(record)
      : activeTab === 'links' ? renderOfficialLinks(record)
      : activeTab === 'notes' ? renderNotes(record, work)
      : renderProfileOverview(record, work);
    content.innerHTML = `<div class="profile-header"><div class="profile-title"><div class="profile-symbol">${record.type === 'university' ? 'U' : 'G'}</div><div><div class="eyebrow">${record.type === 'university' ? 'UNIVERSITY PROFILE' : 'GOVERNMENT SCHOLARSHIP PROFILE'}</div><h1>${esc(record.name)}</h1><p>${esc(record.country)} · ${esc(record.region)}</p></div></div><div class="profile-actions"><button class="btn ${work.priority ? 'primary' : ''}" data-action="toggle-priority" data-record="${esc(record.id)}">${work.priority ? '★ Prioritised' : '☆ Add to priorities'}</button><button class="btn" data-view="${record.type === 'university' ? 'universities' : 'scholarships'}">← Back to directory</button></div></div>
      <div class="tag-row"><span class="soft-tag">${record.type === 'university' ? 'UNIVERSITY' : 'GOVERNMENT ROUTE'}</span><span class="soft-tag">${esc(record.country)}</span><span class="soft-tag">${esc(date.label)}</span><span class="verified-stamp">✓ Official links checked ${esc(SEED.asOf)}</span></div>
      <div class="profile-tabs">${tabs.map(([id, label]) => `<button class="profile-tab ${activeTab === id ? 'active' : ''}" data-action="profile-tab" data-tab="${id}">${label}</button>`).join('')}</div>
      ${activeContent}`;
    setBreadcrumb(record.name);
  }

  function renderProfileOverview(record, work) {
    const reference = record.dates?.latestOfficialReference;
    return `<div class="profile-layout"><div class="panel"><h2>Profile overview</h2><p class="summary-copy">${esc(record.description)}</p>
      <div class="date-status"><div class="big-icon">◷</div><div><strong>${esc(dateStatus(record).label)}</strong><p>${esc(record.dates?.message || 'Check the official source for intake-specific updates.')}</p></div></div>
      <h3>Intake and timing notes</h3><p class="summary-copy">${esc(record.dates?.timingNote || 'No additional programme-calendar note has been published in the source record. Check the official admissions page for the relevant entry term.')}</p>
      ${reference ? `<div class="date-reference"><h4>Latest official reference — not a 2028 deadline</h4><div class="cycle">${esc(reference.cycle)}</div><div class="date-list">${reference.items.map(item => `<div class="date-item">${esc(item)}</div>`).join('')}</div><div class="reference-note">${esc(reference.note)}</div><a class="text-link" href="${esc(safeUrl(reference.sourceUrl))}" target="_blank" rel="noopener noreferrer">Open reference page ↗</a></div>` : ''}
      </div><div class="panel"><h2>My application status</h2><p class="panel-subtitle">A personal planning field. This does not change official application status.</p><label class="field-label" for="profileStatus">MY STATUS</label><select class="select" id="profileStatus" data-action="status-change" data-record="${esc(record.id)}">${['Researching','Shortlisted','Applying','Submitted','Admitted','Declined','Not pursuing'].map(status => `<option ${work.status === status ? 'selected' : ''}>${status}</option>`).join('')}</select><div class="small-stat-list" style="margin-top:18px"><div class="small-stat"><span>Country</span><strong>${esc(record.country)}</strong></div><div class="small-stat"><span>Target intake</span><strong>Fall 2028 / AY 2028–29</strong></div><div class="small-stat"><span>Date verification</span><strong>${esc(SEED.asOf)}</strong></div><div class="small-stat"><span>Official links</span><strong>${record.officialLinks.length} links</strong></div></div></div></div>`;
  }

  function renderDates(record) {
    const dates = record.dates || {};
    const reference = dates.latestOfficialReference;
    return `<div class="profile-layout"><div class="panel"><h2>Fall 2028 / AY 2028–29 date status</h2><div class="date-status"><div class="big-icon">ⓘ</div><div><strong>${dates.status === 'confirmed' ? 'Official target-cycle dates published' : dates.status === 'recurring_window' ? 'Official annual window published — 2028 call not confirmed' : 'Not officially announced'}</strong><p>${esc(dates.message || 'No target-cycle date has been published in the official pages checked.')}</p></div></div><p class="summary-copy">As checked on ${esc(SEED.asOf)}. This page deliberately does not convert older dates into guessed 2028 dates.</p>
      ${dates.timingNote ? `<div class="date-reference"><h4>Programme calendar note</h4><p class="summary-copy">${esc(dates.timingNote)}</p></div>` : ''}</div>
      <div class="panel"><h2>Latest official-cycle reference</h2>${reference ? `<p class="panel-subtitle">${esc(reference.cycle)}</p><div class="date-list">${reference.items.map(item => `<div class="date-item">${esc(item)}</div>`).join('')}</div><div class="reference-note"><strong>REFERENCE ONLY.</strong> ${esc(reference.note)} Do not enter these as Fall 2028 / AY 2028–29 deadlines.</div><a class="btn small" href="${esc(safeUrl(reference.sourceUrl))}" target="_blank" rel="noopener noreferrer">Open source page ↗</a>` : `<div class="empty-state"><h3>No dated reference retained</h3><p>The official pages checked did not provide a reliable dated schedule to show here. Use the official links tab.</p></div>`}</div></div>`;
  }

  function renderOfficialLinks(record) {
    return `<div class="panel"><h2>Official sources</h2><p class="panel-subtitle">Links point to the university, government, or scholarship administrator. Each destination was checked on ${esc(SEED.asOf)}; confirm the page again when the 2028 call opens.</p><div class="official-link-list">${record.officialLinks.map(link => {
      const url = safeUrl(link.url);
      let host = '';
      try { host = new URL(url).hostname; } catch { host = 'Invalid link'; }
      return `<a class="official-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer"><span><strong>${esc(link.label)}</strong><small>${esc(host)} · Official source</small></span><span class="out">↗</span></a>`;
    }).join('')}</div><div class="verified-stamp">✓ Official domains checked ${esc(SEED.asOf)}</div></div>`;
  }

  function renderNotes(record, work) {
    return `<div class="panel"><h2>My research notes</h2><p class="panel-subtitle">Your private planning notes for ${esc(record.name)}. Saved locally and synced to your account when signed in.</p><label class="field-label" for="recordNote">NOTES</label><textarea class="textarea" id="recordNote" data-record="${esc(record.id)}" placeholder="Add your own research, questions, decisions or follow-ups…">${esc(work.note)}</textarea><div class="note-actions"><span class="status-line" id="noteSaveStatus">Changes save automatically.</span><button class="btn primary small" data-action="save-note" data-record="${esc(record.id)}">Save notes</button></div></div>`;
  }

  function renderSettings() {
    const prefs = state.preferences;
    content.innerHTML = `<section class="hero"><div><div class="eyebrow">PERSONALISE YOUR WORKSPACE</div><h1>Settings & backup</h1><p>Control appearance and keep an export of your APEX research progress.</p></div></section>
      <div class="settings-grid"><div class="panel"><h2>Appearance</h2>
        <div class="settings-row"><div><strong>Theme</strong><small>Choose how the workspace looks.</small></div><select class="select" style="width:130px" data-pref="theme"><option value="dark" ${prefs.theme==='dark'?'selected':''}>Dark</option><option value="light" ${prefs.theme==='light'?'selected':''}>Light</option><option value="system" ${prefs.theme==='system'?'selected':''}>System</option></select></div>
        <div class="settings-row"><div><strong>Accent colour</strong><small>Change highlight colour.</small></div><select class="select" style="width:130px" data-pref="accent">${Object.keys(accentMap).map(value=>`<option value="${value}" ${prefs.accent===value?'selected':''}>${value[0].toUpperCase()+value.slice(1)}</option>`).join('')}</select></div>
        <div class="settings-row"><div><strong>Layout density</strong><small>Adjust directory card spacing.</small></div><select class="select" style="width:130px" data-pref="density"><option value="comfortable" ${prefs.density==='comfortable'?'selected':''}>Comfortable</option><option value="compact" ${prefs.density==='compact'?'selected':''}>Compact</option></select></div>
        <div class="settings-row"><div><strong>Text size</strong><small>Increase interface text.</small></div><select class="select" style="width:130px" data-pref="fontScale"><option value="normal" ${prefs.fontScale==='normal'?'selected':''}>Normal</option><option value="large" ${prefs.fontScale==='large'?'selected':''}>Large</option></select></div>
        <div class="settings-row"><div><strong>Reduce motion</strong><small>Disable interface transitions.</small></div><input type="checkbox" data-pref="reducedMotion" ${prefs.reducedMotion?'checked':''}></div>
      </div><div class="panel"><h2>Backup & data</h2><p class="panel-subtitle">Your profile notes, application statuses, preferences and priority flags. The 18 official seed profiles are refreshed from the bundled dataset.</p>
        <div class="settings-row"><div><strong>Export JSON backup</strong><small>Download your personal workspace.</small></div><button class="btn small" data-action="export-json">Export JSON</button></div>
        <div class="settings-row"><div><strong>Import JSON backup</strong><small>Restore an APEX workspace export.</small></div><button class="btn small" data-action="import-json">Import JSON</button><input type="file" class="hidden" id="importFile" accept="application/json,.json"></div>
        <div class="settings-row"><div><strong>Export CSV</strong><small>Export the 18 profile list and your personal status.</small></div><button class="btn small" data-action="export-csv">Export CSV</button></div>
        <div class="settings-row"><div><strong>Reset personal workspace</strong><small>Clear personal notes, priorities and statuses.</small></div><button class="btn small" data-action="reset-workspace">Reset</button></div>
      </div></div>
      <div class="panel" style="margin-top:15px"><h2>Research dataset</h2><div class="small-stat-list"><div class="small-stat"><span>Dataset source</span><strong>${esc(SEED.sourceFile)}</strong></div><div class="small-stat"><span>Universities</span><strong>13</strong></div><div class="small-stat"><span>Government scholarship routes</span><strong>5</strong></div><div class="small-stat"><span>Official links checked</span><strong>${SEED.records.reduce((total, record) => total + record.officialLinks.length, 0)}</strong></div><div class="small-stat"><span>Research checked on</span><strong>${esc(SEED.asOf)}</strong></div></div><p class="footer-note">Official-link verification checks the source domain and page destination. It does not certify every claim in the supplied research. Target-cycle dates remain marked unpublished until the authority publishes them.</p></div>`;
    setBreadcrumb('Settings & backup');
  }

  function renderSearchResults(query) {
    const box = $('#searchResults');
    if (!box) return;
    const q = query.trim().toLowerCase();
    if (!q) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    const results = SEED.records.filter(record => `${record.name} ${record.country} ${record.type} ${record.description}`.toLowerCase().includes(q)).slice(0, 8);
    box.innerHTML = results.length ? results.map(record => `<button class="search-result" data-action="open-record" data-record="${esc(record.id)}"><strong>${esc(record.name)}</strong><small>${record.type === 'university' ? 'University' : 'Government scholarship'} · ${esc(record.country)}</small></button>`).join('') : '<div class="search-result"><strong>No matching profiles</strong><small>Try another search term.</small></div>';
    box.classList.remove('hidden');
  }

  function render() {
    applyPreferences();
    $$('.nav-link').forEach(button => button.classList.toggle('active', button.dataset.view === activeView));
    if (activeRecordId) {
      const record = getSeedRecord(activeRecordId);
      if (record) return renderProfile(record);
      activeRecordId = null;
    }
    if (activeView === 'universities') renderDirectory('university');
    else if (activeView === 'scholarships') renderDirectory('scholarship');
    else if (activeView === 'priorities') renderPriorities();
    else if (activeView === 'settings') renderSettings();
    else renderOverview();
  }

  function goView(view) {
    activeView = view;
    activeRecordId = null;
    activeFilter = 'all';
    render();
    $('#sidebar').classList.remove('open');
    $('#searchResults').classList.add('hidden');
    $('#content').focus({ preventScroll: true });
  }

  function openRecord(id) {
    if (!seedIds.has(id)) return;
    activeRecordId = id;
    activeTab = 'overview';
    $('#searchResults').classList.add('hidden');
    $('#sidebar').classList.remove('open');
    render();
    window.scrollTo({ top: 0, behavior: state.preferences.reducedMotion ? 'instant' : 'smooth' });
  }

  function togglePriority(id) {
    const work = getWorkspace(id);
    work.priority = !work.priority;
    persist();
    render();
    toast(work.priority ? 'Added to priority list' : 'Removed from priority list');
  }

  function downloadFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportJson() {
    const payload = {
      app: 'APEX OS', schemaVersion: 2, exportedAt: new Date().toISOString(),
      intake: SEED.intake, workspace: state.workspace, preferences: state.preferences
    };
    downloadFile('APEX_OS_workspace_backup.json', JSON.stringify(payload, null, 2), 'application/json');
    toast('Workspace backup exported');
  }

  function csvCell(value) { return '"' + String(value ?? '').replace(/"/g, '""') + '"'; }
  function exportCsv() {
    const rows = [['Name', 'Type', 'Country', 'Target intake', 'Date status', 'Personal status', 'Priority', 'Official links']];
    for (const record of SEED.records) {
      const work = getWorkspace(record.id);
      rows.push([record.name, record.type, record.country, SEED.intake, dateStatus(record).label, work.status, work.priority ? 'Yes' : 'No', record.officialLinks.map(link => link.url).join(' | ')]);
    }
    downloadFile('APEX_OS_profiles.csv', rows.map(row => row.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
    toast('Profile list exported');
  }

  function importJsonFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || '{}'));
        if (parsed.app !== 'APEX OS' || !parsed.workspace || typeof parsed.workspace !== 'object') throw new Error('This is not a valid APEX OS workspace backup.');
        state.workspace = normaliseWorkspace(parsed.workspace);
        state.preferences = normalisePreferences(parsed.preferences);
        persist();
        render();
        toast('Workspace backup imported');
      } catch (error) { toast(error.message || 'Could not import this backup'); }
    };
    reader.onerror = () => toast('Could not read the selected file');
    reader.readAsText(file);
  }

  function resetWorkspace() {
    if (!window.confirm('Reset all your personal profile notes, priorities and application statuses? This cannot be undone unless you have an export.')) return;
    state.workspace = emptyWorkspace();
    persist();
    render();
    toast('Personal workspace reset');
  }

  function onClick(event) {
    const viewTarget = event.target.closest('[data-view]');
    if (viewTarget) { goView(viewTarget.dataset.view); return; }
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const id = target.dataset.record;
    if (action === 'open-record') openRecord(id);
    else if (action === 'toggle-priority') { event.stopPropagation(); togglePriority(id); }
    else if (action === 'filter-country') { activeFilter = target.dataset.filter; render(); }
    else if (action === 'profile-tab') { activeTab = target.dataset.tab; render(); }
    else if (action === 'save-note') {
      const textArea = $('#recordNote');
      if (textArea && id) {
        getWorkspace(id).note = textArea.value.slice(0, 20000);
        persist();
        const label = $('#noteSaveStatus');
        if (label) label.textContent = 'Saved locally' + (cloudUser ? ' · cloud sync queued' : '');
        toast('Notes saved');
      }
    }
    else if (action === 'export-json') exportJson();
    else if (action === 'export-csv') exportCsv();
    else if (action === 'import-json') $('#importFile').click();
    else if (action === 'reset-workspace') resetWorkspace();
  }

  function onChange(event) {
    const target = event.target;
    if (target.matches('[data-action="status-change"]')) {
      const id = target.dataset.record;
      if (id) { getWorkspace(id).status = target.value; persist(); toast('Application status updated'); }
      return;
    }
    if (target.matches('[data-pref]')) {
      const key = target.dataset.pref;
      state.preferences[key] = target.type === 'checkbox' ? target.checked : target.value;
      state.preferences = normalisePreferences(state.preferences);
      persist(); applyPreferences();
      if (key === 'theme' || key === 'accent' || key === 'density' || key === 'fontScale') render();
      return;
    }
    if (target.id === 'importFile') {
      importJsonFile(target.files?.[0]);
      target.value = '';
    }
  }

  function onInput(event) {
    if (event.target.id === 'globalSearch') {
      searchTerm = event.target.value.trim().toLowerCase();
      renderSearchResults(event.target.value);
      if (activeView === 'universities' || activeView === 'scholarships') renderDirectory(activeView === 'universities' ? 'university' : 'scholarship');
    }
  }

  function onKeydown(event) {
    const card = event.target.closest('.record-card[role="button"]');
    if (card && event.target === card && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      openRecord(card.dataset.record);
    }
    if (event.key === 'Escape') {
      $('#searchResults').classList.add('hidden');
      closeAuth();
      $('#modalBackdrop')?.classList.add('hidden');
    }
  }

  function initEvents() {
    document.addEventListener('click', onClick);
    document.addEventListener('change', onChange);
    document.addEventListener('input', onInput);
    document.addEventListener('keydown', onKeydown);
    $('#menuButton').addEventListener('click', () => $('#sidebar').classList.add('open'));
    $('#closeSidebar').addEventListener('click', () => $('#sidebar').classList.remove('open'));
    $('#authOpen').addEventListener('click', openAuth);
    $('#authClose').addEventListener('click', closeAuth);
    $('#authbox').addEventListener('click', event => { if (event.target.id === 'authbox') closeAuth(); });
    $('#signInButton').addEventListener('click', () => signIn(false));
    $('#signUpButton').addEventListener('click', () => signIn(true));
    $('#signOutButton').addEventListener('click', signOut);
    $('#authPassword').addEventListener('keydown', event => { if (event.key === 'Enter') signIn(false); });
    document.addEventListener('click', event => {
      if (!event.target.closest('.global-search-wrap')) $('#searchResults').classList.add('hidden');
    });
  }

  // Upgrade old local state safely by retaining only profile-level notes, priorities, status and preferences.
  if (previousState) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* keep in-memory state */ }
  }
  initEvents();
  render();
  initCloud();
})();
