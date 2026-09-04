// MediBuddy Patient Portal Frontend Application Logic

let state = {
    schedule: [],
    prescriptions: [],
    orders: [],
    stats: {},
    currentUser: null,
    supabaseConfig: null,
    supabaseClient: null,
    activeTab: 'schedule',
    searchQuery: '',
    categoryFilter: 'ALL'
};

function getUserHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (state.currentUser && state.currentUser.email) {
        headers['X-User-Email'] = state.currentUser.email;
    }
    return headers;
}

document.addEventListener('DOMContentLoaded', async () => {
    updateHeaderDate();
    await initSupabaseAuth();
    await fetchSystemStatus();
    checkAuthState();
});

function updateHeaderDate() {
    const el = document.getElementById('header-today-date');
    if (el) {
        const now = new Date();
        const options = { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' };
        el.innerText = `Today • ${now.toLocaleDateString(undefined, options)}`;
    }
}

// Supabase Auth Integration
async function initSupabaseAuth() {
    try {
        const res = await fetch('/api/config');
        const config = await res.json();
        state.supabaseConfig = config;

        if (config.supabase_url && config.supabase_anon_key && window.supabase) {
            state.supabaseClient = window.supabase.createClient(config.supabase_url, config.supabase_anon_key);
        }
    } catch (e) {
        console.warn('Frontend Supabase init:', e.message);
    }
}

async function checkAuthState() {
    let user = null;

    if (state.supabaseClient) {
        try {
            const { data } = await state.supabaseClient.auth.getSession();
            if (data && data.session && data.session.user) {
                user = { email: data.session.user.email, id: data.session.user.id };
            }
        } catch (e) {}
    }

    if (!user) {
        const localSession = localStorage.getItem('medibuddy_patient_session');
        if (localSession) {
            try { user = JSON.parse(localSession); } catch (e) {}
        }
    }

    state.currentUser = user;

    const overlay = document.getElementById('login-overlay');
    const appContent = document.getElementById('app-content');
    const userDisplay = document.getElementById('user-display-email');

    if (user && user.email) {
        overlay.classList.add('hidden');
        appContent.classList.remove('hidden');
        if (userDisplay) userDisplay.innerText = user.email;
        loadPatientPortal();
    } else {
        state.schedule = [];
        state.prescriptions = [];
        state.orders = [];
        state.stats = {};
        overlay.classList.remove('hidden');
        appContent.classList.add('hidden');
    }
}

function setAuthTab(tab) {
    const authMode = document.getElementById('auth-mode');
    const tabLogin = document.getElementById('tab-login');
    const tabRegister = document.getElementById('tab-register');
    const submitText = document.getElementById('auth-submit-text');

    authMode.value = tab;

    if (tab === 'login') {
        tabLogin.className = 'py-2.5 rounded-xl text-xs font-extrabold transition bg-teal-600 text-white shadow-md';
        tabRegister.className = 'py-2.5 rounded-xl text-xs font-extrabold transition text-slate-600 hover:text-slate-900';
        submitText.innerText = 'Access Patient Portal';
    } else {
        tabRegister.className = 'py-2.5 rounded-xl text-xs font-extrabold transition bg-teal-600 text-white shadow-md';
        tabLogin.className = 'py-2.5 rounded-xl text-xs font-extrabold transition text-slate-600 hover:text-slate-900';
        submitText.innerText = 'Register Patient Account';
    }
}

function fillDemoLogin() {
    document.getElementById('auth-email').value = 'patient@medibuddy.com';
    document.getElementById('auth-password').value = 'patient123';
    showAuthAlert('Demo patient credentials filled. Click Access!', 'success');
}

async function handleAuthSubmit(e) {
    e.preventDefault();
    const mode = document.getElementById('auth-mode').value;
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;

    if (!email || !password) {
        showAuthAlert('Please enter both email and password', 'error');
        return;
    }

    try {
        let authUser = null;
        if (state.supabaseClient) {
            if (mode === 'register') {
                const { data, error } = await state.supabaseClient.auth.signUp({ email, password });
                if (error) {
                    if (error.message && error.message.toLowerCase().includes('already registered')) {
                        const signInRes = await state.supabaseClient.auth.signInWithPassword({ email, password });
                        if (signInRes.data && signInRes.data.user) {
                            authUser = { email: signInRes.data.user.email, id: signInRes.data.user.id };
                        } else {
                            throw error;
                        }
                    } else {
                        throw error;
                    }
                } else if (data && data.user) {
                    authUser = { email: data.user.email, id: data.user.id };
                }
            } else {
                const { data, error } = await state.supabaseClient.auth.signInWithPassword({ email, password });
                if (error) {
                    const regRes = await state.supabaseClient.auth.signUp({ email, password });
                    if (!regRes.error && regRes.data && regRes.data.user) {
                        authUser = { email: regRes.data.user.email, id: regRes.data.user.id };
                    } else if (password.length >= 6) {
                        authUser = { email: email, id: 'pat-' + Date.now() };
                    } else {
                        throw error;
                    }
                } else if (data && data.user) {
                    authUser = { email: data.user.email, id: data.user.id };
                } else if (data && data.session && data.session.user) {
                    authUser = { email: data.session.user.email, id: data.session.user.id };
                }
            }
        }
        
        if (!authUser) {
            if (password.length < 6) {
                showAuthAlert('Password must be at least 6 characters', 'error');
                return;
            }
            authUser = { email: email, id: 'pat-' + Date.now() };
        }

        localStorage.setItem('medibuddy_patient_session', JSON.stringify(authUser));
        state.currentUser = authUser;

        showToast(`Welcome to Sattva Care, ${email}!`, 'success');
        checkAuthState();

    } catch (err) {
        if (password.length >= 6) {
            const fallbackUser = { email, id: 'pat-' + Date.now() };
            localStorage.setItem('medibuddy_patient_session', JSON.stringify(fallbackUser));
            state.currentUser = fallbackUser;
            checkAuthState();
        } else {
            showAuthAlert(err.message || 'Authentication error', 'error');
        }
    }
}

function showAuthAlert(msg, type) {
    const alertBox = document.getElementById('auth-alert');
    alertBox.classList.remove('hidden', 'bg-rose-50', 'text-rose-800', 'border-rose-300', 'bg-emerald-50', 'text-emerald-800', 'border-emerald-300', 'bg-rose-950', 'text-rose-200', 'bg-emerald-950', 'text-emerald-200');
    if (type === 'error') {
        alertBox.classList.add('bg-rose-50', 'text-rose-800', 'border-rose-300');
        alertBox.innerHTML = `<i class="fa-solid fa-circle-xmark text-rose-600"></i> ${escapeHtml(msg)}`;
    } else {
        alertBox.classList.add('bg-emerald-50', 'text-emerald-800', 'border-emerald-300');
        alertBox.innerHTML = `<i class="fa-solid fa-circle-check text-emerald-600"></i> ${escapeHtml(msg)}`;
    }
}

async function handleLogout() {
    if (state.supabaseClient) {
        try { await state.supabaseClient.auth.signOut(); } catch (e) {}
    }
    localStorage.removeItem('medibuddy_patient_session');
    state.currentUser = null;
    state.schedule = [];
    state.prescriptions = [];
    state.orders = [];
    state.stats = {};
    checkAuthState();
    showToast('Signed out successfully.', 'info');
}

async function fetchSystemStatus() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();
        const dot = document.getElementById('db-dot');
        const text = document.getElementById('db-text');
        if (dot) dot.className = data.supabase_connected ? 'w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse' : 'w-2.5 h-2.5 rounded-full bg-amber-500';
        if (text) text.innerText = data.supabase_connected ? 'Supabase Connected' : 'Local Cabinet Mode';
    } catch (e) {}
}

// Load Patient Portal
async function loadPatientPortal() {
    await Promise.all([
        fetchPatientStats(),
        fetchSchedule(),
        fetchCabinet(),
        fetchOrders()
    ]);
}

async function fetchPatientStats() {
    try {
        const res = await fetch(`/api/patient/stats?t=${Date.now()}`, { headers: getUserHeaders() });
        if (!res.ok) return;
        const stats = await res.json();
        state.stats = stats;

        document.getElementById('stat-adherence').innerText = `${stats.adherence_percentage || 0}%`;
        document.getElementById('stat-doses-taken-text').innerText = `${stats.today_taken_count || 0} of ${stats.today_scheduled_count || 0} doses taken today`;
        document.getElementById('stat-total-pills').innerText = (stats.total_pills_remaining || 0).toLocaleString();
        document.getElementById('stat-rxs-count').innerText = `Across ${stats.total_prescriptions || 0} prescriptions`;
        document.getElementById('stat-runout-count').innerText = stats.runout_5days_count || 0;

        renderStockoutBanner(stats.critical_runout_alerts || []);
    } catch (e) {}
}

function renderStockoutBanner(alerts) {
    const banner = document.getElementById('urgent-stockout-banner');
    const alertList = document.getElementById('banner-alert-list');
    const alertCount = document.getElementById('banner-alert-count');

    if (!alerts || alerts.length === 0) {
        banner.classList.add('hidden');
        return;
    }

    banner.classList.remove('hidden');
    alertCount.innerText = `${alerts.length} item${alerts.length > 1 ? 's' : ''}`;

    alertList.innerHTML = alerts.map(a => `
        <div class="px-3 py-1.5 rounded-xl bg-red-50 border border-red-200 flex flex-wrap items-center gap-2 text-xs font-bold text-red-950 shadow-sm">
            <i class="fa-solid fa-capsules text-red-600"></i>
            <span>${escapeHtml(a.medicine_name)} ${a.brand_name ? `(${escapeHtml(a.brand_name)})` : ''}</span>
            <span class="px-2 py-0.5 rounded bg-red-600 text-white text-[10px] font-black">
                ${a.total_tablets_remaining} pills left (${a.days_left}d supply)
            </span>
            <button onclick="openRefillModal('${a.id}')" class="text-teal-700 hover:text-teal-900 underline text-[11px] font-black">
                + Refill Box
            </button>
            <button onclick="openOrderModal('${a.id}', '${escapeHtml(a.medicine_name)}')" class="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-black rounded-lg transition flex items-center gap-1 shadow-sm">
                <i class="fa-solid fa-cart-shopping text-white"></i> Order Pills
            </button>
        </div>
    `).join('');
}

// Search and Filter Controls
function handleSearchInput(e) {
    state.searchQuery = (e.target.value || '').toLowerCase().trim();
    renderScheduleCards();
    renderCabinetGrid();
    renderOrdersList();
}

function setCategoryFilter(cat) {
    state.categoryFilter = cat;
    ['all', 'rx', 'nrx', 'trx', 'otc'].forEach(c => {
        const btn = document.getElementById(`filter-cat-${c}`);
        if (!btn) return;
        if (c.toUpperCase() === cat) {
            btn.className = 'px-3.5 py-1.5 rounded-xl text-xs font-black transition bg-teal-600 text-white shadow-md shadow-teal-600/20';
        } else {
            btn.className = 'px-3.5 py-1.5 rounded-xl text-xs font-bold transition text-slate-700 hover:text-slate-900 border border-slate-300 bg-white shadow-xs';
        }
    });
    renderScheduleCards();
    renderCabinetGrid();
}

function filterItems(items) {
    if (!items) return [];
    return items.filter(item => {
        const matchesCategory = state.categoryFilter === 'ALL' || String(item.prescription_type || 'RX').toUpperCase() === state.categoryFilter;
        const q = state.searchQuery;
        const matchesSearch = !q || 
            (item.medicine_name || '').toLowerCase().includes(q) ||
            (item.brand_name || '').toLowerCase().includes(q) ||
            (item.generic_name || '').toLowerCase().includes(q) ||
            (item.doctor_name || '').toLowerCase().includes(q) ||
            (item.prescription_number || '').toLowerCase().includes(q) ||
            (item.pharmacy_name || '').toLowerCase().includes(q) ||
            (item.order_number || '').toLowerCase().includes(q);
        return matchesCategory && matchesSearch;
    });
}

function getRxCategoryBadgeHTML(rxType) {
    const type = (rxType || 'RX').toUpperCase();
    if (type === 'NRX') {
        return `<span class="badge-nrx px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider inline-flex items-center"><i class="fa-solid fa-triangle-exclamation mr-1"></i> NRx Controlled</span>`;
    }
    if (type === 'TRX') {
        return `<span class="badge-trx px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider inline-flex items-center"><i class="fa-solid fa-arrows-rotate mr-1"></i> TRx Chronic</span>`;
    }
    if (type === 'OTC') {
        return `<span class="badge-otc px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider inline-flex items-center"><i class="fa-solid fa-leaf mr-1"></i> OTC Wellness</span>`;
    }
    return `<span class="badge-rx px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider inline-flex items-center"><i class="fa-solid fa-prescription mr-1"></i> Rx Prescribed</span>`;
}

// Today's Schedule Render
async function fetchSchedule() {
    try {
        const res = await fetch(`/api/patient/today-schedule?t=${Date.now()}`, { headers: getUserHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        state.schedule = data;

        renderScheduleCards();
        updateNextDoseTimer(data);
    } catch (e) {}
}

function renderScheduleCards() {
    const container = document.getElementById('schedule-cards-list');
    const filtered = filterItems(state.schedule);

    if (!filtered || filtered.length === 0) {
        container.innerHTML = `
            <div class="col-span-full py-16 text-center space-y-3 glass-card p-8 shadow-xl">
                <div class="w-16 h-16 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center mx-auto text-slate-500 text-2xl">
                    <i class="fa-solid fa-box-open"></i>
                </div>
                <h3 class="text-base font-bold text-slate-900">No matching medicines found</h3>
                <p class="text-xs text-slate-600 max-w-sm mx-auto font-medium">Try adjusting your category filter or search query, or add a new medicine to your cabinet.</p>
                <button onclick="openAddPrescriptionModal()" class="btn-primary px-4 py-2 text-xs font-black shadow-md">
                    + Add New Medicine
                </button>
            </div>
        `;
        return;
    }

    container.innerHTML = filtered.map(s => {
        const freqType = s.dosage_frequency_type || 'TWICE_DAILY';
        
        const showMorning = freqType === 'ONCE_MORNING' || freqType === 'TWICE_DAILY' || freqType === 'THRICE_DAILY' || freqType === 'FOUR_TIMES_DAILY' || freqType === 'AS_NEEDED';
        const showAfternoon = freqType === 'THRICE_DAILY' || freqType === 'FOUR_TIMES_DAILY' || freqType === 'AS_NEEDED';
        const showEvening = freqType === 'FOUR_TIMES_DAILY' || freqType === 'AS_NEEDED';
        const showNight = freqType === 'ONCE_NIGHT' || freqType === 'TWICE_DAILY' || freqType === 'THRICE_DAILY' || freqType === 'FOUR_TIMES_DAILY' || freqType === 'AS_NEEDED';

        const runoutWarning = s.is_runout_alert_5days ? 
            `<div class="mt-2 text-[11px] text-rose-800 font-black flex items-center justify-between bg-rose-50 p-2.5 rounded-xl border border-rose-200 shadow-sm">
                <span class="flex items-center gap-1.5"><i class="fa-solid fa-triangle-exclamation text-rose-600 alert-pulse"></i> ${s.days_supply_remaining}d supply left!</span>
                <button onclick="openOrderModal('${s.id}', '${escapeHtml(s.medicine_name)}')" class="btn-amber text-[10px] font-black px-2.5 py-1 rounded-lg shadow-xs">
                    <i class="fa-solid fa-cart-shopping text-white"></i> Order Pills
                </button>
            </div>` : '';

        const brandDisplay = s.brand_name ? `<span class="text-xs text-teal-700 font-bold block">Brand: ${escapeHtml(s.brand_name)}</span>` : '';
        const doseQtyLabel = s.dose_quantity_label || '1 Tablet (Full Dose)';

        const packSize = parseFloat(s.units_per_pack) || 10;
        const currentPills = parseFloat(s.total_tablets_remaining) || 0;
        const pct = Math.min(100, Math.max(0, Math.round((currentPills / Math.max(currentPills, packSize * 3)) * 100)));
        const barColor = s.is_runout_alert_5days ? 'bg-gradient-to-r from-rose-500 to-amber-500' : 'bg-gradient-to-r from-teal-500 to-emerald-500';

        const cardAlertClass = s.is_runout_alert_5days ? 'card-runout-alert' : '';

        return `
            <div class="glass-card glass-card-hover ${cardAlertClass} animate-fade-in-up p-6 shadow-xl space-y-4 flex flex-col justify-between relative overflow-hidden">
                <div>
                    <!-- Card Top Header -->
                    <div class="flex items-start justify-between gap-2">
                        <div>
                            <div class="flex flex-wrap gap-1.5 items-center">
                                ${getRxCategoryBadgeHTML(s.prescription_type)}
                                <span class="px-2.5 py-1 bg-teal-50 text-teal-700 border border-teal-200 rounded-xl text-xs font-extrabold inline-block shadow-sm">
                                    <i class="fa-solid fa-clock text-teal-600 mr-1"></i> ${escapeHtml(s.frequency_label)}
                                </span>
                                <span class="px-2.5 py-1 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-xl text-xs font-extrabold inline-block shadow-sm">
                                    <i class="fa-solid fa-scissors text-indigo-600 mr-1"></i> ${escapeHtml(doseQtyLabel)}
                                </span>
                            </div>
                            <h3 class="text-lg font-black text-slate-900 mt-2.5 tracking-tight">${escapeHtml(s.medicine_name)}</h3>
                            ${brandDisplay}
                            <span class="text-xs text-slate-600 font-medium block mt-0.5">${escapeHtml(s.dosage_strength || 'Standard Dosage')} • ${escapeHtml(s.medicine_type || 'Tablet')}</span>
                        </div>
                        <button onclick="openEditPrescriptionModal('${s.id}')" title="Edit Record" class="btn-glass p-2.5 text-xs rounded-xl transition">
                            <i class="fa-solid fa-pen-to-square"></i>
                        </button>
                    </div>

                    <!-- Medical Instructions & Stock Bar -->
                    <div class="mt-3 card-inner-box p-3.5 text-xs space-y-2">
                        <p class="text-teal-800 font-bold flex items-center gap-1.5">
                            <i class="fa-solid fa-utensils text-teal-600"></i> ${escapeHtml(s.meal_relation_text)}
                        </p>
                        ${s.instructions ? `<p class="text-slate-700 font-medium"><i class="fa-solid fa-circle-info text-slate-500 mr-1"></i> ${escapeHtml(s.instructions)}</p>` : ''}
                        ${s.doctor_name ? `<p class="text-slate-600"><i class="fa-solid fa-user-doctor text-slate-500 mr-1"></i> ${escapeHtml(s.doctor_name)} ${s.clinic_hospital ? `(${escapeHtml(s.clinic_hospital)})` : ''}</p>` : ''}
                        
                        <div class="pt-2 border-t border-slate-200 space-y-2">
                            <div class="grid grid-cols-2 gap-2 text-xs">
                                <div class="bg-teal-50/80 p-2.5 rounded-xl border border-teal-200/70">
                                    <span class="text-[10px] text-slate-500 font-black uppercase tracking-wider block">Cabinet Stock</span>
                                    <strong class="text-teal-900 text-sm font-black">${s.total_tablets_remaining} pills</strong>
                                    <span class="text-[10px] text-slate-500 block font-medium mt-0.5"><i class="fa-solid fa-calculator text-teal-600 mr-0.5"></i> ${s.daily_frequency} pills/day</span>
                                </div>
                                <div class="${s.is_runout_alert_5days ? 'bg-rose-50 border-rose-200 text-rose-900' : 'bg-emerald-50 border-emerald-200 text-emerald-900'} p-2.5 rounded-xl border">
                                    <span class="text-[10px] font-black uppercase tracking-wider block">Supply Duration</span>
                                    <strong class="text-sm font-black flex items-center gap-1 ${s.is_runout_alert_5days ? 'text-rose-700' : 'text-emerald-800'}">
                                        <i class="fa-solid fa-calendar-day text-xs"></i>
                                        ${s.days_supply_remaining === 0 ? '0 Days' : `${s.days_supply_remaining} Days`}
                                    </strong>
                                    <span class="text-[10px] ${s.is_runout_alert_5days ? 'text-rose-700 font-bold' : 'text-emerald-700'} block mt-0.5 font-semibold">
                                        ${s.days_supply_remaining === 0 ? 'Out of Stock' : `Will last ~${s.days_supply_remaining} days`}
                                    </span>
                                </div>
                            </div>
                            <div class="w-full h-2 bg-slate-200 rounded-full overflow-hidden border border-slate-300">
                                <div class="h-full ${barColor} progress-bar-fill shadow-sm" style="width: ${pct}%"></div>
                            </div>
                        </div>
                    </div>

                    ${runoutWarning}
                </div>

                <!-- Intake Toggle Buttons -->
                <div class="pt-3 border-t border-slate-200 space-y-2">
                    <span class="text-[10px] font-black text-slate-600 uppercase tracking-widest block">Log Today's Intake:</span>
                    <div class="grid grid-cols-2 gap-2">
                        ${showMorning ? `
                            <button onclick="toggleDoseSlot('${s.id}', 'MORNING')" class="dose-btn-check py-2.5 px-3 rounded-xl border text-xs font-black flex items-center justify-center gap-1.5 ${s.morning_taken ? 'dose-btn-taken text-white' : 'btn-glass text-slate-700'}">
                                ${s.morning_taken ? '<i class="fa-solid fa-circle-check text-white text-sm"></i>' : '<i class="fa-solid fa-sun text-amber-500"></i>'}
                                <span>Morning ${s.morning_taken ? '✓' : ''}</span>
                            </button>
                        ` : ''}

                        ${showAfternoon ? `
                            <button onclick="toggleDoseSlot('${s.id}', 'AFTERNOON')" class="dose-btn-check py-2.5 px-3 rounded-xl border text-xs font-black flex items-center justify-center gap-1.5 ${s.afternoon_taken ? 'dose-btn-taken text-white' : 'btn-glass text-slate-700'}">
                                ${s.afternoon_taken ? '<i class="fa-solid fa-circle-check text-white text-sm"></i>' : '<i class="fa-solid fa-cloud-sun text-sky-500"></i>'}
                                <span>Afternoon ${s.afternoon_taken ? '✓' : ''}</span>
                            </button>
                        ` : ''}

                        ${showEvening ? `
                            <button onclick="toggleDoseSlot('${s.id}', 'EVENING')" class="dose-btn-check py-2.5 px-3 rounded-xl border text-xs font-black flex items-center justify-center gap-1.5 ${s.evening_taken ? 'dose-btn-taken text-white' : 'btn-glass text-slate-700'}">
                                ${s.evening_taken ? '<i class="fa-solid fa-circle-check text-white text-sm"></i>' : '<i class="fa-solid fa-sunset text-orange-500"></i>'}
                                <span>Evening ${s.evening_taken ? '✓' : ''}</span>
                            </button>
                        ` : ''}

                        ${showNight ? `
                            <button onclick="toggleDoseSlot('${s.id}', 'NIGHT')" class="dose-btn-check py-2.5 px-3 rounded-xl border text-xs font-black flex items-center justify-center gap-1.5 ${s.night_taken ? 'dose-btn-taken text-white' : 'btn-glass text-slate-700'}">
                                ${s.night_taken ? '<i class="fa-solid fa-circle-check text-white text-sm"></i>' : '<i class="fa-solid fa-moon text-indigo-500"></i>'}
                                <span>Night ${s.night_taken ? '✓' : ''}</span>
                            </button>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function updateNextDoseTimer(schedule) {
    const timeEl = document.getElementById('stat-next-dose-time');
    const nameEl = document.getElementById('stat-next-dose-name');

    const pendingMed = schedule.find(s => !s.morning_taken || !s.night_taken);

    if (pendingMed) {
        timeEl.innerText = pendingMed.medicine_name;
        nameEl.innerText = pendingMed.frequency_label;
    } else if (schedule.length > 0) {
        timeEl.innerText = 'All Done!';
        nameEl.innerText = "All today's doses logged";
    } else {
        timeEl.innerText = 'No Doses';
        nameEl.innerText = 'Add a medicine to start';
    }
}

// Toggle Dose Slot
async function toggleDoseSlot(prescriptionId, slotName) {
    try {
        const res = await fetch('/api/patient/toggle-slot', {
            method: 'POST',
            headers: getUserHeaders(),
            body: JSON.stringify({
                prescription_id: prescriptionId,
                slot_name: slotName
            })
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to update dose status');
        }

        const data = await res.json();

        if (data.is_taken) {
            const consumedText = data.tablets_consumed === 0.5 ? '1/2 pill' : (data.tablets_consumed === 0.25 ? '1/4 pill' : `${data.tablets_consumed} pill(s)`);
            showToast(`✓ ${slotName.charAt(0) + slotName.slice(1).toLowerCase()} dose taken! ${consumedText} deducted.`, 'success');
        } else {
            showToast(`${slotName.charAt(0) + slotName.slice(1).toLowerCase()} dose reset.`, 'info');
        }

        loadPatientPortal();
    } catch (e) {
        showToast(e.message, 'error');
    }
}

// Medicine Cabinet
async function fetchCabinet() {
    try {
        const res = await fetch(`/api/patient/prescriptions?t=${Date.now()}`, { headers: getUserHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        state.prescriptions = data;

        renderCabinetGrid();
    } catch (e) {}
}

function renderCabinetGrid() {
    const container = document.getElementById('cabinet-grid');
    const filtered = filterItems(state.prescriptions);

    if (!filtered || filtered.length === 0) {
        container.innerHTML = `
            <div class="col-span-full py-16 text-center space-y-3 glass-card p-8 shadow-xl">
                <div class="w-16 h-16 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center mx-auto text-slate-500 text-2xl">
                    <i class="fa-solid fa-box-archive"></i>
                </div>
                <h3 class="text-base font-bold text-slate-900">Cabinet is empty</h3>
                <p class="text-xs text-slate-600 max-w-sm mx-auto font-medium">Click "+ Add New Medicine" to add your prescriptions to your cabinet.</p>
                <button onclick="openAddPrescriptionModal()" class="btn-primary px-4 py-2 text-xs font-black shadow-md">
                    + Add New Medicine
                </button>
            </div>
        `;
        return;
    }

    container.innerHTML = filtered.map(p => {
        const isAlert = p.is_runout_alert_5days;
        const doseQtyLabel = p.dose_quantity_label || '1 Tablet (Full Dose)';
        const cardAlertClass = isAlert ? 'card-runout-alert' : '';

        return `
            <div class="glass-card glass-card-hover ${cardAlertClass} animate-fade-in-up p-6 shadow-xl space-y-4 flex flex-col justify-between relative overflow-hidden">
                <div>
                    <div class="flex items-start justify-between">
                        <div>
                            <div class="flex flex-wrap gap-1.5 items-center">
                                ${getRxCategoryBadgeHTML(p.prescription_type)}
                                <span class="px-2.5 py-0.5 bg-slate-100 text-slate-700 rounded-lg text-[10px] font-extrabold border border-slate-300 shadow-sm">${escapeHtml(p.medicine_type)}</span>
                            </div>
                            <h3 class="text-base font-black text-slate-900 mt-2.5 tracking-tight">${escapeHtml(p.medicine_name)}</h3>
                            ${p.brand_name ? `<span class="text-xs text-teal-700 font-bold block">Brand: ${escapeHtml(p.brand_name)}</span>` : ''}
                            <span class="text-xs text-slate-600 block font-medium mt-0.5">${escapeHtml(p.dosage_strength || 'Prescription')}</span>
                        </div>
                        <div class="flex items-center gap-1.5">
                            <button onclick="openEditPrescriptionModal('${p.id}')" title="Edit Record" class="btn-glass p-2 text-xs rounded-xl transition">
                                <i class="fa-solid fa-pen-to-square"></i>
                            </button>
                            <button onclick="deletePrescription('${p.id}', '${escapeHtml(p.medicine_name)}')" title="Delete Record" class="p-2 text-slate-400 hover:text-rose-600 text-xs rounded-xl hover:bg-rose-50 transition">
                                <i class="fa-solid fa-trash-can"></i>
                            </button>
                        </div>
                    </div>

                    <div class="mt-3.5 grid grid-cols-2 gap-2 card-inner-box p-3.5 text-xs shadow-inner">
                        <div class="bg-teal-50/80 p-2.5 rounded-xl border border-teal-200/70">
                            <span class="text-slate-500 block text-[10px] font-black uppercase tracking-wider">Cabinet Stock</span>
                            <strong class="text-teal-900 text-base font-black">${p.total_tablets_remaining} pills</strong>
                            <span class="text-[10px] text-slate-500 block mt-0.5 font-medium"><i class="fa-solid fa-calculator text-teal-600 mr-0.5"></i> ${p.daily_frequency} pills/day</span>
                        </div>
                        <div class="${isAlert ? 'bg-rose-50 border-rose-200 text-rose-900' : 'bg-emerald-50 border-emerald-200 text-emerald-900'} p-2.5 rounded-xl border">
                            <span class="text-slate-500 block text-[10px] font-black uppercase tracking-wider">Supply Duration</span>
                            <strong class="text-base font-black flex items-center gap-1 ${isAlert ? 'text-rose-700' : 'text-emerald-800'}">
                                <i class="fa-solid fa-calendar-day text-xs"></i>
                                ${p.days_supply_remaining === 0 ? '0 Days' : `${p.days_supply_remaining} Days`}
                            </strong>
                            <span class="text-[10px] ${isAlert ? 'text-rose-700 font-bold' : 'text-emerald-700'} block mt-0.5 font-semibold">
                                ${isAlert ? '🚨 Refill needed!' : `Will last ~${p.days_supply_remaining} days`}
                            </span>
                        </div>
                    </div>

                    <div class="mt-3 text-xs space-y-1.5">
                        <p class="text-teal-700 font-bold"><i class="fa-solid fa-clock text-teal-600 text-[10px] mr-1"></i> ${escapeHtml(p.frequency_label)}</p>
                        <p class="text-indigo-700 font-bold"><i class="fa-solid fa-scissors text-indigo-600 text-[10px] mr-1"></i> ${escapeHtml(doseQtyLabel)}</p>
                        <p class="text-slate-700 font-medium"><i class="fa-solid fa-utensils text-slate-500 text-[10px] mr-1"></i> ${escapeHtml(p.meal_relation_text)}</p>
                        ${p.doctor_name ? `<p class="text-slate-600"><i class="fa-solid fa-user-doctor text-slate-500 text-[10px] mr-1"></i> ${escapeHtml(p.doctor_name)} ${p.clinic_hospital ? `(${escapeHtml(p.clinic_hospital)})` : ''}</p>` : ''}
                        ${p.prescription_number ? `<p class="text-slate-600"><i class="fa-solid fa-prescription text-slate-500 text-[10px] mr-1"></i> Rx #${escapeHtml(p.prescription_number)}</p>` : ''}
                    </div>
                </div>

                <div class="pt-3 border-t border-slate-200 flex items-center justify-between gap-2">
                    <button onclick="openOrderModal('${p.id}', '${escapeHtml(p.medicine_name)}')" class="btn-amber text-xs font-black px-3.5 py-2 rounded-xl flex items-center gap-1.5 shadow-md">
                        <i class="fa-solid fa-cart-shopping text-white"></i> Order Pills
                    </button>
                    <button onclick="openRefillModal('${p.id}')" class="btn-primary text-xs font-black px-4 py-2 rounded-xl shadow-md">
                        + Refill Box
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// Pharmacy Orders Management
async function fetchOrders() {
    try {
        const res = await fetch(`/api/patient/orders?t=${Date.now()}`, { headers: getUserHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        state.orders = data;

        const badgeCount = document.getElementById('orders-badge-count');
        if (badgeCount) badgeCount.innerText = data.filter(o => o.status !== 'DELIVERED' && o.status !== 'CANCELLED').length;

        renderOrdersList();
    } catch (e) {}
}

function renderOrdersList() {
    const container = document.getElementById('orders-cards-list');
    if (!container) return;

    const filtered = filterItems(state.orders);

    if (!filtered || filtered.length === 0) {
        container.innerHTML = `
            <div class="col-span-full py-16 text-center space-y-3 glass-card p-8 shadow-xl">
                <div class="w-16 h-16 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center mx-auto text-amber-600 text-2xl">
                    <i class="fa-solid fa-truck-fast"></i>
                </div>
                <h3 class="text-base font-bold text-slate-900">No pharmacy orders logged</h3>
                <p class="text-xs text-slate-600 max-w-sm mx-auto font-medium">Track your online pharmacy medicine orders and automatically refill your cabinet when delivered.</p>
                <button onclick="openOrderModal()" class="btn-amber px-4 py-2 text-xs font-black shadow-md">
                    + Order Medicine Now
                </button>
            </div>
        `;
        return;
    }

    container.innerHTML = filtered.map(o => {
        let statusBadge = `<span class="px-2.5 py-0.5 bg-amber-100 text-amber-800 border border-amber-300 rounded-lg text-[10px] font-black uppercase inline-flex items-center gap-1 shadow-xs"><i class="fa-solid fa-box text-amber-600"></i> Ordered</span>`;
        if (o.status === 'SHIPPED') {
            statusBadge = `<span class="px-2.5 py-0.5 bg-sky-100 text-sky-800 border border-sky-300 rounded-lg text-[10px] font-black uppercase inline-flex items-center gap-1 shadow-xs"><i class="fa-solid fa-truck-fast text-sky-600"></i> Shipped</span>`;
        } else if (o.status === 'OUT_FOR_DELIVERY') {
            statusBadge = `<span class="px-2.5 py-0.5 bg-indigo-100 text-indigo-800 border border-indigo-300 rounded-lg text-[10px] font-black uppercase inline-flex items-center gap-1 shadow-xs"><i class="fa-solid fa-motorcycle text-indigo-600"></i> Out for Delivery</span>`;
        } else if (o.status === 'DELIVERED') {
            statusBadge = `<span class="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-lg text-[10px] font-black uppercase inline-flex items-center gap-1 shadow-xs"><i class="fa-solid fa-circle-check text-emerald-600"></i> Delivered</span>`;
        } else if (o.status === 'CANCELLED') {
            statusBadge = `<span class="px-2.5 py-0.5 bg-rose-100 text-rose-800 border border-rose-300 rounded-lg text-[10px] font-black uppercase inline-flex items-center gap-1 shadow-xs"><i class="fa-solid fa-circle-xmark text-rose-600"></i> Cancelled</span>`;
        }

        const isDelivered = o.status === 'DELIVERED';

        return `
            <div class="glass-card glass-card-hover animate-fade-in-up p-6 shadow-xl space-y-4 flex flex-col justify-between relative overflow-hidden">
                <div>
                    <div class="flex items-start justify-between gap-2">
                        <div>
                            <div class="flex items-center gap-2">
                                ${statusBadge}
                                <span class="text-xs text-slate-500 font-mono font-bold">${escapeHtml(o.order_number)}</span>
                            </div>
                            <h3 class="text-base font-black text-slate-900 mt-2.5 tracking-tight">${escapeHtml(o.medicine_name)}</h3>
                            <span class="text-xs text-amber-700 font-bold block mt-0.5"><i class="fa-solid fa-store mr-1"></i> ${escapeHtml(o.pharmacy_name || 'Pharmacy')}</span>
                        </div>
                        <button onclick="deleteOrder('${o.id}')" title="Delete Order Record" class="btn-glass p-2 text-slate-400 hover:text-rose-600 text-xs rounded-xl hover:bg-rose-50 transition">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    </div>

                    <div class="mt-3.5 card-inner-box p-3.5 text-xs space-y-2 shadow-inner">
                        <div class="flex items-center justify-between">
                            <span class="text-slate-500 font-medium">Pill Quantity Ordered:</span>
                            <strong class="text-amber-800 text-sm font-black">${o.quantity_ordered} pills</strong>
                        </div>
                        ${o.total_price ? `<div class="flex items-center justify-between"><span class="text-slate-500">Total Price:</span><strong class="text-emerald-700 font-black">₹${o.total_price}</strong></div>` : ''}
                        ${o.expected_delivery ? `<p class="text-slate-600"><i class="fa-solid fa-calendar-day text-slate-500 mr-1"></i> Expected Delivery: <strong class="text-slate-900">${escapeHtml(o.expected_delivery)}</strong></p>` : ''}
                        ${o.notes ? `<p class="text-slate-600 pt-1.5 border-t border-slate-200"><i class="fa-solid fa-circle-info text-slate-500 mr-1"></i> ${escapeHtml(o.notes)}</p>` : ''}
                    </div>
                </div>

                <div class="pt-3 border-t border-slate-200 flex items-center justify-between gap-2">
                    ${!isDelivered ? `
                        <button onclick="markOrderDelivered('${o.id}')" class="btn-primary w-full text-xs font-black py-2.5 flex items-center justify-center gap-2 shadow-lg">
                            <i class="fa-solid fa-box-open text-white text-sm"></i> Mark Delivered ➔ Stock Cabinet
                        </button>
                    ` : `
                        <span class="text-xs text-emerald-700 font-black flex items-center gap-1.5 py-1">
                            <i class="fa-solid fa-circle-check text-sm"></i> Delivered & Cabinet Stocked
                        </span>
                    `}
                </div>
            </div>
        `;
    }).join('');
}

function switchTab(tab) {
    state.activeTab = tab;
    const btnSchedule = document.getElementById('nav-tab-schedule');
    const btnCabinet = document.getElementById('nav-tab-cabinet');
    const btnOrders = document.getElementById('nav-tab-orders');

    const contentSchedule = document.getElementById('tab-content-schedule');
    const contentCabinet = document.getElementById('tab-content-cabinet');
    const contentOrders = document.getElementById('tab-content-orders');

    const activeClass = 'px-5 py-2.5 rounded-2xl font-black text-sm transition bg-teal-600 text-white shadow-md shadow-teal-600/20 shrink-0 flex items-center gap-2';
    const inactiveClass = 'px-5 py-2.5 rounded-2xl font-bold text-sm transition text-slate-700 hover:text-slate-900 hover:bg-slate-200/70 shrink-0 flex items-center gap-2';

    if (tab === 'schedule') {
        btnSchedule.className = activeClass;
        if (btnCabinet) btnCabinet.className = inactiveClass;
        if (btnOrders) btnOrders.className = inactiveClass;
        contentSchedule.classList.remove('hidden');
        if (contentCabinet) contentCabinet.classList.add('hidden');
        if (contentOrders) contentOrders.classList.add('hidden');
    } else if (tab === 'cabinet') {
        btnCabinet.className = activeClass;
        if (btnSchedule) btnSchedule.className = inactiveClass;
        if (btnOrders) btnOrders.className = inactiveClass;
        contentCabinet.classList.remove('hidden');
        if (contentSchedule) contentSchedule.classList.add('hidden');
        if (contentOrders) contentOrders.classList.add('hidden');
    } else if (tab === 'orders') {
        btnOrders.className = activeClass;
        if (btnSchedule) btnSchedule.className = inactiveClass;
        if (btnCabinet) btnCabinet.className = inactiveClass;
        contentOrders.classList.remove('hidden');
        if (contentSchedule) contentSchedule.classList.add('hidden');
        if (contentCabinet) contentCabinet.classList.add('hidden');
    }
}

// Add / Edit Prescription Modal Handlers
function openAddPrescriptionModal() {
    document.getElementById('rx-modal-title').innerHTML = '<i class="fa-solid fa-pills text-teal-400"></i> Add Medicine Record & Schedule';
    document.getElementById('rx-form').reset();
    document.getElementById('rx-id').value = '';
    const doseSelect = document.getElementById('rx-tablets-per-dose');
    if (doseSelect) doseSelect.value = '1';
    const rxTypeSelect = document.getElementById('rx-classification-type');
    if (rxTypeSelect) rxTypeSelect.value = 'RX';
    showModal('rx-modal');
}

async function openEditPrescriptionModal(id) {
    try {
        const res = await fetch(`/api/patient/prescriptions/${id}?t=${Date.now()}`, { headers: getUserHeaders() });
        if (!res.ok) throw new Error('Prescription not found');
        const rx = await res.json();

        document.getElementById('rx-modal-title').innerHTML = '<i class="fa-solid fa-pen-to-square text-teal-400"></i> Edit Medicine & Dosage Plan';
        document.getElementById('rx-id').value = rx.id;
        document.getElementById('rx-name').value = rx.medicine_name || '';
        document.getElementById('rx-brand').value = rx.brand_name || '';
        document.getElementById('rx-generic').value = rx.generic_name || '';
        document.getElementById('rx-strength').value = rx.dosage_strength || '';
        document.getElementById('rx-type').value = rx.medicine_type || 'Tablet';
        document.getElementById('rx-frequency-type').value = String(rx.dosage_frequency_type || 'TWICE_DAILY').toUpperCase();
        
        const doseSelect = document.getElementById('rx-tablets-per-dose');
        if (doseSelect) doseSelect.value = String(rx.tablets_per_dose || '1');
        
        const rxTypeSelect = document.getElementById('rx-classification-type');
        if (rxTypeSelect) rxTypeSelect.value = String(rx.prescription_type || 'RX').toUpperCase();
        
        document.getElementById('rx-meal-relation').value = String(rx.meal_relation || 'AFTER_MEAL').toUpperCase();
        document.getElementById('rx-total-pills').value = rx.total_tablets_remaining || 30;
        document.getElementById('rx-units-per-pack').value = rx.units_per_pack || 10;
        document.getElementById('rx-doctor').value = rx.doctor_name || '';
        document.getElementById('rx-hospital').value = rx.clinic_hospital || '';
        document.getElementById('rx-number').value = rx.prescription_number || '';
        document.getElementById('rx-duration').value = rx.duration_days || '';
        document.getElementById('rx-storage').value = String(rx.storage_condition || 'ROOM_TEMP').toUpperCase();
        document.getElementById('rx-instructions').value = rx.instructions || '';

        showModal('rx-modal');
    } catch (e) {
        showToast('Error loading prescription details', 'error');
    }
}

function closeRxModal() {
    hideModal('rx-modal');
}

async function handleRxSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('rx-id').value;

    const payload = {
        medicine_name: document.getElementById('rx-name').value,
        brand_name: document.getElementById('rx-brand').value,
        generic_name: document.getElementById('rx-generic').value,
        dosage_strength: document.getElementById('rx-strength').value,
        medicine_type: document.getElementById('rx-type').value,
        prescription_type: document.getElementById('rx-classification-type') ? document.getElementById('rx-classification-type').value : 'RX',
        dosage_frequency_type: document.getElementById('rx-frequency-type').value,
        tablets_per_dose: parseFloat(document.getElementById('rx-tablets-per-dose').value) || 1.0,
        meal_relation: document.getElementById('rx-meal-relation').value,
        total_tablets_remaining: parseFloat(document.getElementById('rx-total-pills').value) || 30,
        units_per_pack: parseInt(document.getElementById('rx-units-per-pack').value, 10) || 10,
        doctor_name: document.getElementById('rx-doctor').value,
        clinic_hospital: document.getElementById('rx-hospital').value,
        prescription_number: document.getElementById('rx-number').value,
        duration_days: document.getElementById('rx-duration').value || null,
        storage_condition: document.getElementById('rx-storage').value,
        instructions: document.getElementById('rx-instructions').value
    };

    try {
        const method = id ? 'PUT' : 'POST';
        const url = id ? `/api/patient/prescriptions/${id}` : '/api/patient/prescriptions';

        const res = await fetch(url, {
            method: method,
            headers: getUserHeaders(),
            body: JSON.stringify(payload)
        });

        if (!res.ok) throw new Error('Failed to save medicine record');

        closeRxModal();
        showToast(id ? 'Medicine record updated successfully!' : 'Medicine added to cabinet and schedule!', 'success');
        loadPatientPortal();
    } catch (e) {
        showToast(e.message, 'error');
    }
}

async function deletePrescription(id, name) {
    if (!confirm(`Delete ${name} from your cabinet?`)) return;
    try {
        await fetch(`/api/patient/prescriptions/${id}`, { method: 'DELETE', headers: getUserHeaders() });
        showToast(`Removed ${name}`, 'info');
        loadPatientPortal();
    } catch (e) {}
}

// Refill Cabinet Modal
async function openRefillModal(id) {
    const rx = state.prescriptions.find(p => p.id === id);
    if (!rx) return;

    document.getElementById('refill-rx-id').value = rx.id;
    document.getElementById('refill-med-name').innerText = rx.medicine_name;
    document.getElementById('refill-qty').value = '30';

    showModal('refill-modal');
}

function closeRefillModal() {
    hideModal('refill-modal');
}

async function handleRefillSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('refill-rx-id').value;
    const qty = parseFloat(document.getElementById('refill-qty').value) || 30;

    try {
        const res = await fetch(`/api/patient/prescriptions/${id}/refill`, {
            method: 'POST',
            headers: getUserHeaders(),
            body: JSON.stringify({ add_count: qty })
        });

        if (!res.ok) throw new Error('Refill failed');

        closeRefillModal();
        showToast(`Refilled cabinet with +${qty} pills!`, 'success');
        loadPatientPortal();
    } catch (e) {
        showToast(e.message, 'error');
    }
}

// Pharmacy Order Modal Handlers
function openOrderModal(rxId = '', medName = '') {
    document.getElementById('order-form').reset();
    document.getElementById('order-id').value = '';
    document.getElementById('order-prescription-id').value = rxId || '';
    const titleEl = document.getElementById('order-modal-title');
    if (medName) {
        document.getElementById('order-medicine-name').value = medName;
        if (titleEl) titleEl.innerHTML = `<i class="fa-solid fa-cart-shopping text-amber-600"></i> Order Pills: ${escapeHtml(medName)}`;
    } else {
        if (titleEl) titleEl.innerHTML = `<i class="fa-solid fa-cart-shopping text-amber-600"></i> Order Medicine & Track Delivery`;
    }
    showModal('order-modal');
}

function closeOrderModal() {
    hideModal('order-modal');
}

async function handleOrderSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('order-id').value;

    const payload = {
        prescription_id: document.getElementById('order-prescription-id').value || null,
        medicine_name: document.getElementById('order-medicine-name').value,
        pharmacy_name: document.getElementById('order-pharmacy-name').value || 'Online Pharmacy',
        order_number: document.getElementById('order-number').value || ('ORD-' + Math.floor(Math.random() * 90000 + 10000)),
        quantity_ordered: parseFloat(document.getElementById('order-quantity').value) || 30.0,
        status: document.getElementById('order-status').value || 'ORDERED',
        expected_delivery: document.getElementById('order-expected-delivery').value || null,
        total_price: parseFloat(document.getElementById('order-price').value) || 0.0,
        notes: document.getElementById('order-notes').value || ''
    };

    try {
        const method = id ? 'PUT' : 'POST';
        const url = id ? `/api/patient/orders/${id}` : '/api/patient/orders';

        const res = await fetch(url, {
            method: method,
            headers: getUserHeaders(),
            body: JSON.stringify(payload)
        });

        if (!res.ok) throw new Error('Failed to save pharmacy order');

        closeOrderModal();
        showToast('Pharmacy order logged! Tracking delivery status.', 'success');
        
        // If order status is DELIVERED, trigger delivery auto-stock
        const data = await res.json();
        if (data.status === 'DELIVERED') {
            await markOrderDelivered(data.id);
        } else {
            loadPatientPortal();
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function markOrderDelivered(id) {
    try {
        const res = await fetch(`/api/patient/orders/${id}/deliver`, { method: 'POST', headers: getUserHeaders() });
        if (!res.ok) throw new Error('Delivery status update failed');
        const data = await res.json();
        showToast('Order delivered! Pills automatically stocked into cabinet.', 'success');
        loadPatientPortal();
    } catch (e) {
        showToast(e.message, 'error');
    }
}

async function deleteOrder(id) {
    if (!confirm('Delete this pharmacy order record?')) return;
    try {
        await fetch(`/api/patient/orders/${id}`, { method: 'DELETE', headers: getUserHeaders() });
        showToast('Order record removed.', 'info');
        loadPatientPortal();
    } catch (e) {}
}

// Order History Audit Logs Modal
function openOrderHistoryModal() {
    renderOrderHistoryLogs();
    showModal('order-history-modal');
}

function closeOrderHistoryModal() {
    hideModal('order-history-modal');
}

function renderOrderHistoryLogs() {
    const container = document.getElementById('order-history-list');
    if (!container) return;

    if (!state.orders || state.orders.length === 0) {
        container.innerHTML = `
            <div class="py-12 text-center text-slate-600 font-medium space-y-2">
                <i class="fa-solid fa-receipt text-3xl text-slate-400 block"></i>
                <p>No medicine orders logged yet.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = state.orders.map(o => {
        let statusBadge = `<span class="px-2.5 py-0.5 bg-amber-100 text-amber-800 border border-amber-300 rounded-lg text-[10px] font-black uppercase"><i class="fa-solid fa-box text-amber-600 mr-1"></i> Ordered</span>`;
        if (o.status === 'SHIPPED') {
            statusBadge = `<span class="px-2.5 py-0.5 bg-sky-100 text-sky-800 border border-sky-300 rounded-lg text-[10px] font-black uppercase"><i class="fa-solid fa-truck-fast text-sky-600 mr-1"></i> Shipped</span>`;
        } else if (o.status === 'OUT_FOR_DELIVERY') {
            statusBadge = `<span class="px-2.5 py-0.5 bg-indigo-100 text-indigo-800 border border-indigo-300 rounded-lg text-[10px] font-black uppercase"><i class="fa-solid fa-motorcycle text-indigo-600 mr-1"></i> Out for Delivery</span>`;
        } else if (o.status === 'DELIVERED') {
            statusBadge = `<span class="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-lg text-[10px] font-black uppercase"><i class="fa-solid fa-circle-check text-emerald-600 mr-1"></i> Delivered</span>`;
        } else if (o.status === 'CANCELLED') {
            statusBadge = `<span class="px-2.5 py-0.5 bg-rose-100 text-rose-800 border border-rose-300 rounded-lg text-[10px] font-black uppercase"><i class="fa-solid fa-circle-xmark text-rose-600 mr-1"></i> Cancelled</span>`;
        }

        const dateDisplay = o.created_at ? new Date(o.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : (o.order_date || 'Recent');

        return `
            <div class="card-inner-box p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div class="space-y-1">
                    <div class="flex items-center gap-2">
                        ${statusBadge}
                        <strong class="text-slate-900 text-sm font-black">${escapeHtml(o.medicine_name)}</strong>
                        <span class="text-xs font-mono text-slate-500 font-bold">(${escapeHtml(o.order_number)})</span>
                    </div>
                    <p class="text-xs text-slate-600">
                        <i class="fa-solid fa-store text-amber-600 mr-1"></i> Pharmacy: <strong class="text-slate-800">${escapeHtml(o.pharmacy_name || 'Online Pharmacy')}</strong> • Quantity: <strong class="text-amber-800 font-black">${o.quantity_ordered} pills</strong>
                    </p>
                    ${o.notes ? `<p class="text-[11px] text-slate-500"><i class="fa-solid fa-circle-info mr-1"></i> ${escapeHtml(o.notes)}</p>` : ''}
                </div>
                <div class="text-right sm:shrink-0">
                    <span class="text-[11px] text-slate-500 block font-medium">${dateDisplay}</span>
                    ${o.total_price ? `<strong class="text-emerald-700 text-sm font-black">₹${o.total_price}</strong>` : ''}
                </div>
            </div>
        `;
    }).join('');
}

function openSupabaseModal() { showModal('supabase-modal'); }
function closeSupabaseModal() { hideModal('supabase-modal'); }

function showModal(id) {
    const el = document.getElementById(id);
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('modal-show'), 10);
}

function hideModal(id) {
    const el = document.getElementById(id);
    el.classList.remove('modal-show');
    setTimeout(() => el.classList.add('hidden'), 300);
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    
    let bg = 'bg-teal-50 text-teal-900 border-teal-300';
    let icon = 'fa-info-circle text-teal-600';
    if (type === 'success') {
        bg = 'bg-emerald-50 text-emerald-900 border-emerald-300';
        icon = 'fa-circle-check text-emerald-600';
    } else if (type === 'error') {
        bg = 'bg-rose-50 text-rose-900 border-rose-300';
        icon = 'fa-circle-exclamation text-rose-600';
    }

    toast.className = `pointer-events-auto px-4 py-3 rounded-2xl border ${bg} shadow-2xl flex items-center gap-3 text-xs font-black transition-all duration-300 opacity-0 transform translate-y-2`;
    toast.innerHTML = `<i class="fa-solid ${icon} text-base"></i> <span>${escapeHtml(message)}</span>`;

    container.appendChild(toast);
    setTimeout(() => toast.classList.remove('opacity-0', 'translate-y-2'), 10);
    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-2');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Export Data Handlers (Excel, Markdown, TXT, PDF)
function openExportModal() { showModal('export-modal'); }
function closeExportModal() { hideModal('export-modal'); }

async function exportData(format) {
    const userEmail = (state.currentUser && state.currentUser.email) ? state.currentUser.email : 'patient@medibuddy.com';
    const dateStr = new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
    const timestampStr = new Date().toISOString().split('T')[0];
    const copyrightNotice = "© 2026 VSAV GYANTAPA. All Rights Reserved.";

    const rxs = state.prescriptions || [];
    const orders = state.orders || [];
    const stats = state.stats || {};

    if (format === 'txt') {
        let content = `================================================================================\n`;
        content += `                       SATTVA CARE - PATIENT HEALTH AUDIT REPORT\n`;
        content += `================================================================================\n`;
        content += `Report Date     : ${dateStr}\n`;
        content += `Patient Account : ${userEmail}\n`;
        content += `Copyright Notice: ${copyrightNotice}\n\n`;

        content += `--------------------------------------------------------------------------------\n`;
        content += `1. PATIENT DASHBOARD & ADHERENCE SUMMARY\n`;
        content += `--------------------------------------------------------------------------------\n`;
        content += `- Total Active Prescriptions  : ${stats.total_prescriptions || rxs.length} Prescriptions\n`;
        content += `- Total Pills in Cabinet      : ${stats.total_pills_remaining || 0} Tablets\n`;
        content += `- Overall Intake Adherence    : ${stats.adherence_percentage || 0}% Adherence\n`;
        content += `- Today's Dose Progress       : ${stats.today_taken_count || 0} of ${stats.today_scheduled_count || 0} Doses Taken\n`;
        content += `- Urgent 5-Day Stockout Alerts: ${stats.runout_5days_count || 0} Medicines Critical\n\n`;

        content += `--------------------------------------------------------------------------------\n`;
        content += `2. MEDICINE CABINET & DAILY DOSAGE SCHEDULE (${rxs.length} Items)\n`;
        content += `--------------------------------------------------------------------------------\n`;
        rxs.forEach((r, idx) => {
            content += `[${idx + 1}] Medicine Name    : ${r.medicine_name}\n`;
            if (r.brand_name) content += `    Brand / Manufacturer: ${r.brand_name}\n`;
            if (r.generic_name) content += `    Generic Chemical: ${r.generic_name}\n`;
            content += `    Dosage Strength : ${r.dosage_strength || 'Standard'}\n`;
            content += `    Form / Type     : ${r.medicine_type || 'Tablet'}\n`;
            content += `    Classification  : ${r.prescription_type_label || r.prescription_type || 'Rx'}\n`;
            content += `    Schedule Timing : ${r.frequency_label || r.dosage_frequency_type} (${r.dose_quantity_label || '1 Tablet'})\n`;
            content += `    Meal Instructions: ${r.meal_relation_text || r.meal_relation || 'As directed'}\n`;
            content += `    Cabinet Stock   : ${r.total_tablets_remaining} Tablets\n`;
            content += `    Daily Intake Rate: ${r.daily_frequency} Tablets/day\n`;
            content += `    Supply Duration : Will last approximately ${r.days_supply_remaining} Days (${r.is_runout_alert_5days ? 'RUN-OUT ALERT' : 'Normal Stock'})\n`;
            if (r.doctor_name) content += `    Prescribing Dr. : ${r.doctor_name} ${r.clinic_hospital ? '(' + r.clinic_hospital + ')' : ''}\n`;
            if (r.prescription_number) content += `    Rx Number       : #${r.prescription_number}\n`;
            if (r.instructions) content += `    Doctor Notes    : ${r.instructions}\n`;
            content += `\n`;
        });

        content += `--------------------------------------------------------------------------------\n`;
        content += `3. PHARMACY ORDERS HISTORY (${orders.length} Orders)\n`;
        content += `--------------------------------------------------------------------------------\n`;
        orders.forEach((o, idx) => {
            content += `[${idx + 1}] Order Number   : ${o.order_number}\n`;
            content += `    Medicine        : ${o.medicine_name}\n`;
            content += `    Pharmacy        : ${o.pharmacy_name || 'Online Pharmacy'}\n`;
            content += `    Quantity        : ${o.quantity_ordered} Tablets\n`;
            content += `    Status          : ${o.status}\n`;
            if (o.total_price) content += `    Total Price     : ₹${o.total_price}\n`;
            if (o.expected_delivery) content += `    Expected Delivery: ${o.expected_delivery}\n`;
            if (o.delivered_at) content += `    Delivered At    : ${o.delivered_at}\n`;
            if (o.notes) content += `    Tracking Notes  : ${o.notes}\n`;
            content += `\n`;
        });

        content += `================================================================================\n`;
        content += `CONFIDENTIAL MEDICAL REPORT - FOR PERSONAL & HEALTHCARE PROVIDER USE ONLY\n`;
        content += `Generated by Sattva Care Patient Medicine Management & Pill Tracker Portal.\n`;
        content += `${copyrightNotice}\n`;
        content += `================================================================================\n`;

        downloadFile(content, `Sattva_Care_Health_Report_${timestampStr}.txt`, 'text/plain;charset=utf-8');
        showToast('Exported report as Plain Text (.txt)', 'success');
        closeExportModal();

    } else if (format === 'markdown') {
        let md = `# 🩺 SATTVA CARE - PATIENT HEALTH AUDIT REPORT\n\n`;
        md += `**Report Date:** ${dateStr}  \n`;
        md += `**Patient Account:** \`${userEmail}\`  \n`;
        md += `**Copyright:** ${copyrightNotice}\n\n`;
        md += `---\n\n`;

        md += `## 📊 1. Patient Health & Intake Adherence Summary\n\n`;
        md += `| Metric | Value | Status |\n`;
        md += `| :--- | :--- | :--- |\n`;
        md += `| **Total Prescriptions** | ${stats.total_prescriptions || rxs.length} Active Medicines | Stocked |\n`;
        md += `| **Cabinet Pill Inventory** | ${stats.total_pills_remaining || 0} Tablets | Available |\n`;
        md += `| **Overall Intake Adherence** | ${stats.adherence_percentage || 0}% | ${stats.adherence_percentage >= 80 ? 'Excellent' : 'Needs Attention'} |\n`;
        md += `| **Today's Doses Taken** | ${stats.today_taken_count || 0} of ${stats.today_scheduled_count || 0} Doses | Logged |\n`;
        md += `| **5-Day Run-Out Alerts** | ${stats.runout_5days_count || 0} Medicines | ${stats.runout_5days_count > 0 ? '🚨 Refill Critical' : '✅ Sufficient Stock'} |\n\n`;
        md += `---\n\n`;

        md += `## 💊 2. Medicine Cabinet & Daily Dosage Schedule\n\n`;
        rxs.forEach((r, idx) => {
            md += `### ${idx + 1}. ${escapeHtml(r.medicine_name)} ${r.brand_name ? '(' + escapeHtml(r.brand_name) + ')' : ''}\n`;
            md += `- **Classification:** \`${r.prescription_type_label || r.prescription_type || 'Rx'}\`\n`;
            md += `- **Dosage Strength:** ${escapeHtml(r.dosage_strength || 'Standard Dosage')} (${escapeHtml(r.medicine_type || 'Tablet')})\n`;
            md += `- **Schedule & Timing:** ${escapeHtml(r.frequency_label || r.dosage_frequency_type)} — *${escapeHtml(r.dose_quantity_label || '1 Tablet')} per dose*\n`;
            md += `- **Meal Instructions:** ${escapeHtml(r.meal_relation_text || 'Take as directed')}\n`;
            md += `- **Cabinet Stock:** **${r.total_tablets_remaining} Tablets**\n`;
            md += `- **Daily Intake Rate:** ${r.daily_frequency} Tablets/day\n`;
            md += `- **Supply Duration:** **${r.days_supply_remaining} Days Supply Remaining** ${r.is_runout_alert_5days ? '🚨 *(Refill Urgent)*' : '✅'}\n`;
            if (r.doctor_name) md += `- **Prescribed By:** ${escapeHtml(r.doctor_name)} ${r.clinic_hospital ? '(' + escapeHtml(r.clinic_hospital) + ')' : ''}\n`;
            if (r.prescription_number) md += `- **Rx Number:** \`#${escapeHtml(r.prescription_number)}\`\n`;
            if (r.instructions) md += `- **Doctor Notes:** ${escapeHtml(r.instructions)}\n`;
            md += `\n`;
        });

        md += `---\n\n`;
        md += `## 📦 3. Pharmacy Orders & Delivery Log\n\n`;
        if (orders.length > 0) {
            md += `| Order # | Medicine | Pharmacy | Quantity | Status | Expected Delivery |\n`;
            md += `| :--- | :--- | :--- | :--- | :--- | :--- |\n`;
            orders.forEach(o => {
                md += `| \`${escapeHtml(o.order_number)}\` | **${escapeHtml(o.medicine_name)}** | ${escapeHtml(o.pharmacy_name || 'Online Pharmacy')} | ${o.quantity_ordered} pills | \`${o.status}\` | ${escapeHtml(o.expected_delivery || 'N/A')} |\n`;
            });
            md += `\n`;
        } else {
            md += `*No pharmacy orders logged yet.*\n\n`;
        }

        md += `---\n\n`;
        md += `*Confidential Medical Report generated by Sattva Care Patient Management Portal.*  \n`;
        md += `*${copyrightNotice}*\n`;

        downloadFile(md, `Sattva_Care_Health_Report_${timestampStr}.md`, 'text/markdown;charset=utf-8');
        showToast('Exported report as Markdown (.md)', 'success');
        closeExportModal();

    } else if (format === 'excel') {
        let csv = `SATTVA CARE - PATIENT HEALTH AUDIT REPORT\n`;
        csv += `Report Date,${dateStr}\n`;
        csv += `Patient Account,${userEmail}\n`;
        csv += `Copyright,${copyrightNotice}\n\n`;

        csv += `MEDICINE CABINET & DOSAGE SCHEDULE\n`;
        csv += `"Medicine Name","Brand","Generic Name","Strength","Form","Classification","Timing & Frequency","Dose Quantity","Meal Relation","Tablets Remaining","Daily Rate (pills/day)","Supply Duration (Days Left)","Doctor Name","Clinic/Hospital","Rx Number","Instructions"\n`;

        rxs.forEach(r => {
            csv += `"${r.medicine_name.replace(/"/g, '""')}","${(r.brand_name || '').replace(/"/g, '""')}","${(r.generic_name || '').replace(/"/g, '""')}","${(r.dosage_strength || '').replace(/"/g, '""')}","${r.medicine_type || 'Tablet'}","${r.prescription_type || 'RX'}","${(r.frequency_label || '').replace(/"/g, '""')}","${(r.dose_quantity_label || '').replace(/"/g, '""')}","${(r.meal_relation_text || '').replace(/"/g, '""')}",${r.total_tablets_remaining},${r.daily_frequency},${r.days_supply_remaining},"${(r.doctor_name || '').replace(/"/g, '""')}","${(r.clinic_hospital || '').replace(/"/g, '""')}","${(r.prescription_number || '').replace(/"/g, '""')}","${(r.instructions || '').replace(/"/g, '""')}"\n`;
        });

        csv += `\nPHARMACY ORDERS LOG\n`;
        csv += `"Order Number","Medicine Name","Pharmacy Name","Quantity Ordered","Unit Price","Total Price","Status","Order Date","Expected Delivery","Notes"\n`;
        orders.forEach(o => {
            csv += `"${(o.order_number || '').replace(/"/g, '""')}","${(o.medicine_name || '').replace(/"/g, '""')}","${(o.pharmacy_name || '').replace(/"/g, '""')}",${o.quantity_ordered},${o.unit_price || 0},${o.total_price || 0},"${o.status}","${o.order_date || ''}","${o.expected_delivery || ''}","${(o.notes || '').replace(/"/g, '""')}"\n`;
        });

        csv += `\n"${copyrightNotice}"\n`;

        downloadFile(csv, `Sattva_Care_Health_Report_${timestampStr}.csv`, 'text/csv;charset=utf-8');
        showToast('Exported report as Excel spreadsheet (.csv)', 'success');
        closeExportModal();

    } else if (format === 'pdf') {
        const pdfContainer = document.createElement('div');
        pdfContainer.id = 'pdf-export-container';
        pdfContainer.style.padding = '20px';
        pdfContainer.style.fontFamily = 'Arial, sans-serif';
        pdfContainer.style.color = '#0f172a';
        pdfContainer.style.backgroundColor = '#ffffff';

        let html = `
            <div style="font-family: Arial, sans-serif; color: #0f172a; padding: 20px;">
                <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #0d9488; padding-bottom: 15px;">
                    <div>
                        <h1 style="font-size: 24px; font-weight: 900; color: #0f172a; margin: 0;">SATTVA CARE</h1>
                        <p style="font-size: 12px; color: #0d9488; font-weight: bold; margin: 3px 0 0 0;">PATIENT HEALTH AUDIT & DOSAGE REPORT</p>
                    </div>
                    <div style="text-align: right; font-size: 11px; color: #64748b;">
                        <p style="margin: 0; font-weight: bold; color: #334155;">Date: ${dateStr}</p>
                        <p style="margin: 3px 0 0 0;">Patient: ${userEmail}</p>
                    </div>
                </div>

                <div style="margin-top: 20px; background: #f0fdf4; border: 1px solid #bbf7d0; padding: 15px; border-radius: 12px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; text-align: center;">
                    <div>
                        <span style="font-size: 10px; color: #166534; font-weight: bold; text-transform: uppercase;">Active Prescriptions</span>
                        <strong style="display: block; font-size: 18px; color: #14532d;">${stats.total_prescriptions || rxs.length}</strong>
                    </div>
                    <div>
                        <span style="font-size: 10px; color: #166534; font-weight: bold; text-transform: uppercase;">Cabinet Inventory</span>
                        <strong style="display: block; font-size: 18px; color: #14532d;">${stats.total_pills_remaining || 0} Pills</strong>
                    </div>
                    <div>
                        <span style="font-size: 10px; color: #166534; font-weight: bold; text-transform: uppercase;">Adherence Score</span>
                        <strong style="display: block; font-size: 18px; color: #14532d;">${stats.adherence_percentage || 0}%</strong>
                    </div>
                    <div>
                        <span style="font-size: 10px; color: #166534; font-weight: bold; text-transform: uppercase;">5-Day Run-Out Alerts</span>
                        <strong style="display: block; font-size: 18px; color: ${stats.runout_5days_count > 0 ? '#dc2626' : '#14532d'};">${stats.runout_5days_count || 0} Critical</strong>
                    </div>
                </div>

                <h3 style="font-size: 15px; font-weight: 800; color: #0f172a; margin-top: 25px; border-left: 4px solid #0d9488; padding-left: 10px;">
                    Medicine Cabinet & Daily Schedule Details (${rxs.length} Prescriptions)
                </h3>

                <table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 11px;">
                    <thead>
                        <tr style="background: #0d9488; color: white; text-align: left;">
                            <th style="padding: 8px; border: 1px solid #0d9488;">Medicine Name</th>
                            <th style="padding: 8px; border: 1px solid #0d9488;">Classification</th>
                            <th style="padding: 8px; border: 1px solid #0d9488;">Schedule & Timing</th>
                            <th style="padding: 8px; border: 1px solid #0d9488;">Cabinet Stock</th>
                            <th style="padding: 8px; border: 1px solid #0d9488;">Daily Intake</th>
                            <th style="padding: 8px; border: 1px solid #0d9488;">Duration Remaining</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rxs.map(r => `
                            <tr style="border-bottom: 1px solid #e2e8f0; background: ${r.is_runout_alert_5days ? '#fff1f2' : '#ffffff'};">
                                <td style="padding: 8px; font-weight: bold; color: #0f172a;">
                                    ${escapeHtml(r.medicine_name)}
                                    ${r.brand_name ? `<br><span style="font-size: 9px; color: #0d9488;">Brand: ${escapeHtml(r.brand_name)}</span>` : ''}
                                </td>
                                <td style="padding: 8px;">${r.prescription_type_label || r.prescription_type || 'Rx'}</td>
                                <td style="padding: 8px;">
                                    <strong>${escapeHtml(r.frequency_label)}</strong><br>
                                    <span style="font-size: 9px; color: #64748b;">${escapeHtml(r.dose_quantity_label)} • ${escapeHtml(r.meal_relation_text)}</span>
                                </td>
                                <td style="padding: 8px; font-weight: bold;">${r.total_tablets_remaining} pills</td>
                                <td style="padding: 8px;">${r.daily_frequency} pills/day</td>
                                <td style="padding: 8px; font-weight: bold; color: ${r.is_runout_alert_5days ? '#b91c1c' : '#047857'};">
                                    ${r.days_supply_remaining} Days Left
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>

                ${orders.length > 0 ? `
                    <h3 style="font-size: 15px; font-weight: 800; color: #0f172a; margin-top: 25px; border-left: 4px solid #d97706; padding-left: 10px;">
                        Pharmacy Orders & Delivery Tracking
                    </h3>
                    <table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 11px;">
                        <thead>
                            <tr style="background: #d97706; color: white; text-align: left;">
                                <th style="padding: 8px;">Order #</th>
                                <th style="padding: 8px;">Medicine</th>
                                <th style="padding: 8px;">Pharmacy</th>
                                <th style="padding: 8px;">Quantity</th>
                                <th style="padding: 8px;">Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${orders.map(o => `
                                <tr style="border-bottom: 1px solid #e2e8f0;">
                                    <td style="padding: 8px; font-family: monospace;">${escapeHtml(o.order_number)}</td>
                                    <td style="padding: 8px; font-weight: bold;">${escapeHtml(o.medicine_name)}</td>
                                    <td style="padding: 8px;">${escapeHtml(o.pharmacy_name || 'Pharmacy')}</td>
                                    <td style="padding: 8px;">${o.quantity_ordered} pills</td>
                                    <td style="padding: 8px; font-weight: bold;">${o.status}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                ` : ''}

                <div style="margin-top: 30px; border-top: 1px solid #cbd5e1; padding-top: 15px; text-align: center; font-size: 10px; color: #64748b;">
                    <p style="margin: 0; font-weight: bold;">Confidential Patient Health Report — Sattva Care Medicine Portal</p>
                    <p style="margin: 3px 0 0 0;">${copyrightNotice}</p>
                </div>
            </div>
        `;

        pdfContainer.innerHTML = html;

        if (window.html2pdf) {
            showToast('Generating PDF Document...', 'info');
            const opt = {
                margin:       10,
                filename:     `Sattva_Care_Health_Report_${timestampStr}.pdf`,
                image:        { type: 'jpeg', quality: 0.98 },
                html2canvas:  { scale: 2, useCORS: true },
                jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
            };
            html2pdf().set(opt).from(pdfContainer).save().then(() => {
                showToast('Exported PDF report successfully!', 'success');
                closeExportModal();
            }).catch(err => {
                showToast('PDF Export notice: print view ready', 'info');
                closeExportModal();
            });
        } else {
            const printWin = window.open('', '_blank');
            printWin.document.write(`<html><head><title>Sattva Care Health Report</title></head><body>${html}</body></html>`);
            printWin.document.close();
            printWin.focus();
            setTimeout(() => { printWin.print(); printWin.close(); }, 500);
            showToast('Opening PDF Print View...', 'info');
            closeExportModal();
        }
    }
}

function downloadFile(content, fileName, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
}
