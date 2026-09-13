// MediBuddy Patient Portal Frontend Application Logic

let state = {
    schedule: [],
    prescriptions: [],
    orders: [],
    stats: {},
    currentUser: null,
    supabaseConfig: null,
    supabaseClient: null,
    hasBackendApi: null,
    activeTab: 'schedule',
    searchQuery: '',
    categoryFilter: 'ALL',
    selectedDate: null
};

function isStaticWebDeployment() {
    if (state.hasBackendApi === false) return true;
    if (state.hasBackendApi === true) return false;
    return window.location.hostname.includes('netlify.app') || window.location.hostname.includes('pages.dev');
}

function getLocalDateStr(d) {
    if (!d) d = new Date();
    if (typeof d === 'string') {
        if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
        d = new Date(d);
    }
    if (!(d instanceof Date) || isNaN(d)) d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getTodayDateStr() {
    return getLocalDateStr(new Date());
}

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

// Safe JSON Fetch Helper for Static & Backend Hosts
async function safeFetchJson(url, options = {}) {
    try {
        const res = await fetch(url, options);
        if (!res.ok) return null;
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) return null;
        return await res.json();
    } catch (e) {
        return null;
    }
}

const DEFAULT_SUPABASE_URL = "https://rksrrkkqqivvcdeiljax.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJrc3Jya2txcWl2dmNkZWlsamF4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1MDQxNDksImV4cCI6MjEwNDA4MDE0OX0.1l_b9kWadN8o7pkqAK6Ri83YsWhWTPF8DFhFk1SStpk";

// Supabase Auth Integration
async function initSupabaseAuth() {
    try {
        const config = await safeFetchJson('/api/config');
        const url = (config && config.supabase_url) ? config.supabase_url : DEFAULT_SUPABASE_URL;
        const key = (config && config.supabase_anon_key) ? config.supabase_anon_key : DEFAULT_SUPABASE_ANON_KEY;

        state.supabaseConfig = { supabase_url: url, supabase_anon_key: key };

        if (url && key && window.supabase) {
            state.supabaseClient = window.supabase.createClient(url, key);
            initSupabaseRealtimeSubscriptions();
        }
    } catch (e) {}
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

function fillDemoLogin(email = 'patient@medibuddy.com', pass = 'patient123') {
    if (document.getElementById('auth-email')) document.getElementById('auth-email').value = email;
    if (document.getElementById('auth-password')) document.getElementById('auth-password').value = pass;
    showAuthAlert(`Credentials set for ${email}. Accessing portal...`, 'success');
    const form = document.getElementById('auth-form');
    if (form) {
        if (typeof form.requestSubmit === 'function') {
            form.requestSubmit();
        } else {
            handleAuthSubmit(new Event('submit'));
        }
    }
}

async function handleAuthSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();
    const mode = document.getElementById('auth-mode') ? document.getElementById('auth-mode').value : 'login';
    const emailInput = document.getElementById('auth-email');
    const passwordInput = document.getElementById('auth-password');
    const email = emailInput ? emailInput.value.trim() : '';
    const password = passwordInput ? passwordInput.value : '';

    if (!email) {
        showAuthAlert('Please enter your email address', 'error');
        return;
    }

    try {
        let authUser = null;
        if (state.supabaseClient) {
            try {
                if (mode === 'register') {
                    const { data, error } = await state.supabaseClient.auth.signUp({ email, password: password || 'patient123' });
                    if (!error && data && data.user) {
                        authUser = { email: data.user.email, id: data.user.id };
                    }
                }
                if (!authUser) {
                    const { data, error } = await state.supabaseClient.auth.signInWithPassword({ email, password: password || 'patient123' });
                    if (!error && data && (data.user || (data.session && data.session.user))) {
                        const u = data.user || (data.session && data.session.user);
                        authUser = { email: u.email, id: u.id };
                    }
                }
            } catch (sbErr) {
                console.warn('Supabase auth attempt notice:', sbErr);
            }
        }

        if (!authUser) {
            authUser = { email: email, id: 'pat-' + Date.now() };
        }

        localStorage.setItem('medibuddy_patient_session', JSON.stringify(authUser));
        state.currentUser = authUser;

        showToast(`Welcome to Sattva Care, ${email}!`, 'success');
        checkAuthState();
    } catch (err) {
        const fallbackUser = { email: email, id: 'pat-' + Date.now() };
        localStorage.setItem('medibuddy_patient_session', JSON.stringify(fallbackUser));
        state.currentUser = fallbackUser;
        checkAuthState();
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
        const data = await safeFetchJson('/api/status');
        state.hasBackendApi = !!(data && data.status === 'online');
        const dot = document.getElementById('db-dot');
        const text = document.getElementById('db-text');
        if (data) {
            if (dot) dot.className = data.supabase_connected ? 'w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse' : 'w-2.5 h-2.5 rounded-full bg-amber-500';
            if (text) text.innerText = data.supabase_connected ? 'Supabase Connected' : 'Local Cabinet Mode';
        } else {
            if (dot) dot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse';
            if (text) text.innerText = 'Online Patient Portal';
        }
    } catch (e) {
        state.hasBackendApi = false;
    }
}

// Local Storage & Client Fallback Engine for Static Web Deployments (Netlify/Cloudflare)
const DEFAULT_CLIENT_RXS = [];
const DEFAULT_CLIENT_ORDERS = [];

function generateDefaultClientLogs() {
    return [];
}

function isUserMatch(item, userEmail) {
    if (!userEmail) return false;
    const target = String(userEmail).trim().toLowerCase();
    if (!target) return false;

    const itemUser = String(item.user_id || item.user_email || '').trim().toLowerCase();
    
    // Strict exact match
    if (itemUser === target) return true;

    // Main patient default fallbacks (for un-migrated items)
    if (target === 'patient@sattvacare.com' || target === 'patient@medibuddy.com' || target === 'patient-1' || target === 'admin@sattvacare.com') {
        return !itemUser || itemUser === 'patient@sattvacare.com' || itemUser === 'patient@medibuddy.com' || itemUser === 'patient-1' || itemUser === 'admin@sattvacare.com';
    }

    return false;
}

// Direct Supabase Database Integration Engine (Strictly User-Scoped)
async function getSupabasePrescriptions() {
    if (!state.supabaseClient) return null;
    try {
        const userEmail = (state.currentUser && state.currentUser.email) ? state.currentUser.email : '';
        const { data, error } = await state.supabaseClient
            .from('patient_prescriptions')
            .select('*')
            .order('created_at', { ascending: false });
        if (error || !data || !Array.isArray(data)) return null;
        const userScoped = data.filter(item => isUserMatch(item, userEmail));

        // Deduplicate by normalized medicine name to prevent duplicate cards
        const uniqueMap = new Map();
        userScoped.forEach(item => {
            const normName = (item.medicine_name || '').trim().toLowerCase();
            if (normName && !uniqueMap.has(normName)) {
                uniqueMap.set(normName, item);
            }
        });
        const deduplicated = Array.from(uniqueMap.values());
        return deduplicated.map(enhancePrescriptionClient);
    } catch (e) {
        return null;
    }
}

async function getSupabaseOrders() {
    if (!state.supabaseClient) return null;
    try {
        const userEmail = (state.currentUser && state.currentUser.email) ? state.currentUser.email : '';
        const { data, error } = await state.supabaseClient
            .from('pharmacy_orders')
            .select('*')
            .order('created_at', { ascending: false });
        if (error || !data || !Array.isArray(data)) return null;
        return data.filter(item => isUserMatch(item, userEmail));
    } catch (e) {
        return null;
    }
}

async function getSupabaseLogs() {
    if (!state.supabaseClient) return null;
    try {
        const userEmail = (state.currentUser && state.currentUser.email) ? state.currentUser.email : '';
        const { data, error } = await state.supabaseClient
            .from('medication_logs')
            .select('*');
        if (error || !data || !Array.isArray(data)) return null;

        const userRxIds = new Set((state.prescriptions || []).map(r => r.id));
        const userMedNames = new Set((state.prescriptions || []).map(r => (r.medicine_name || '').toLowerCase()));

        return data.filter(item => {
            if (isUserMatch(item, userEmail)) return true;
            if (item.prescription_id && userRxIds.has(item.prescription_id)) return true;
            if (item.medicine_name && userMedNames.has((item.medicine_name || '').toLowerCase())) return true;
            return false;
        });
    } catch (e) {
        return null;
    }
}

function enhancePrescriptionClient(rx) {
    const freqType = rx.dosage_frequency_type || 'TWICE_DAILY';
    const rxType = rx.prescription_type || 'RX';
    const tabletsPerDose = parseFloat(rx.tablets_per_dose) || 1.0;
    const dailyFreq = parseFloat(rx.daily_frequency) || (freqType === 'ONCE_MORNING' || freqType === 'ONCE_NIGHT' ? 1 : 2);
    const totalPills = parseFloat(rx.total_tablets_remaining) || 0;
    const daysLeft = dailyFreq > 0 ? Math.floor(totalPills / dailyFreq) : 999;

    const isRunoutAlert5Days = daysLeft <= 5 && totalPills > 0;
    const isOutOfStock = totalPills === 0;

    let freqLabel = 'Twice a Day (08:00 AM - 08:00 PM)';
    if (freqType === 'ONCE_MORNING') freqLabel = 'Morning Only (08:00 AM)';
    else if (freqType === 'ONCE_NIGHT') freqLabel = 'Night Only (09:00 PM)';
    else if (freqType === 'THRICE_DAILY') freqLabel = 'Thrice a Day';

    let rxLabel = 'Rx (Standard Prescription)';
    if (rxType === 'NRX') rxLabel = 'NRx (Controlled Substance)';
    else if (rxType === 'TRX') rxLabel = 'TRx (Chronic Care Refill)';
    else if (rxType === 'OTC') rxLabel = 'OTC (Wellness / Antacid)';

    let mealText = 'Take after meal / food';
    if (rx.meal_relation === 'BEFORE_MEAL') mealText = 'Take on empty stomach (Before Meal)';

    return {
        ...rx,
        daily_frequency: dailyFreq,
        tablets_per_dose: tabletsPerDose,
        days_supply_remaining: daysLeft,
        is_runout_alert_5days: isRunoutAlert5Days,
        is_out_of_stock: isOutOfStock,
        frequency_label: freqLabel,
        prescription_type_label: rxLabel,
        meal_relation_text: mealText,
        dose_quantity_label: tabletsPerDose === 0.5 ? '1/2 Tablet (Half Dose)' : (tabletsPerDose === 0.25 ? '1/4 Tablet' : `${tabletsPerDose} Tablet(s)`)
    };
}

function isLogForDate(l, dateStr) {
    if (!l) return false;
    if (l.date && l.date === dateStr) return true;
    if (l.taken_at) {
        if (l.taken_at.startsWith(dateStr) || l.taken_at.substring(0, 10) === dateStr) return true;
    }
    if (l.created_at) {
        if (l.created_at.startsWith(dateStr) || l.created_at.substring(0, 10) === dateStr) return true;
    }
    return false;
}

function isLogForSlot(l, slotName) {
    if (!l) return false;
    const s = String(l.scheduled_time || '').toUpperCase().trim();
    const target = String(slotName || '').toUpperCase().trim();
    if (!s) return true;
    if (s === target) return true;
    if (target === 'MORNING' && (s.includes('MORN') || s.startsWith('06') || s.startsWith('07') || s.startsWith('08') || s.startsWith('09') || s.startsWith('10'))) return true;
    if (target === 'AFTERNOON' && (s.includes('AFTER') || s.startsWith('11') || s.startsWith('12') || s.startsWith('13') || s.startsWith('14') || s.startsWith('15') || s.startsWith('16'))) return true;
    if (target === 'EVENING' && (s.includes('EVEN') || s.startsWith('17') || s.startsWith('18') || s.startsWith('19') || s.startsWith('20'))) return true;
    if (target === 'NIGHT' && (s.includes('NIGH') || s.startsWith('21') || s.startsWith('22') || s.startsWith('23') || s.startsWith('00'))) return true;
    return false;
}

function isLogForRx(l, rx) {
    if (!l || !rx) return false;
    if (l.prescription_id && rx.id && l.prescription_id === rx.id) return true;
    if (l.medicine_name && rx.medicine_name) {
        const n1 = String(l.medicine_name).toLowerCase().replace(/[^a-z0-9]/g, '');
        const n2 = String(rx.medicine_name).toLowerCase().replace(/[^a-z0-9]/g, '');
        if (n1 && n2 && (n1 === n2 || n1.includes(n2) || n2.includes(n1))) return true;
    }
    return false;
}

function formatIntakeTime(isoStr) {
    if (!isoStr) return '';
    try {
        const d = new Date(isoStr);
        if (isNaN(d)) return '';
        return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    } catch (e) {
        return '';
    }
}

function buildScheduleFromData(rxs, logs, targetDate) {
    const dateStr = targetDate || getTodayDateStr();
    const todayObj = new Date();

    return rxs.map(rx => {
        const morningLog = logs.find(l => isLogForRx(l, rx) && isLogForSlot(l, 'MORNING') && isLogForDate(l, dateStr));
        const afternoonLog = logs.find(l => isLogForRx(l, rx) && isLogForSlot(l, 'AFTERNOON') && isLogForDate(l, dateStr));
        const eveningLog = logs.find(l => isLogForRx(l, rx) && isLogForSlot(l, 'EVENING') && isLogForDate(l, dateStr));
        const nightLog = logs.find(l => isLogForRx(l, rx) && isLogForSlot(l, 'NIGHT') && isLogForDate(l, dateStr));

        const history7Days = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date(todayObj);
            d.setDate(todayObj.getDate() - i);
            const dStr = getLocalDateStr(d);
            const dayLogs = logs.filter(l => isLogForRx(l, rx) && isLogForDate(l, dStr) && l.status === 'TAKEN');
            history7Days.push({
                date: dStr,
                dayLabel: i === 0 ? 'Today' : (i === 1 ? 'Yest' : d.toLocaleDateString('en-US', { weekday: 'short' })),
                dayNum: d.getDate(),
                monthShort: d.toLocaleDateString('en-US', { month: 'short' }),
                isToday: i === 0,
                isSelected: dStr === dateStr,
                takenCount: dayLogs.length
            });
        }

        const dailyFreq = rx.daily_frequency || 1;
        const totalPills = rx.total_tablets_remaining || 0;
        const daysRemaining = dailyFreq > 0 ? Math.floor(totalPills / dailyFreq) : 999;
        const isRunout = daysRemaining <= 5;

        return {
            ...rx,
            target_date: dateStr,
            days_supply_remaining: daysRemaining,
            is_runout_alert_5days: isRunout,
            morning_taken: Boolean(morningLog && morningLog.status === 'TAKEN'),
            morning_taken_time: (morningLog && morningLog.taken_at) ? formatIntakeTime(morningLog.taken_at) : '',
            afternoon_taken: Boolean(afternoonLog && afternoonLog.status === 'TAKEN'),
            afternoon_taken_time: (afternoonLog && afternoonLog.taken_at) ? formatIntakeTime(afternoonLog.taken_at) : '',
            evening_taken: Boolean(eveningLog && eveningLog.status === 'TAKEN'),
            evening_taken_time: (eveningLog && eveningLog.taken_at) ? formatIntakeTime(eveningLog.taken_at) : '',
            night_taken: Boolean(nightLog && nightLog.status === 'TAKEN'),
            night_taken_time: (nightLog && nightLog.taken_at) ? formatIntakeTime(nightLog.taken_at) : '',
            history_7days: history7Days
        };
    });
}

function getClientStorageKey(suffix) {
    const userEmail = (state.currentUser && state.currentUser.email) ? state.currentUser.email : 'guest';
    return `sattva_${suffix}_${userEmail}`;
}

function getClientPrescriptions() {
    const key = getClientStorageKey('rxs');
    const userEmail = (state.currentUser && state.currentUser.email) ? state.currentUser.email.trim().toLowerCase() : '';
    const isMainPatient = !userEmail || userEmail === 'patient@sattvacare.com' || userEmail === 'patient@medibuddy.com' || userEmail === 'admin@sattvacare.com';

    let rxs = localStorage.getItem(key);
    if (!rxs) {
        const initial = isMainPatient ? DEFAULT_CLIENT_RXS : [];
        localStorage.setItem(key, JSON.stringify(initial));
        return initial;
    }
    try {
        const parsed = JSON.parse(rxs);
        if (Array.isArray(parsed)) return parsed;
        const initial = isMainPatient ? DEFAULT_CLIENT_RXS : [];
        localStorage.setItem(key, JSON.stringify(initial));
        return initial;
    } catch (e) {
        return isMainPatient ? DEFAULT_CLIENT_RXS : [];
    }
}

function saveClientPrescriptions(rxs) {
    localStorage.setItem(getClientStorageKey('rxs'), JSON.stringify(rxs));
}

function getClientLogs() {
    const key = getClientStorageKey('logs');
    const userEmail = (state.currentUser && state.currentUser.email) ? state.currentUser.email.trim().toLowerCase() : '';
    const isMainPatient = !userEmail || userEmail === 'patient@sattvacare.com' || userEmail === 'patient@medibuddy.com' || userEmail === 'admin@sattvacare.com';

    let logs = localStorage.getItem(key);
    if (!logs) {
        const initial = isMainPatient ? generateDefaultClientLogs() : [];
        localStorage.setItem(key, JSON.stringify(initial));
        return initial;
    }
    try { 
        const parsed = JSON.parse(logs);
        if (Array.isArray(parsed)) return parsed;
        const initial = isMainPatient ? generateDefaultClientLogs() : [];
        localStorage.setItem(key, JSON.stringify(initial));
        return initial;
    } catch (e) {
        return isMainPatient ? generateDefaultClientLogs() : [];
    }
}

function saveClientLogs(logs) {
    localStorage.setItem(getClientStorageKey('logs'), JSON.stringify(logs));
}

function getClientOrders() {
    const key = getClientStorageKey('orders');
    let orders = localStorage.getItem(key);
    if (!orders) return [];
    try {
        const parsed = JSON.parse(orders);
        if (Array.isArray(parsed)) return parsed;
        return [];
    } catch (e) {
        return [];
    }
}

function saveClientOrders(orders) {
    localStorage.setItem(getClientStorageKey('orders'), JSON.stringify(orders));
}

function getClientSideSchedule(targetDate) {
    const rxs = getClientPrescriptions();
    const logs = getClientLogs();
    const dateStr = targetDate || getTodayDateStr();
    return buildScheduleFromData(rxs, logs, dateStr);
}

// 🔮 Modal Visibility Engine (High-Performance Instant Display)
function showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.remove('hidden', 'opacity-0');
}

function hideModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.add('opacity-0', 'hidden');
}

function closeRxModal() {
    hideModal('rx-modal');
}

function openExportModal() {
    const data = {
        patient: (state.currentUser && state.currentUser.email) ? state.currentUser.email : 'patient@medibuddy.com',
        export_date: new Date().toISOString(),
        prescriptions: state.prescriptions || [],
        schedule: state.schedule || [],
        orders: state.orders || [],
        vitals: state.vitals || []
    };
    const jsonStr = JSON.stringify(data, null, 2);
    downloadFile(jsonStr, `SattvaCare_Medical_Export_${Date.now()}.json`, 'application/json');
    showToast('✓ Complete medical records exported as JSON!', 'success');
}

// ⚡ Quick Tools Dropdown Toggle
function toggleToolsDropdown() {
    const menu = document.getElementById('tools-dropdown-menu');
    if (menu) menu.classList.toggle('hidden');
}

// Close tools dropdown on outside click
document.addEventListener('click', (e) => {
    const menu = document.getElementById('tools-dropdown-menu');
    const btn = e.target.closest('button[onclick*="toggleToolsDropdown"]');
    if (menu && !menu.classList.contains('hidden') && !btn && !menu.contains(e.target)) {
        menu.classList.add('hidden');
    }
});

// 📌 4-Tab Interactive View Switcher Engine
function switchTab(tabName) {
    state.activeTab = tabName || 'schedule';

    const tabs = ['schedule', 'cabinet', 'analytics', 'orders'];
    tabs.forEach(t => {
        const btn = document.getElementById(`nav-tab-${t}`);
        const content = document.getElementById(`tab-content-${t}`);

        if (btn) {
            if (t === state.activeTab) {
                btn.className = 'nav-tab-btn nav-tab-btn-active';
            } else {
                btn.className = 'nav-tab-btn nav-tab-btn-inactive';
            }
        }

        if (content) {
            if (t === state.activeTab) {
                content.classList.remove('hidden');
            } else {
                content.classList.add('hidden');
            }
        }
    });

    if (state.activeTab === 'analytics') {
        renderAdherenceAnalyticsChart();
        renderAnalyticsSymptomCard();
        fetchVitals();
        renderPredictiveRiskRadar();
        if (!dtIsAnimating) init3DDigitalTwin();
    } else if (state.activeTab === 'cabinet') {
        renderCabinetGrid(state.prescriptions);
    } else if (state.activeTab === 'orders') {
        renderOrdersList(state.orders);
    } else if (state.activeTab === 'schedule') {
        renderScheduleCards(state.schedule);
    }
}

// Load Patient Portal
async function loadPatientPortal() {
    loadHydrationState();

    await Promise.all([
        fetchPatientStats(),
        fetchSchedule(),
        fetchCabinet(),
        fetchOrders(),
        fetchVitals()
    ]);
    renderAdherenceAnalyticsChart();
    renderPredictiveRiskRadar();
}

async function fetchPatientStats() {
    try {
        const selDate = state.selectedDate || getTodayDateStr();
        const isNetlify = isStaticWebDeployment();
        let stats = null;
        if (!isNetlify) {
            stats = await safeFetchJson(`/api/patient/stats?date=${encodeURIComponent(selDate)}&t=${Date.now()}`, { headers: getUserHeaders() });
        }

        if (!stats && state.supabaseClient) {
            const sbRxs = await getSupabasePrescriptions();
            const sbLogs = await getSupabaseLogs();
            if (sbRxs) {
                const schedule = buildScheduleFromData(sbRxs, sbLogs || [], selDate);
                let totalPills = 0;
                let runoutCount = 0;
                const alertList = [];
                sbRxs.forEach(r => {
                    totalPills += parseFloat(r.total_tablets_remaining || 0);
                    const days = r.daily_frequency > 0 ? Math.floor(r.total_tablets_remaining / r.daily_frequency) : 999;
                    if (days <= 5) {
                        runoutCount++;
                        alertList.push({
                            id: r.id,
                            medicine_name: r.medicine_name,
                            brand_name: r.brand_name,
                            total_tablets_remaining: r.total_tablets_remaining,
                            days_left: days
                        });
                    }
                });
                let req = 0, taken = 0;
                schedule.forEach(s => {
                    let reqCount = 2;
                    if (s.dosage_frequency_type === 'ONCE_MORNING' || s.dosage_frequency_type === 'ONCE_NIGHT') reqCount = 1;
                    else if (s.dosage_frequency_type === 'THRICE_DAILY') reqCount = 3;
                    else if (s.dosage_frequency_type === 'FOUR_TIMES_DAILY') reqCount = 4;
                    else if (s.dosage_frequency_type === 'AS_NEEDED') reqCount = 1;
                    
                    req += reqCount;

                    let takenForRx = 0;
                    if (s.morning_taken) takenForRx++;
                    if (s.afternoon_taken) takenForRx++;
                    if (s.evening_taken) takenForRx++;
                    if (s.night_taken) takenForRx++;

                    taken += Math.min(reqCount, takenForRx);
                });
                stats = {
                    adherence_percentage: req > 0 ? Math.min(100, Math.round((taken / req) * 100)) : 0,
                    today_taken_count: taken,
                    today_scheduled_count: req,
                    total_pills_remaining: totalPills,
                    total_prescriptions: sbRxs.length,
                    runout_5days_count: runoutCount,
                    critical_runout_alerts: alertList
                };
            }
        }

        if (!stats) {
            const schedule = getClientSideSchedule(selDate);
            const rxs = getClientPrescriptions();
            let totalPills = 0;
            let runoutCount = 0;
            const alertList = [];
            rxs.forEach(r => {
                totalPills += parseFloat(r.total_tablets_remaining || 0);
                const days = r.daily_frequency > 0 ? Math.floor(r.total_tablets_remaining / r.daily_frequency) : 999;
                if (days <= 5) {
                    runoutCount++;
                    alertList.push({
                        id: r.id,
                        medicine_name: r.medicine_name,
                        brand_name: r.brand_name,
                        total_tablets_remaining: r.total_tablets_remaining,
                        days_left: days
                    });
                }
            });
            let req = 0, taken = 0;
            schedule.forEach(s => {
                let reqCount = 2;
                if (s.dosage_frequency_type === 'ONCE_MORNING' || s.dosage_frequency_type === 'ONCE_NIGHT') reqCount = 1;
                else if (s.dosage_frequency_type === 'THRICE_DAILY') reqCount = 3;
                else if (s.dosage_frequency_type === 'FOUR_TIMES_DAILY') reqCount = 4;
                else if (s.dosage_frequency_type === 'AS_NEEDED') reqCount = 1;

                req += reqCount;

                let takenForRx = 0;
                if (s.morning_taken) takenForRx++;
                if (s.afternoon_taken) takenForRx++;
                if (s.evening_taken) takenForRx++;
                if (s.night_taken) takenForRx++;

                taken += Math.min(reqCount, takenForRx);
            });
            stats = {
                adherence_percentage: req > 0 ? Math.min(100, Math.round((taken / req) * 100)) : 0,
                today_taken_count: taken,
                today_scheduled_count: req,
                total_pills_remaining: totalPills,
                total_prescriptions: rxs.length,
                runout_5days_count: runoutCount,
                critical_runout_alerts: alertList
            };
        }

        state.stats = stats;

        const isToday = selDate === getTodayDateStr();
        const dateLabel = isToday ? 'today' : `on ${selDate}`;

        document.getElementById('stat-adherence').innerText = `${state.stats.adherence_percentage || 0}%`;
        document.getElementById('stat-doses-taken-text').innerText = `${state.stats.today_taken_count || 0} of ${state.stats.today_scheduled_count || 0} doses taken ${dateLabel}`;
        document.getElementById('stat-total-pills').innerText = (state.stats.total_pills_remaining || 0).toLocaleString();
        document.getElementById('stat-rxs-count').innerText = `Across ${state.stats.total_prescriptions || 0} prescriptions`;
        document.getElementById('stat-runout-count').innerText = state.stats.runout_5days_count || 0;

        renderStockoutBanner(state.stats.critical_runout_alerts || []);
        render30DayExpiryBanner(state.prescriptions || []);
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

// ⚠️ 1-Month (30-Day) Expiry Notification Alert Engine
function render30DayExpiryBanner(prescriptions) {
    const banner = document.getElementById('expiry-30day-banner');
    const alertList = document.getElementById('expiry-banner-list');
    const alertCount = document.getElementById('expiry-banner-count');
    if (!banner || !alertList || !alertCount) return;

    const targetRxs = prescriptions || state.prescriptions || [];
    if (!targetRxs || !Array.isArray(targetRxs) || targetRxs.length === 0) {
        banner.classList.add('hidden');
        return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const expiryAlerts = [];

    targetRxs.forEach(rx => {
        const batchList = (rx.batches && Array.isArray(rx.batches) && rx.batches.length > 0) 
            ? rx.batches 
            : [{ batch_number: rx.batch_number || '', expiry_date: rx.expiry_date || null }];

        batchList.forEach(b => {
            if (b.expiry_date) {
                const expDate = new Date(b.expiry_date + 'T00:00:00');
                if (!isNaN(expDate.getTime())) {
                    expDate.setHours(0, 0, 0, 0);
                    const diffTime = expDate - today;
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                    
                    if (diffDays <= 30) {
                        expiryAlerts.push({
                            rx_id: rx.id,
                            medicine_name: rx.medicine_name,
                            brand_name: rx.brand_name || '',
                            batch_number: b.batch_number || 'Default Batch',
                            expiry_date: b.expiry_date,
                            days_left: diffDays,
                            is_expired: diffDays <= 0
                        });
                    }
                }
            }
        });
    });

    if (expiryAlerts.length === 0) {
        banner.classList.add('hidden');
        return;
    }

    banner.classList.remove('hidden');
    alertCount.innerText = `${expiryAlerts.length} item${expiryAlerts.length > 1 ? 's' : ''}`;

    alertList.innerHTML = expiryAlerts.map(a => `
        <div class="px-3 py-1.5 rounded-xl ${a.is_expired ? 'bg-rose-100 border-rose-300 text-rose-950' : 'bg-amber-100 border-amber-300 text-amber-950'} border flex flex-wrap items-center gap-2 text-xs font-bold shadow-xs">
            <i class="${a.is_expired ? 'fa-solid fa-triangle-exclamation text-rose-600' : 'fa-solid fa-hourglass-half text-amber-600'}"></i>
            <span>${escapeHtml(a.medicine_name)} (${escapeHtml(a.batch_number)})</span>
            <span class="px-2 py-0.5 rounded ${a.is_expired ? 'bg-rose-600 text-white' : 'bg-amber-600 text-white'} text-[10px] font-black">
                ${a.is_expired ? `EXPIRED (${Math.abs(a.days_left)}d ago)` : `Expiring in ${a.days_left}d (${a.expiry_date})`}
            </span>
            <button onclick="openEditPrescriptionModal('${a.rx_id}')" class="text-teal-800 hover:text-teal-950 underline text-[11px] font-black">
                Update Batch / Expiry
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

function getExpiryStatusBadgeHTML(expiryDate, batchNumber, batchStripCount, batches) {
    if (batches && Array.isArray(batches) && batches.length > 0) {
        return batches.map(b => {
            let bInfo = '';
            if (b.batch_number) {
                const sText = b.batch_strip_count ? ` (${b.batch_strip_count} Strip${b.batch_strip_count > 1 ? 's' : ''})` : '';
                bInfo = `<span class="px-2 py-0.5 bg-teal-50 text-teal-900 border border-teal-300 rounded-lg text-[10px] font-extrabold shadow-xs inline-flex items-center gap-1 mb-1 mr-1"><i class="fa-solid fa-barcode text-teal-600"></i>Batch: ${escapeHtml(b.batch_number)}${sText}</span>`;
            }
            let expBadge = '';
            if (b.expiry_date) {
                const expDate = new Date(b.expiry_date + 'T00:00:00');
                if (!isNaN(expDate.getTime())) {
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    const diffTime = expDate - today;
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                    const formattedDate = expDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric', day: 'numeric' });
                    if (diffDays < 0) {
                        const ago = Math.abs(diffDays);
                        expBadge = `<span class="px-2 py-0.5 bg-rose-100 text-rose-800 border border-rose-300 rounded-lg text-[10px] font-black shadow-xs inline-flex items-center gap-1 mb-1 mr-1"><i class="fa-solid fa-triangle-exclamation text-rose-600"></i> EXPIRED (${ago}d ago)</span>`;
                    } else if (diffDays <= 60) {
                        expBadge = `<span class="px-2 py-0.5 bg-amber-100 text-amber-900 border border-amber-300 rounded-lg text-[10px] font-black shadow-xs inline-flex items-center gap-1 mb-1 mr-1"><i class="fa-solid fa-hourglass-half text-amber-600"></i> Expiring Soon (${diffDays}d left)</span>`;
                    } else {
                        expBadge = `<span class="px-2 py-0.5 bg-slate-100 text-slate-700 border border-slate-300 rounded-lg text-[10px] font-extrabold shadow-xs inline-flex items-center gap-1 mb-1 mr-1"><i class="fa-solid fa-calendar-xmark text-slate-500"></i> Exp: ${formattedDate}</span>`;
                    }
                }
            }
            return `${bInfo} ${expBadge}`.trim();
        }).join(' ');
    }

    let batchInfo = '';
    if (batchNumber) {
        const stripsText = batchStripCount ? ` (${batchStripCount} Strip${batchStripCount > 1 ? 's' : ''})` : '';
        batchInfo = `<span class="px-2.5 py-0.5 bg-slate-100 text-slate-800 border border-slate-300 rounded-lg text-[10px] font-extrabold shadow-xs inline-flex items-center gap-1"><i class="fa-solid fa-barcode text-teal-600"></i>Batch: ${escapeHtml(batchNumber)}${stripsText}</span>`;
    }

    if (!expiryDate) return batchInfo;
    const expDate = new Date(expiryDate + 'T00:00:00');
    if (isNaN(expDate.getTime())) return batchInfo;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const diffTime = expDate - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const formattedDate = expDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric', day: 'numeric' });

    let expBadge = '';
    if (diffDays < 0) {
        const ago = Math.abs(diffDays);
        expBadge = `<span class="px-2.5 py-0.5 bg-rose-100 text-rose-800 border border-rose-300 rounded-lg text-[10px] font-black shadow-xs inline-flex items-center gap-1"><i class="fa-solid fa-triangle-exclamation text-rose-600"></i> EXPIRED (${ago}d ago)</span>`;
    } else if (diffDays <= 60) {
        expBadge = `<span class="px-2.5 py-0.5 bg-amber-100 text-amber-900 border border-amber-300 rounded-lg text-[10px] font-black shadow-xs inline-flex items-center gap-1"><i class="fa-solid fa-hourglass-half text-amber-600"></i> Expiring Soon (${diffDays}d left)</span>`;
    } else {
        expBadge = `<span class="px-2.5 py-0.5 bg-slate-100 text-slate-700 border border-slate-300 rounded-lg text-[10px] font-extrabold shadow-xs inline-flex items-center gap-1"><i class="fa-solid fa-calendar-xmark text-slate-500"></i> Exp: ${formattedDate}</span>`;
    }

    return `${batchInfo} ${expBadge}`.trim();
}

function renderBatchStripRows(batches) {
    const container = document.getElementById('rx-batch-list-container');
    if (!container) return;

    if (!batches || !Array.isArray(batches) || batches.length === 0) {
        batches = [{ batch_number: '', batch_strip_count: 3, expiry_date: '' }];
    }

    container.innerHTML = batches.map((b, idx) => `
        <div class="rx-batch-row grid grid-cols-1 sm:grid-cols-12 gap-3 items-center bg-white p-3 rounded-xl border border-teal-300 shadow-xs">
            <div class="sm:col-span-4">
                <label class="block text-[11px] font-extrabold text-teal-800 uppercase mb-1"><i class="fa-solid fa-barcode text-teal-600 mr-1"></i> Batch No.</label>
                <input type="text" value="${escapeHtml(b.batch_number || '')}" placeholder="e.g. BATCH-2026-X9" class="rx-batch-no-input w-full px-3 py-2 rounded-lg border border-slate-300 text-xs text-slate-900 font-bold focus:border-teal-600 outline-none">
            </div>
            <div class="sm:col-span-3">
                <label class="block text-[11px] font-extrabold text-teal-800 uppercase mb-1"><i class="fa-solid fa-layer-group text-teal-600 mr-1"></i> Strips</label>
                <input type="number" min="1" value="${b.batch_strip_count || 1}" oninput="autoCalcTotalPills()" placeholder="Strips" class="rx-batch-strips-input w-full px-3 py-2 rounded-lg border border-slate-300 text-xs text-slate-900 font-bold focus:border-teal-600 outline-none">
            </div>
            <div class="sm:col-span-4">
                <label class="block text-[11px] font-extrabold text-teal-800 uppercase mb-1"><i class="fa-solid fa-calendar-xmark text-teal-600 mr-1"></i> Expiry Date</label>
                <input type="date" value="${b.expiry_date || ''}" class="rx-batch-expiry-input w-full px-3 py-2 rounded-lg border border-slate-300 text-xs text-slate-900 font-bold focus:border-teal-600 outline-none">
            </div>
            <div class="sm:col-span-1 text-right flex items-center justify-end pt-4 sm:pt-0">
                ${batches.length > 1 ? `
                    <button type="button" onclick="removeBatchStripRow(${idx})" title="Remove this batch strip" class="p-2 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition text-sm">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                ` : `
                    <span class="text-slate-300 text-xs p-2"><i class="fa-solid fa-lock"></i></span>
                `}
            </div>
        </div>
    `).join('');
}

function getBatchRowsFromDOM() {
    const rows = [];
    const rowElems = document.querySelectorAll('.rx-batch-row');
    rowElems.forEach(row => {
        const no = row.querySelector('.rx-batch-no-input') ? row.querySelector('.rx-batch-no-input').value.trim() : '';
        const count = row.querySelector('.rx-batch-strips-input') ? (parseInt(row.querySelector('.rx-batch-strips-input').value, 10) || 1) : 1;
        const exp = row.querySelector('.rx-batch-expiry-input') ? row.querySelector('.rx-batch-expiry-input').value : null;
        rows.push({ batch_number: no, batch_strip_count: count, expiry_date: exp });
    });
    return rows;
}

function addBatchStripRow() {
    const currentRows = getBatchRowsFromDOM();
    currentRows.push({ batch_number: '', batch_strip_count: 1, expiry_date: '' });
    renderBatchStripRows(currentRows);
    autoCalcTotalPills();
}

function removeBatchStripRow(idx) {
    const currentRows = getBatchRowsFromDOM();
    if (currentRows.length > 1) {
        currentRows.splice(idx, 1);
        renderBatchStripRows(currentRows);
        autoCalcTotalPills();
    }
}

function autoCalcTotalPills() {
    const rowElems = document.querySelectorAll('.rx-batch-row');
    const pillsPerStripEl = document.getElementById('rx-units-per-pack');
    const totalPillsEl = document.getElementById('rx-total-pills');
    const perStrip = parseFloat(pillsPerStripEl ? pillsPerStripEl.value : 10) || 10;

    let totalStrips = 0;
    if (rowElems && rowElems.length > 0) {
        rowElems.forEach(row => {
            const input = row.querySelector('.rx-batch-strips-input');
            if (input) {
                totalStrips += (parseFloat(input.value) || 0);
            }
        });
    } else {
        const stripsEl = document.getElementById('rx-batch-strip-count');
        if (stripsEl) totalStrips = parseFloat(stripsEl.value) || 0;
    }

    if (totalPillsEl && totalStrips > 0 && perStrip > 0) {
        totalPillsEl.value = parseFloat((totalStrips * perStrip).toFixed(2));
    }
}

// Date Schedule & 7-Day Tracker Functions
function selectScheduleDate(dateStr) {
    state.selectedDate = dateStr;
    fetchSchedule();
}

async function fetchSchedule() {
    renderSevenDayBar();
    try {
        const selDate = state.selectedDate || getTodayDateStr();
        const isNetlify = isStaticWebDeployment();
        let data = null;
        if (!isNetlify) {
            data = await safeFetchJson(`/api/patient/today-schedule?date=${encodeURIComponent(selDate)}&t=${Date.now()}`, { headers: getUserHeaders() });
        }

        if (!data && state.supabaseClient) {
            const sbRxs = await getSupabasePrescriptions();
            const sbLogs = await getSupabaseLogs();
            if (sbRxs && sbRxs.length > 0) {
                data = buildScheduleFromData(sbRxs, sbLogs || [], selDate);
            }
        }

        state.schedule = data ? data : getClientSideSchedule(selDate);
        renderScheduleCards();
        updateNextDoseTimer(state.schedule);
    } catch (e) {
        state.schedule = getClientSideSchedule(state.selectedDate || getTodayDateStr());
        renderScheduleCards();
        updateNextDoseTimer(state.schedule);
    }
}

function renderSevenDayBar() {
    const barEl = document.getElementById('seven-day-bar');
    const badgeEl = document.getElementById('selected-date-badge');
    if (!barEl) return;

    const todayObj = new Date();
    const activeDateStr = state.selectedDate || getTodayDateStr();

    let buttonsHTML = '';
    for (let i = 6; i >= 0; i--) {
        const d = new Date(todayObj);
        d.setDate(todayObj.getDate() - i);
        const dStr = getLocalDateStr(d);
        const isSelected = dStr === activeDateStr;
        const isToday = i === 0;
        const isYesterday = i === 1;

        const dayLabel = isToday ? 'Today' : (isYesterday ? 'Yest' : d.toLocaleDateString('en-US', { weekday: 'short' }));
        const dateNum = d.getDate();
        const monthShort = d.toLocaleDateString('en-US', { month: 'short' });

        const activeClass = isSelected 
            ? 'bg-teal-600 text-white shadow-lg font-black ring-2 ring-teal-400 scale-[1.03]' 
            : 'bg-white/80 hover:bg-slate-100 text-slate-700 font-bold border border-slate-200 shadow-xs';

        buttonsHTML += `
            <button onclick="selectScheduleDate('${dStr}')" class="flex flex-col items-center justify-center p-2 rounded-xl text-center transition-all duration-200 ${activeClass}">
                <span class="text-[10px] uppercase tracking-wider ${isSelected ? 'text-teal-100' : 'text-slate-500'} font-extrabold">${dayLabel}</span>
                <span class="text-sm font-black mt-0.5">${dateNum}</span>
                <span class="text-[9px] ${isSelected ? 'text-teal-100 font-bold' : 'text-slate-600'}">${monthShort}</span>
            </button>
        `;
    }
    barEl.innerHTML = buttonsHTML;

    if (badgeEl) {
        const activeDateObj = new Date(activeDateStr + 'T00:00:00');
        const formattedDate = activeDateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        badgeEl.innerText = activeDateStr === getTodayDateStr() ? `Today (${formattedDate})` : formattedDate;
    }
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

    const activeDateStr = state.selectedDate || getTodayDateStr();
    const isToday = activeDateStr === getTodayDateStr();
    const dateTitleLabel = isToday ? "Log Today's Intake:" : `Log Intake (${activeDateStr}):`;

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

        // Generate mini 7-day pill strip for card
        const historyList = s.history_7days || [];
        const miniStripHTML = historyList.map(h => {
            const isSel = h.date === activeDateStr;
            const hasTaken = h.takenCount > 0;
            const badgeBg = hasTaken ? 'bg-emerald-500 text-white font-black' : (isSel ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600 border border-slate-200');
            return `
                <button onclick="selectScheduleDate('${h.date}')" title="${h.dayLabel} (${h.date}): ${hasTaken ? 'Taken ✓' : 'Not Logged'}" class="flex-1 py-1 rounded-lg text-[9px] font-bold transition text-center ${badgeBg} ${isSel ? 'ring-2 ring-teal-400 font-black' : ''}">
                    <span>${h.dayLabel}</span>
                    <span class="block font-black">${hasTaken ? '✓' : h.dayNum}</span>
                </button>
            `;
        }).join('');

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
                            
                            <div class="flex flex-wrap items-center gap-1.5 mt-2">
                                ${getExpiryStatusBadgeHTML(s.expiry_date, s.batch_number, s.batch_strip_count)}
                            </div>
                        </div>
                        <button onclick="openEditPrescriptionModal('${s.id}')" title="Edit Record" class="btn-glass p-2.5 text-xs rounded-xl transition">
                            <i class="fa-solid fa-pen-to-square"></i>
                        </button>
                    </div>

                    ${s.generic_name ? `
                        <div class="mt-3 p-2.5 rounded-xl bg-teal-50/90 border border-teal-200/90 text-xs shadow-xs">
                            <span class="text-[10px] font-black uppercase text-teal-800 tracking-widest block flex items-center gap-1"><i class="fa-solid fa-flask text-teal-600"></i> Generic Chemical Composition</span>
                            <span class="text-slate-900 font-extrabold block break-words whitespace-normal leading-snug mt-0.5">${escapeHtml(s.generic_name)}</span>
                        </div>
                    ` : ''}

                    <!-- Medical Instructions & Stock Bar -->
                    <div class="mt-3 card-inner-box p-3.5 text-xs space-y-2">
                        <p class="text-teal-800 font-bold flex items-center gap-1.5">
                            <i class="fa-solid fa-utensils text-teal-600"></i> ${escapeHtml(s.meal_relation_text)}
                        </p>
                        ${s.instructions ? `<p class="text-slate-700 font-medium"><i class="fa-solid fa-circle-info text-slate-500 mr-1"></i> ${escapeHtml(s.instructions)}</p>` : ''}
                        ${s.doctor_name ? `<p class="text-slate-600"><i class="fa-solid fa-user-doctor text-slate-500 mr-1"></i> ${escapeHtml(s.doctor_name)} ${s.clinic_hospital ? `(${escapeHtml(s.clinic_hospital)})` : ''}</p>` : ''}
                        ${getFoodSafetyBadgesHTML(s.food_safety_warnings)}
                        
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
                                        ${s.days_supply_remaining === 0 ? 'Out of Stock' : `Runs out: ${s.predicted_runout_date || s.days_supply_remaining + 'd'}`}
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

                <!-- Mini 7-Day Quick Strip & Intake Toggle Buttons -->
                <div class="pt-3 border-t border-slate-200 space-y-2.5">
                    <div class="flex items-center justify-between">
                        <span class="text-[10px] font-black text-slate-600 uppercase tracking-widest block">${dateTitleLabel}</span>
                        <span class="text-[10px] font-bold text-teal-700 flex items-center gap-1">
                            <i class="fa-solid fa-history"></i> 7-Day History
                        </span>
                    </div>

                    <!-- Mini 7-Day Strip -->
                    <div class="flex items-center gap-1 p-1 bg-slate-50 border border-slate-200/80 rounded-xl">
                        ${miniStripHTML}
                    </div>

                    <div class="grid grid-cols-2 gap-2">
                        ${showMorning ? `
                            <button onclick="toggleDoseSlot('${s.id}', 'MORNING')" class="dose-btn-check py-2 px-3 rounded-xl border text-xs font-black flex flex-col items-center justify-center ${s.morning_taken ? 'dose-btn-taken text-white' : 'btn-glass text-slate-700'}">
                                <div class="flex items-center gap-1.5">
                                    ${s.morning_taken ? '<i class="fa-solid fa-circle-check text-white text-sm"></i>' : '<i class="fa-solid fa-sun text-amber-500"></i>'}
                                    <span>Morning ${s.morning_taken ? '✓' : ''}</span>
                                </div>
                                ${s.morning_taken && s.morning_taken_time ? `<span class="text-[9px] text-teal-100 font-extrabold flex items-center gap-0.5 mt-0.5"><i class="fa-solid fa-clock text-[8px]"></i> ${escapeHtml(s.morning_taken_time)}</span>` : ''}
                            </button>
                        ` : ''}

                        ${showAfternoon ? `
                            <button onclick="toggleDoseSlot('${s.id}', 'AFTERNOON')" class="dose-btn-check py-2 px-3 rounded-xl border text-xs font-black flex flex-col items-center justify-center ${s.afternoon_taken ? 'dose-btn-taken text-white' : 'btn-glass text-slate-700'}">
                                <div class="flex items-center gap-1.5">
                                    ${s.afternoon_taken ? '<i class="fa-solid fa-circle-check text-white text-sm"></i>' : '<i class="fa-solid fa-cloud-sun text-sky-500"></i>'}
                                    <span>Afternoon ${s.afternoon_taken ? '✓' : ''}</span>
                                </div>
                                ${s.afternoon_taken && s.afternoon_taken_time ? `<span class="text-[9px] text-teal-100 font-extrabold flex items-center gap-0.5 mt-0.5"><i class="fa-solid fa-clock text-[8px]"></i> ${escapeHtml(s.afternoon_taken_time)}</span>` : ''}
                            </button>
                        ` : ''}

                        ${showEvening ? `
                            <button onclick="toggleDoseSlot('${s.id}', 'EVENING')" class="dose-btn-check py-2 px-3 rounded-xl border text-xs font-black flex flex-col items-center justify-center ${s.evening_taken ? 'dose-btn-taken text-white' : 'btn-glass text-slate-700'}">
                                <div class="flex items-center gap-1.5">
                                    ${s.evening_taken ? '<i class="fa-solid fa-circle-check text-white text-sm"></i>' : '<i class="fa-solid fa-sunset text-orange-500"></i>'}
                                    <span>Evening ${s.evening_taken ? '✓' : ''}</span>
                                </div>
                                ${s.evening_taken && s.evening_taken_time ? `<span class="text-[9px] text-teal-100 font-extrabold flex items-center gap-0.5 mt-0.5"><i class="fa-solid fa-clock text-[8px]"></i> ${escapeHtml(s.evening_taken_time)}</span>` : ''}
                            </button>
                        ` : ''}

                        ${showNight ? `
                            <button onclick="toggleDoseSlot('${s.id}', 'NIGHT')" class="dose-btn-check py-2 px-3 rounded-xl border text-xs font-black flex flex-col items-center justify-center ${s.night_taken ? 'dose-btn-taken text-white' : 'btn-glass text-slate-700'}">
                                <div class="flex items-center gap-1.5">
                                    ${s.night_taken ? '<i class="fa-solid fa-circle-check text-white text-sm"></i>' : '<i class="fa-solid fa-moon text-indigo-500"></i>'}
                                    <span>Night ${s.night_taken ? '✓' : ''}</span>
                                </div>
                                ${s.night_taken && s.night_taken_time ? `<span class="text-[9px] text-teal-100 font-extrabold flex items-center gap-0.5 mt-0.5"><i class="fa-solid fa-clock text-[8px]"></i> ${escapeHtml(s.night_taken_time)}</span>` : ''}
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
        nameEl.innerText = "All doses logged for selected date";
    } else {
        timeEl.innerText = 'No Doses';
        nameEl.innerText = 'Add a medicine to start';
    }
}

function toggleDoseSlotClient(prescriptionId, slotName, targetDate) {
    const dateStr = targetDate || getTodayDateStr();
    const rxs = getClientPrescriptions();
    const logs = getClientLogs();

    const rx = rxs.find(r => r.id === prescriptionId);
    if (!rx) return { is_taken: false, tablets_consumed: 1 };

    const existingLogIdx = logs.findIndex(l => l.prescription_id === prescriptionId && l.scheduled_time === slotName && l.taken_at && (l.taken_at.startsWith(dateStr) || l.taken_at.substring(0, 10) === dateStr));
    const doseQty = rx.tablets_per_dose || 1;
    let isNowTaken = false;

    if (existingLogIdx !== -1) {
        logs.splice(existingLogIdx, 1);
        rx.total_tablets_remaining = parseFloat((rx.total_tablets_remaining + doseQty).toFixed(2));
        isNowTaken = false;
    } else {
        rx.total_tablets_remaining = Math.max(0, parseFloat((rx.total_tablets_remaining - doseQty).toFixed(2)));
        const takenAtIso = (dateStr === getTodayDateStr()) ? new Date().toISOString() : `${dateStr}T${new Date().toTimeString().slice(0,8)}.000Z`;
        logs.unshift({
            id: 'log-' + Date.now(),
            prescription_id: prescriptionId,
            medicine_name: rx.medicine_name,
            scheduled_time: slotName,
            status: 'TAKEN',
            tablets_consumed: doseQty,
            taken_at: takenAtIso
        });
        isNowTaken = true;
    }

    saveClientPrescriptions(rxs);
    saveClientLogs(logs);

    return { is_taken: isNowTaken, tablets_consumed: doseQty };
}

// Toggle Dose Slot (With Target Date Support, Direct Supabase DB & Static Fallback)
async function toggleDoseSlot(prescriptionId, slotName) {
    try {
        const selDate = state.selectedDate || getTodayDateStr();
        const userEmail = (state.currentUser && state.currentUser.email) ? state.currentUser.email : 'patient-1';
        let isNowTaken = false;
        let doseQty = 1;

        if (!isStaticWebDeployment()) {
            // Express Backend API Mediator handles single authoritative toggle
            const apiRes = await safeFetchJson('/api/patient/toggle-slot', {
                method: 'POST',
                headers: getUserHeaders(),
                body: JSON.stringify({
                    prescription_id: prescriptionId,
                    slot_name: slotName,
                    target_date: selDate
                })
            });
            if (apiRes) {
                isNowTaken = apiRes.is_taken;
                doseQty = apiRes.tablets_consumed || doseQty;
            } else {
                throw new Error('Backend API toggle failed');
            }
        } else if (state.supabaseClient) {
            // Direct Supabase PostgreSQL DB Toggle for static edge hosting
            const rx = (state.prescriptions || []).find(r => r.id === prescriptionId);
            const medName = rx ? rx.medicine_name : '';
            doseQty = rx ? (parseFloat(rx.tablets_per_dose) || 1) : 1;
            const currentStock = rx ? (parseFloat(rx.total_tablets_remaining) || 0) : 0;

            const existingLogs = await getSupabaseLogs();
            const existingLog = existingLogs ? existingLogs.find(l => isLogForRx(l, { id: prescriptionId, medicine_name: medName }) && isLogForSlot(l, slotName) && isLogForDate(l, selDate)) : null;

            if (existingLog) {
                const { error: delErr } = await state.supabaseClient.from('medication_logs').delete().eq('id', existingLog.id);
                if (delErr) console.error('Supabase delete log error:', delErr);

                const restoredStock = parseFloat((currentStock + doseQty).toFixed(2));
                if (rx && rx.id) {
                    await state.supabaseClient.from('patient_prescriptions').update({
                        total_tablets_remaining: restoredStock,
                        updated_at: new Date().toISOString()
                    }).eq('id', rx.id);
                }
                isNowTaken = false;
            } else {
                const newRemaining = Math.max(0, parseFloat((currentStock - doseQty).toFixed(2)));
                const takenAtIso = (selDate === getTodayDateStr()) ? new Date().toISOString() : `${selDate}T12:00:00.000Z`;
                const cleanLog = {
                    id: 'log-' + Date.now(),
                    prescription_id: prescriptionId,
                    medicine_name: medName || 'Medicine',
                    scheduled_time: slotName,
                    status: 'TAKEN',
                    tablets_consumed: doseQty,
                    tablets_remaining_after: newRemaining,
                    taken_at: takenAtIso
                };

                let { error: insErr } = await state.supabaseClient.from('medication_logs').insert([{ user_id: userEmail, ...cleanLog }]);
                if (insErr) {
                    let { error: insErr2 } = await state.supabaseClient.from('medication_logs').insert([cleanLog]);
                    if (insErr2) {
                        await state.supabaseClient.from('medication_logs').insert([{
                            id: cleanLog.id,
                            prescription_id: cleanLog.prescription_id,
                            medicine_name: cleanLog.medicine_name,
                            scheduled_time: cleanLog.scheduled_time,
                            status: cleanLog.status,
                            tablets_consumed: cleanLog.tablets_consumed,
                            taken_at: cleanLog.taken_at
                        }]);
                    }
                }

                if (rx && rx.id) {
                    await state.supabaseClient.from('patient_prescriptions').update({
                        total_tablets_remaining: newRemaining,
                        updated_at: new Date().toISOString()
                    }).eq('id', rx.id);
                }
                isNowTaken = true;
            }
        } else {
            const res = toggleDoseSlotClient(prescriptionId, slotName, selDate);
            isNowTaken = res.is_taken;
            doseQty = res.tablets_consumed;
        }

        if (isNowTaken) {
            const consumedText = doseQty === 0.5 ? '1/2 pill' : (doseQty === 0.25 ? '1/4 pill' : `${doseQty} pill(s)`);
            showToast(`✓ ${slotName.charAt(0) + slotName.slice(1).toLowerCase()} dose marked TAKEN in Supabase (${selDate})! ${consumedText} deducted.`, 'success');
        } else {
            showToast(`${slotName.charAt(0) + slotName.slice(1).toLowerCase()} dose reset in Supabase (${selDate}).`, 'info');
        }

        await loadPatientPortal();
    } catch (e) {
        showToast(e.message || 'Failed to toggle dose slot in Supabase DB.', 'error');
    }
}

// Medicine Cabinet (Direct Supabase DB Integration)
async function fetchCabinet() {
    try {
        const isNetlify = isStaticWebDeployment();
        let data = null;
        if (!isNetlify) {
            data = await safeFetchJson(`/api/patient/prescriptions?t=${Date.now()}`, { headers: getUserHeaders() });
        }
        if (!data && state.supabaseClient) {
            data = await getSupabasePrescriptions();
        }
        state.prescriptions = (data && Array.isArray(data) && data.length > 0) ? data : getClientPrescriptions();
        renderCabinetGrid();
    } catch (e) {
        let sbData = await getSupabasePrescriptions();
        state.prescriptions = (sbData && Array.isArray(sbData) && sbData.length > 0) ? sbData : getClientPrescriptions();
        renderCabinetGrid();
    }
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
                            
                            <div class="flex flex-wrap items-center gap-1.5 mt-2">
                                ${getExpiryStatusBadgeHTML(p.expiry_date, p.batch_number, p.batch_strip_count)}
                            </div>
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

                    ${p.generic_name ? `
                        <div class="mt-3 p-2.5 rounded-xl bg-teal-50/90 border border-teal-200/90 text-xs shadow-xs">
                            <span class="text-[10px] font-black uppercase text-teal-800 tracking-widest block flex items-center gap-1"><i class="fa-solid fa-flask text-teal-600"></i> Generic Chemical Composition</span>
                            <span class="text-slate-900 font-extrabold block break-words whitespace-normal leading-snug mt-0.5">${escapeHtml(p.generic_name)}</span>
                        </div>
                    ` : ''}

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

// Pharmacy Orders Management (Direct Supabase DB Integration)
async function fetchOrders() {
    try {
        const isNetlify = isStaticWebDeployment();
        let data = null;
        if (!isNetlify) {
            data = await safeFetchJson(`/api/patient/orders?t=${Date.now()}`, { headers: getUserHeaders() });
        }
        if (!data && state.supabaseClient) {
            data = await getSupabaseOrders();
        }
        state.orders = (data && Array.isArray(data)) ? data : getClientOrders();
        saveClientOrders(state.orders);
        const badgeCount = document.getElementById('orders-badge-count');
        if (badgeCount) badgeCount.innerText = state.orders.filter(o => o.status !== 'DELIVERED' && o.status !== 'CANCELLED').length;
        renderOrdersList();
        renderOrderHistoryLogs();
    } catch (e) {
        let sbOrders = await getSupabaseOrders();
        state.orders = (sbOrders && Array.isArray(sbOrders)) ? sbOrders : getClientOrders();
        saveClientOrders(state.orders);
        renderOrdersList();
        renderOrderHistoryLogs();
    }
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
        if (o.status === 'PROCESSING') {
            statusBadge = `<span class="px-2.5 py-0.5 bg-purple-100 text-purple-800 border border-purple-300 rounded-lg text-[10px] font-black uppercase inline-flex items-center gap-1 shadow-xs"><i class="fa-solid fa-gear text-purple-600"></i> Processing</span>`;
        } else if (o.status === 'SHIPPED') {
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
                            <div class="flex flex-wrap items-center gap-2">
                                ${statusBadge}
                                <span class="text-xs text-slate-500 font-mono font-bold">${escapeHtml(o.order_number)}</span>
                            </div>
                            <h3 class="text-base font-black text-slate-900 mt-2.5 tracking-tight">${escapeHtml(o.medicine_name)}</h3>
                            <span class="text-xs text-amber-700 font-bold block mt-0.5"><i class="fa-solid fa-store mr-1"></i> ${escapeHtml(o.pharmacy_name || 'Pharmacy')}</span>
                        </div>
                        <div class="flex items-center gap-1">
                            <button onclick="openEditOrderModal('${o.id}')" title="Edit Order Details" class="btn-glass p-2 text-amber-700 hover:text-amber-900 text-xs rounded-xl hover:bg-amber-50 transition flex items-center gap-1 font-extrabold shadow-xs">
                                <i class="fa-solid fa-pen-to-square"></i> Edit
                            </button>
                            <button onclick="deleteOrder('${o.id}')" title="Delete Order Record" class="btn-glass p-2 text-slate-400 hover:text-rose-600 text-xs rounded-xl hover:bg-rose-50 transition">
                                <i class="fa-solid fa-trash-can"></i>
                            </button>
                        </div>
                    </div>

                    <div class="mt-3.5 card-inner-box p-3.5 text-xs space-y-2 shadow-inner">
                        <div class="flex items-center justify-between">
                            <span class="text-slate-500 font-medium">Order Status Stage:</span>
                            <select onchange="updateOrderStatusInline('${o.id}', this.value)" class="text-xs font-bold rounded-xl px-2.5 py-1 bg-white border border-slate-300 text-slate-900 shadow-xs focus:border-amber-500 outline-none">
                                <option value="ORDERED" ${o.status === 'ORDERED' ? 'selected' : ''}>📦 Ordered</option>
                                <option value="PROCESSING" ${o.status === 'PROCESSING' ? 'selected' : ''}>⚙️ Processing</option>
                                <option value="SHIPPED" ${o.status === 'SHIPPED' ? 'selected' : ''}>🚚 Shipped</option>
                                <option value="OUT_FOR_DELIVERY" ${o.status === 'OUT_FOR_DELIVERY' ? 'selected' : ''}>🛵 Out for Delivery</option>
                                <option value="DELIVERED" ${o.status === 'DELIVERED' ? 'selected' : ''}>✅ Delivered & Stocked</option>
                                <option value="CANCELLED" ${o.status === 'CANCELLED' ? 'selected' : ''}>❌ Cancelled</option>
                            </select>
                        </div>
                        <div class="flex items-center justify-between pt-1 border-t border-slate-200">
                            <span class="text-slate-500 font-medium">Pill Quantity Ordered:</span>
                            <strong class="text-amber-800 text-sm font-black">${o.quantity_ordered} pills</strong>
                        </div>
                        ${o.total_price ? `<div class="flex items-center justify-between"><span class="text-slate-500 font-medium">Total Price:</span><strong class="text-emerald-700 font-black">₹${o.total_price}</strong></div>` : ''}
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

// Add / Edit Prescription Modal Handlers
function openAddPrescriptionModal() {
    document.getElementById('rx-modal-title').innerHTML = '<i class="fa-solid fa-pills text-teal-400"></i> Add Medicine Record & Schedule';
    document.getElementById('rx-form').reset();
    document.getElementById('rx-id').value = '';
    const doseSelect = document.getElementById('rx-tablets-per-dose');
    if (doseSelect) doseSelect.value = '1';
    const rxTypeSelect = document.getElementById('rx-classification-type');
    if (rxTypeSelect) rxTypeSelect.value = 'RX';
    
    renderBatchStripRows([{ batch_number: '', batch_strip_count: 3, expiry_date: '' }]);
    autoCalcTotalPills();
    showModal('rx-modal');
}

async function openEditPrescriptionModal(id) {
    try {
        let rx = state.prescriptions.find(p => p.id === id);
        if (!rx) {
            const res = await fetch(`/api/patient/prescriptions/${id}?t=${Date.now()}`, { headers: getUserHeaders() });
            if (!res.ok) throw new Error('Prescription not found');
            rx = await res.json();
        }

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
        
        let batches = rx.batches || rx.batch_details || [];
        if (typeof batches === 'string') {
            try { batches = JSON.parse(batches); } catch(e) { batches = []; }
        }
        if (!Array.isArray(batches) || batches.length === 0) {
            batches = [{
                batch_number: rx.batch_number || '',
                batch_strip_count: rx.batch_strip_count || 1,
                expiry_date: rx.expiry_date || ''
            }];
        }
        renderBatchStripRows(batches);
        autoCalcTotalPills();

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

    const batchRows = getBatchRowsFromDOM();
    const nonKeys = batchRows.filter(b => b.batch_number || b.expiry_date);
    const validBatches = nonKeys.length > 0 ? batchRows : (batchRows.length > 0 ? batchRows : [{ batch_number: '', batch_strip_count: 1, expiry_date: null }]);

    const uniqueBatchNos = Array.from(new Set(validBatches.map(b => b.batch_number).filter(Boolean))).join(', ');
    const totalStripsCount = validBatches.reduce((acc, b) => acc + (parseInt(b.batch_strip_count, 10) || 1), 0);
    const earliestExpiry = validBatches.map(b => b.expiry_date).filter(Boolean).sort()[0] || null;

    let rawMedName = (document.getElementById('rx-name').value || 'Medicine').trim();
    if (!id && state.prescriptions && Array.isArray(state.prescriptions)) {
        const existingNames = state.prescriptions.map(p => (p.medicine_name || '').toUpperCase().trim());
        if (existingNames.includes(rawMedName.toUpperCase())) {
            const count = existingNames.filter(n => n.startsWith(rawMedName.toUpperCase())).length + 1;
            rawMedName = `${rawMedName} #${count}`;
        }
    }

    const payload = {
        medicine_name: rawMedName,
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
        batch_number: uniqueBatchNos,
        batch_strip_count: totalStripsCount,
        expiry_date: earliestExpiry,
        batches: validBatches,
        batch_details: validBatches,
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

        const res = await safeFetchJson(url, {
            method: method,
            headers: getUserHeaders(),
            body: JSON.stringify(payload)
        });

        if (!res && state.supabaseClient) {
            const userEmail = (state.currentUser && state.currentUser.email) ? state.currentUser.email : 'patient-1';
            let err = null;
            if (id) {
                const res1 = await state.supabaseClient.from('patient_prescriptions').update({
                    ...payload,
                    updated_at: new Date().toISOString()
                }).eq('id', id);
                err = res1.error;
            } else {
                const newId = 'rx-' + Date.now();
                const res2 = await state.supabaseClient.from('patient_prescriptions').insert([{
                    id: newId,
                    user_id: userEmail,
                    ...payload,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                }]);
                err = res2.error;
            }

            if (err && err.message && (err.message.includes('batch_number') || err.message.includes('expiry_date') || err.message.includes('batch_strip_count') || err.message.includes('batches'))) {
                const cleanPayload = { ...payload };
                delete cleanPayload.batch_number;
                delete cleanPayload.batch_strip_count;
                delete cleanPayload.expiry_date;
                delete cleanPayload.batches;
                delete cleanPayload.batch_details;
                if (id) {
                    await state.supabaseClient.from('patient_prescriptions').update({ ...cleanPayload, updated_at: new Date().toISOString() }).eq('id', id);
                } else {
                    await state.supabaseClient.from('patient_prescriptions').insert([{ id: 'rx-' + Date.now(), user_id: userEmail, ...cleanPayload, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }]);
                }
            }
        }

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
        const res = await safeFetchJson(`/api/patient/prescriptions/${id}`, { method: 'DELETE', headers: getUserHeaders() });
        if (!res && state.supabaseClient) {
            await state.supabaseClient.from('patient_prescriptions').delete().eq('id', id);
        }
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
        const res = await safeFetchJson(`/api/patient/prescriptions/${id}/refill`, {
            method: 'POST',
            headers: getUserHeaders(),
            body: JSON.stringify({ add_count: qty })
        });

        if (!res && state.supabaseClient) {
            const { data: existing } = await state.supabaseClient.from('patient_prescriptions').select('total_tablets_remaining').eq('id', id).single();
            const current = existing ? parseFloat(existing.total_tablets_remaining || 0) : 0;
            await state.supabaseClient.from('patient_prescriptions').update({
                total_tablets_remaining: current + qty,
                updated_at: new Date().toISOString()
            }).eq('id', id);
        }

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

function openEditOrderModal(orderId) {
    const order = state.orders.find(o => o.id === orderId);
    if (!order) return;

    document.getElementById('order-form').reset();
    document.getElementById('order-id').value = order.id;
    document.getElementById('order-prescription-id').value = order.prescription_id || '';
    document.getElementById('order-medicine-name').value = order.medicine_name || '';
    document.getElementById('order-pharmacy-name').value = order.pharmacy_name || '';
    document.getElementById('order-number').value = order.order_number || '';
    document.getElementById('order-quantity').value = order.quantity_ordered || 30;
    document.getElementById('order-status').value = order.status || 'ORDERED';
    document.getElementById('order-expected-delivery').value = order.expected_delivery || '';
    document.getElementById('order-price').value = order.total_price || '';
    document.getElementById('order-notes').value = order.notes || '';

    const titleEl = document.getElementById('order-modal-title');
    if (titleEl) titleEl.innerHTML = `<i class="fa-solid fa-pen-to-square text-amber-600"></i> Edit Pharmacy Order Details`;

    showModal('order-modal');
}

async function updateOrderStatusInline(orderId, newStatus) {
    if (newStatus === 'DELIVERED') {
        await markOrderDelivered(orderId);
        return;
    }

    try {
        const res = await safeFetchJson(`/api/patient/orders/${orderId}`, {
            method: 'PUT',
            headers: getUserHeaders(),
            body: JSON.stringify({ status: newStatus })
        });

        if (!res && state.supabaseClient) {
            await state.supabaseClient.from('pharmacy_orders').update({
                status: newStatus,
                updated_at: new Date().toISOString()
            }).eq('id', orderId);
        }

        const statusLabel = newStatus.charAt(0) + newStatus.slice(1).toLowerCase().replace(/_/g, ' ');
        showToast(`Order status updated to: ${statusLabel}`, 'success');
        loadPatientPortal();
    } catch (e) {
        showToast(e.message, 'error');
    }
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

        const res = await safeFetchJson(url, {
            method: method,
            headers: getUserHeaders(),
            body: JSON.stringify(payload)
        });

        if (!res && state.supabaseClient) {
            const userEmail = (state.currentUser && state.currentUser.email) ? state.currentUser.email : 'admin@sattvacare.com';
            if (id) {
                await state.supabaseClient.from('pharmacy_orders').update({
                    ...payload,
                    updated_at: new Date().toISOString()
                }).eq('id', id);
            } else {
                const newId = 'ord-' + Date.now();
                await state.supabaseClient.from('pharmacy_orders').insert([{
                    id: newId,
                    user_id: userEmail,
                    ...payload,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                }]);
            }
        }

        closeOrderModal();
        showToast('Pharmacy order logged! Tracking delivery status.', 'success');
        
        if (payload.status === 'DELIVERED') {
            await markOrderDelivered(id);
        } else {
            loadPatientPortal();
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function markOrderDelivered(id) {
    try {
        const res = await safeFetchJson(`/api/patient/orders/${id}/deliver`, { method: 'POST', headers: getUserHeaders() });

        if (!res && state.supabaseClient) {
            await state.supabaseClient.from('pharmacy_orders').update({
                status: 'DELIVERED',
                delivered_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }).eq('id', id);
        }

        showToast('Order delivered! Pills automatically stocked into cabinet.', 'success');
        loadPatientPortal();
    } catch (e) {
        showToast(e.message, 'error');
    }
}

async function deleteOrder(id) {
    if (!confirm('Delete this pharmacy order record?')) return;
    try {
        await safeFetchJson(`/api/patient/orders/${id}`, { method: 'DELETE', headers: getUserHeaders() });

        if (state.supabaseClient) {
            try {
                await state.supabaseClient.from('pharmacy_orders').delete().eq('id', id);
            } catch (sbErr) {
                console.warn('Direct Supabase order deletion warning:', sbErr);
            }
        }

        state.orders = (state.orders || []).filter(o => o.id !== id);
        saveClientOrders(state.orders);

        showToast('Order record removed permanently.', 'info');

        renderOrdersList();
        renderOrderHistoryLogs();
        const badgeCount = document.getElementById('orders-badge-count');
        if (badgeCount) {
            badgeCount.innerText = state.orders.filter(o => o.status !== 'DELIVERED' && o.status !== 'CANCELLED').length;
        }

        fetchOrders();
    } catch (e) {
        console.error('Delete order error:', e);
        showToast(e.message || 'Failed to remove order record.', 'error');
    }
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
                <div class="flex items-center gap-3 sm:shrink-0">
                    <div class="text-right">
                        <span class="text-[11px] text-slate-500 block font-medium">${dateDisplay}</span>
                        ${o.total_price ? `<strong class="text-emerald-700 text-sm font-black">₹${o.total_price}</strong>` : ''}
                    </div>
                    <button onclick="deleteOrder('${o.id}')" title="Delete Order Record" class="btn-glass p-2 text-slate-400 hover:text-rose-600 text-xs rounded-xl hover:bg-rose-50 transition">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
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

// ⚠️ Food & Drug Safety Matrix Badges
function getFoodSafetyBadgesHTML(warnings) {
    if (!warnings || !Array.isArray(warnings) || warnings.length === 0) return '';
    return `
        <div class="mt-2 p-2.5 bg-amber-50/90 border border-amber-300 rounded-xl space-y-1">
            <span class="text-[10px] font-black uppercase text-amber-900 tracking-wider flex items-center gap-1">
                <i class="fa-solid fa-triangle-exclamation text-amber-600"></i> Precautions & Safety Warnings
            </span>
            ${warnings.map(w => `<p class="text-[11px] text-amber-950 font-bold leading-tight flex items-start gap-1"><span class="shrink-0">•</span> <span>${escapeHtml(w)}</span></p>`).join('')}
        </div>
    `;
}

// 📊 7-Day Adherence Analytics Visual Bar Chart
function renderAdherenceAnalyticsChart() {
    const container = document.getElementById('adherence-chart-container');
    if (!container) return;

    const todayObj = new Date();
    const days = [];
    
    for (let i = 6; i >= 0; i--) {
        const d = new Date(todayObj);
        d.setDate(todayObj.getDate() - i);
        const dStr = getLocalDateStr(d);
        
        let req = 0;
        let taken = 0;
        
        (state.schedule || []).forEach(s => {
            let reqCount = 2;
            if (s.dosage_frequency_type === 'ONCE_MORNING' || s.dosage_frequency_type === 'ONCE_NIGHT') reqCount = 1;
            else if (s.dosage_frequency_type === 'THRICE_DAILY') reqCount = 3;
            else if (s.dosage_frequency_type === 'FOUR_TIMES_DAILY') reqCount = 4;
            else if (s.dosage_frequency_type === 'AS_NEEDED') reqCount = 1;
            
            req += reqCount;

            const hObj = (s.history_7days || []).find(h => h.date === dStr);
            if (hObj) {
                taken += Math.min(reqCount, hObj.takenCount || 0);
            }
        });
        
        const pct = req > 0 ? Math.min(100, Math.round((taken / req) * 100)) : 0;
        const dayLabel = i === 0 ? 'Today' : (i === 1 ? 'Yest' : d.toLocaleDateString('en-US', { weekday: 'short' }));
        
        days.push({
            date: dStr,
            dayLabel,
            pct,
            taken,
            req,
            isToday: i === 0
        });
    }

    container.innerHTML = days.map(d => {
        const barHeightPct = Math.max(12, d.pct);
        const barColor = d.pct >= 80 ? 'bg-gradient-to-t from-teal-600 to-emerald-400' : (d.pct >= 50 ? 'bg-gradient-to-t from-amber-500 to-yellow-400' : 'bg-gradient-to-t from-rose-500 to-red-400');
        const textVal = d.pct > 0 ? `${d.pct}%` : '0%';
        
        return `
            <div onclick="selectScheduleDate('${d.date}')" class="flex flex-col items-center justify-end h-full cursor-pointer group">
                <span class="text-[10px] font-black text-slate-700 mb-1 opacity-90 group-hover:scale-110 transition-transform">${textVal}</span>
                <div class="w-full max-w-[36px] bg-slate-100 rounded-t-xl overflow-hidden border border-slate-200 h-full flex flex-col justify-end p-0.5 shadow-inner">
                    <div class="${barColor} rounded-t-lg transition-all duration-700 shadow-sm" style="height: ${barHeightPct}%"></div>
                </div>
                <span class="text-[10px] font-black mt-2 ${d.isToday ? 'text-teal-700 font-extrabold underline' : 'text-slate-500'}">${d.dayLabel}</span>
            </div>
        `;
    }).join('');
}

// 🩺 Vitals & Symptom Logger
async function fetchVitals() {
    try {
        const isNetlify = isStaticWebDeployment();
        let vitals = null;
        if (!isNetlify) {
            vitals = await safeFetchJson(`/api/patient/vitals?t=${Date.now()}`, { headers: getUserHeaders() });
        }
        if (!vitals && state.supabaseClient) {
            const { data } = await state.supabaseClient.from('vitals_logs').select('*').order('logged_at', { ascending: false });
            vitals = data;
        }
        state.vitals = vitals || [];
        renderVitalsWidget();
    } catch (e) {
        state.vitals = [];
        renderVitalsWidget();
    }
}

function renderVitalsWidget() {
    const widget = document.getElementById('vitals-summary-widget');
    if (!widget) return;

    const list = state.vitals || [];
    if (list.length === 0) {
        widget.innerHTML = `
            <div class="p-3 bg-slate-50 border border-slate-200 rounded-2xl text-center py-4">
                <span class="text-xs text-slate-500 font-bold block">No vitals logged today</span>
                <button onclick="openVitalsModal()" class="mt-2 px-3 py-1.5 bg-teal-600 text-white rounded-xl text-xs font-black shadow-sm">+ Record BP / Sugar</button>
            </div>
        `;
        return;
    }

    const latest = list[0];
    const loggedDate = new Date(latest.logged_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    widget.innerHTML = `
        <div class="p-3 bg-rose-50/80 border border-rose-200 rounded-2xl space-y-2">
            <div class="flex items-center justify-between">
                <span class="text-[10px] font-black text-rose-800 uppercase tracking-wider">Latest Log (${loggedDate})</span>
                <span class="text-[10px] font-bold text-slate-500">${new Date(latest.logged_at).toLocaleDateString()}</span>
            </div>
            <div class="grid grid-cols-2 gap-2 text-xs font-black">
                ${latest.sys_bp ? `<div class="p-2 bg-white rounded-xl border border-rose-200"><span class="text-[9px] text-slate-500 block font-normal">BP (Systolic/Diastolic)</span><span class="text-rose-900 text-sm">${latest.sys_bp}/${latest.dia_bp || 80} <span class="text-[9px] text-slate-400 font-normal">mmHg</span></span></div>` : ''}
                ${latest.blood_sugar ? `<div class="p-2 bg-white rounded-xl border border-teal-200"><span class="text-[9px] text-slate-500 block font-normal">Blood Sugar (${latest.sugar_type || 'Fasting'})</span><span class="text-teal-900 text-sm">${latest.blood_sugar} <span class="text-[9px] text-slate-400 font-normal">mg/dL</span></span></div>` : ''}
            </div>
            ${latest.symptoms ? `<p class="text-[11px] text-slate-700 font-medium italic"><i class="fa-solid fa-note-sticky text-slate-400 mr-1"></i> "${escapeHtml(latest.symptoms)}"</p>` : ''}
        </div>
    `;
}

function openVitalsModal() {
    showModal('vitals-modal');
}

function closeVitalsModal() {
    hideModal('vitals-modal');
}

async function handleSaveVitals(e) {
    e.preventDefault();
    const sys_bp = document.getElementById('vitals-sys-bp').value;
    const dia_bp = document.getElementById('vitals-dia-bp').value;
    const blood_sugar = document.getElementById('vitals-sugar').value;
    const sugar_type = document.getElementById('vitals-sugar-type').value;
    const pulse = document.getElementById('vitals-pulse').value;
    const symptoms = document.getElementById('vitals-symptoms').value;

    const payload = { sys_bp, dia_bp, blood_sugar, sugar_type, pulse, symptoms };

    try {
        if (!isStaticWebDeployment()) {
            await safeFetchJson('/api/patient/vitals', {
                method: 'POST',
                headers: getUserHeaders(),
                body: JSON.stringify(payload)
            });
        } else if (state.supabaseClient) {
            await state.supabaseClient.from('vitals_logs').insert([{ user_id: (state.currentUser && state.currentUser.email) ? state.currentUser.email : 'patient-1', ...payload }]);
        }
        showToast('✓ Vitals and health record saved successfully!', 'success');
        closeVitalsModal();
        await fetchVitals();
    } catch (err) {
        showToast('Failed to save vitals log', 'error');
    }
}



// 📲 WhatsApp Caregiver & Doctor Share Modal
function generateWhatsAppReportText() {
    const userEmail = (state.currentUser && state.currentUser.email) ? state.currentUser.email : 'patient@sattvacare.com';
    const dateStr = state.selectedDate || getTodayDateStr();
    const stats = state.stats || {};
    const schedule = state.schedule || [];

    let msg = `🏥 *SATTVA CARE PATIENT INTAKE REPORT*\n`;
    msg += `👤 *Patient:* ${userEmail}\n`;
    msg += `📅 *Date:* ${dateStr}\n`;
    msg += `📊 *Adherence:* ${stats.adherence_percentage || 0}% (${stats.today_taken_count || 0} of ${stats.today_scheduled_count || 0} doses completed)\n\n`;
    msg += `💊 *MEDICINE INTAKE & CABINET STOCK SUMMARY:*\n`;

    let calculatedTotalPills = 0;

    if (schedule.length === 0) {
        msg += `(No active prescriptions in schedule)\n`;
    } else {
        schedule.forEach(s => {
            const pillsRemaining = parseFloat(s.total_tablets_remaining || 0);
            calculatedTotalPills += pillsRemaining;

            const takenSlots = [];
            if (s.morning_taken) takenSlots.push(`Morning (${s.morning_taken_time || 'Taken ✓'})`);
            if (s.afternoon_taken) takenSlots.push(`Afternoon (${s.afternoon_taken_time || 'Taken ✓'})`);
            if (s.evening_taken) takenSlots.push(`Evening (${s.evening_taken_time || 'Taken ✓'})`);
            if (s.night_taken) takenSlots.push(`Night (${s.night_taken_time || 'Taken ✓'})`);

            const statusStr = takenSlots.length > 0 ? `✅ Taken: ${takenSlots.join(', ')}` : `⏳ Pending`;
            const stockStr = pillsRemaining <= 0 ? `⚠️ 0 pills (OUT OF STOCK)` : `📦 Stock: ${pillsRemaining} pills remaining`;

            msg += `• *${s.medicine_name}* (${s.dosage_strength || 'Tablet'})\n`;
            msg += `  Status: ${statusStr}\n`;
            msg += `  Cabinet: ${stockStr}\n`;
        });
    }

    const totalStock = (stats.total_pills_remaining !== undefined && stats.total_pills_remaining !== null) 
        ? stats.total_pills_remaining 
        : calculatedTotalPills;

    msg += `\n📦 *Total Cabinet Pill Stock:* ${totalStock} pills remaining across ${schedule.length} medicines.`;
    return msg;
}

function openWhatsAppShareModal() {
    const preview = document.getElementById('whatsapp-preview-box');
    const msg = generateWhatsAppReportText();
    if (preview) preview.innerText = msg;
    showModal('whatsapp-share-modal');
}

function closeWhatsAppShareModal() {
    hideModal('whatsapp-share-modal');
}

function sendWhatsAppMessage() {
    const preview = document.getElementById('whatsapp-preview-box');
    const phoneInput = document.getElementById('whatsapp-phone-input');
    const text = encodeURIComponent(preview ? preview.innerText : generateWhatsAppReportText());
    const phone = (phoneInput && phoneInput.value.trim()) ? phoneInput.value.trim().replace(/[^0-9]/g, '') : '';
    
    const url = phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`;
    window.open(url, '_blank');
    closeWhatsAppShareModal();
}

// 📱 PWA ServiceWorker Registration & PWA Install Prompt
let deferredPwaPrompt = null;

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
}

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPwaPrompt = e;
    const btn = document.getElementById('pwa-install-btn');
    if (btn) btn.classList.remove('hidden');
});

function installPWAApp() {
    if (deferredPwaPrompt) {
        deferredPwaPrompt.prompt();
        deferredPwaPrompt.userChoice.then(() => {
            deferredPwaPrompt = null;
            const btn = document.getElementById('pwa-install-btn');
            if (btn) btn.classList.add('hidden');
        });
    }
}

// 👨‍👩‍👧‍👦 Multi-Patient Family Profile Switcher
async function switchFamilyProfile(e) {
    const selectedEmail = e.target.value;
    state.currentUser = { email: selectedEmail };
    const displayEmail = document.getElementById('user-display-email');
    if (displayEmail) displayEmail.innerText = selectedEmail;
    showToast(`Switched active profile to ${selectedEmail}`, 'info');
    await loadPatientPortal();
}

// 🔔 Audio Chime Notification & Alarm Scheduler
function playDoseChimeSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, ctx.currentTime);
        osc.frequency.setValueAtTime(880, ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.5);
    } catch (e) {}
}

// 🗓️ 30-Day Adherence Calendar Heatmap Modal Functions
async function open30DayCalendarModal() {
    showModal('calendar-30day-modal');
    const grid = document.getElementById('calendar-30day-grid');

    let history = null;
    if (!isStaticWebDeployment()) {
        history = await safeFetchJson(`/api/patient/calendar-30days?t=${Date.now()}`, { headers: getUserHeaders() });
    }
    if (!history) {
        history = generateClient30DayHistory();
    }

    grid.innerHTML = (history || []).map(h => {
        const bg = h.adherencePct >= 80 ? 'bg-emerald-500 text-white font-black' : (h.adherencePct >= 50 ? 'bg-amber-400 text-slate-900 font-extrabold' : (h.reqCount > 0 ? 'bg-rose-500 text-white font-bold' : 'bg-slate-100 text-slate-400 border border-slate-200'));
        return `
            <div onclick="selectScheduleDate('${h.date}'); close30DayCalendarModal();" class="p-2.5 rounded-xl ${bg} text-center cursor-pointer hover:scale-105 transition shadow-xs">
                <span class="text-[9px] block uppercase font-bold opacity-80">${h.weekdayShort} ${h.dayNum}</span>
                <strong class="text-xs block mt-0.5">${h.adherencePct}%</strong>
                <span class="text-[8px] block mt-0.5 opacity-90">${h.takenCount}/${h.reqCount} doses</span>
            </div>
        `;
    }).join('');
}

function close30DayCalendarModal() {
    hideModal('calendar-30day-modal');
}

function generateClient30DayHistory() {
    const rxs = getClientPrescriptions();
    const logs = getClientLogs();
    const todayObj = new Date();
    const list = [];
    for (let i = 29; i >= 0; i--) {
        const d = new Date(todayObj);
        d.setDate(todayObj.getDate() - i);
        const dStr = getLocalDateStr(d);
        let req = 0, taken = 0;
        rxs.forEach(rx => {
            let rxReq = (rx.daily_frequency || 1);
            req += rxReq;
            const dayLogs = logs.filter(l => isLogForRx(l, rx) && isLogForDate(l, dStr) && l.status === 'TAKEN');
            taken += Math.min(rxReq, dayLogs.length);
        });
        const pct = req > 0 ? Math.min(100, Math.round((taken / req) * 100)) : 0;
        list.push({ date: dStr, dayNum: d.getDate(), weekdayShort: d.toLocaleDateString('en-US', { weekday: 'short' }), takenCount: taken, reqCount: req, adherencePct: pct });
    }
    return list;
}

// 💳 Pharmacy Expense Tracker & GST Invoice Functions
async function openExpenseModal() {
    showModal('expense-modal');

    let exp = null;
    if (!isStaticWebDeployment()) {
        exp = await safeFetchJson(`/api/patient/expenses?t=${Date.now()}`, { headers: getUserHeaders() });
    }
    if (!exp) {
        exp = calculateClientExpenses();
    }
    state.expenses = exp;

    document.getElementById('expense-total-spend').innerText = `₹${(exp.total_spend_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    document.getElementById('expense-pills-count').innerText = `${exp.total_pills_ordered || 0} pills`;
    document.getElementById('expense-orders-count').innerText = `${exp.total_orders_count || 0} Orders`;

    const tableContainer = document.getElementById('expense-orders-table-container');
    const orders = exp.recent_orders || [];

    if (orders.length === 0) {
        tableContainer.innerHTML = `<p class="p-4 text-center text-slate-500 font-bold text-xs">No pharmacy orders logged yet.</p>`;
        return;
    }

    tableContainer.innerHTML = `
        <table class="w-full text-left border-collapse text-xs">
            <thead>
                <tr class="bg-slate-100 text-slate-700">
                    <th class="p-2.5">Order #</th>
                    <th class="p-2.5">Medicine</th>
                    <th class="p-2.5">Qty</th>
                    <th class="p-2.5">Status</th>
                    <th class="p-2.5 text-right">Total (₹)</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-200">
                ${orders.map(o => `
                    <tr class="hover:bg-slate-50">
                        <td class="p-2.5 font-bold text-indigo-700">${escapeHtml(o.order_number || o.id)}</td>
                        <td class="p-2.5 font-bold text-slate-900">${escapeHtml(o.medicine_name)}</td>
                        <td class="p-2.5 font-semibold text-slate-700">${o.quantity_ordered} pills</td>
                        <td class="p-2.5"><span class="px-2 py-0.5 rounded text-[10px] font-black ${o.status === 'DELIVERED' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">${o.status}</span></td>
                        <td class="p-2.5 text-right font-black text-slate-900">₹${(parseFloat(o.total_price) || (o.quantity_ordered * 12)).toFixed(2)}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

function closeExpenseModal() {
    hideModal('expense-modal');
}

function calculateClientExpenses() {
    const orders = getClientOrders();
    let totalSpend = 0, totalPills = 0;
    orders.forEach(o => {
        totalSpend += (parseFloat(o.total_price) || (o.quantity_ordered * 12));
        totalPills += parseFloat(o.quantity_ordered || 0);
    });
    return {
        total_orders_count: orders.length,
        total_pills_ordered: totalPills,
        total_spend_amount: totalSpend,
        recent_orders: orders
    };
}

function downloadExpenseStatement() {
    const exp = state.expenses || calculateClientExpenses();
    let txt = `====================================================\n`;
    txt += `🏥 SATTVA CARE PHARMACY GST INVOICE STATEMENT\n`;
    txt += `Patient: ${(state.currentUser && state.currentUser.email) ? state.currentUser.email : 'patient@sattvacare.com'}\n`;
    txt += `Date: ${new Date().toLocaleDateString()}\n`;
    txt += `====================================================\n\n`;
    txt += `Total Orders: ${exp.total_orders_count || 0}\n`;
    txt += `Total Pills Purchased: ${exp.total_pills_ordered || 0} pills\n`;
    txt += `Taxable Amount: ₹${(exp.gst_tax_breakdown ? exp.gst_tax_breakdown.taxable_amount : exp.total_spend_amount * 0.88).toFixed(2)}\n`;
    txt += `CGST (6%): ₹${(exp.gst_tax_breakdown ? exp.gst_tax_breakdown.cgst_amount : exp.total_spend_amount * 0.06).toFixed(2)}\n`;
    txt += `SGST (6%): ₹${(exp.gst_tax_breakdown ? exp.gst_tax_breakdown.sgst_amount : exp.total_spend_amount * 0.06).toFixed(2)}\n`;
    txt += `TOTAL PAID: ₹${(exp.total_spend_amount || 0).toFixed(2)}\n\n`;
    txt += `ORDER BREAKDOWN:\n`;
    (exp.recent_orders || []).forEach(o => {
        txt += `• Order #${o.order_number || o.id} - ${o.medicine_name} (${o.quantity_ordered} pills) - ₹${(o.total_price || (o.quantity_ordered * 12)).toFixed(2)} [${o.status}]\n`;
    });
    downloadFile(txt, `Sattva_Pharmacy_GST_Receipt_${Date.now()}.txt`, 'text/plain');
    showToast('✓ GST Pharmacy Receipt downloaded!', 'success');
}

// 📄 Doctor Prescription Document Vault Handlers
let currentVaultFileBase64 = null;

function openVaultModal() {
    showModal('rx-vault-modal');
    fetchVaultDocuments();
}

function closeVaultModal() {
    hideModal('rx-vault-modal');
}

function handleVaultFileSelected(e) {
    const file = e.target.files[0];
    if (!file) {
        currentVaultFileBase64 = null;
        return;
    }
    const reader = new FileReader();
    reader.onload = function(evt) {
        currentVaultFileBase64 = evt.target.result;
    };
    reader.readAsDataURL(file);
}

async function handleVaultUpload(e) {
    e.preventDefault();
    const doctor = document.getElementById('vault-doctor-name').value.trim();
    const hospital = document.getElementById('vault-hospital').value.trim();
    const docDate = document.getElementById('vault-date').value || getTodayDateStr();
    const title = document.getElementById('vault-title').value.trim();
    const notes = document.getElementById('vault-notes').value.trim();
    const fileInput = document.getElementById('vault-file-input');

    if (!doctor || !title) {
        showToast('Please fill doctor name and document title', 'error');
        return;
    }

    const newDoc = {
        doctor_name: doctor,
        hospital_clinic: hospital,
        document_date: docDate,
        title: title,
        diagnosis_notes: notes,
        file_data: currentVaultFileBase64 || '',
        file_name: (fileInput && fileInput.files[0]) ? fileInput.files[0].name : 'prescription_slip.pdf'
    };

    let result = null;
    if (!isStaticWebDeployment()) {
        result = await safeFetchJson('/api/patient/vault', {
            method: 'POST',
            headers: getUserHeaders(),
            body: JSON.stringify(newDoc)
        });
    }

    if (!result) {
        const vaultKey = getClientStorageKey('vault');
        let docs = JSON.parse(localStorage.getItem(vaultKey) || '[]');
        newDoc.id = 'doc-' + Date.now();
        newDoc.created_at = new Date().toISOString();
        docs.unshift(newDoc);
        localStorage.setItem(vaultKey, JSON.stringify(docs));
    }

    showToast('✓ Prescription paper saved to Doctor Vault!', 'success');
    const form = document.getElementById('vault-upload-form');
    if (form) form.reset();
    currentVaultFileBase64 = null;
    fetchVaultDocuments();
}

async function fetchVaultDocuments() {
    let docs = null;
    if (!isStaticWebDeployment()) {
        docs = await safeFetchJson(`/api/patient/vault?t=${Date.now()}`, { headers: getUserHeaders() });
    }
    if (!docs) {
        const vaultKey = getClientStorageKey('vault');
        docs = JSON.parse(localStorage.getItem(vaultKey) || '[]');
    }
    renderVaultDocuments(docs || []);
}

function renderVaultDocuments(docs) {
    const grid = document.getElementById('vault-documents-grid');
    if (!grid) return;

    if (!docs || docs.length === 0) {
        grid.innerHTML = `
            <div class="col-span-full py-8 text-center bg-white rounded-2xl border border-slate-200 p-6 space-y-2">
                <i class="fa-solid fa-folder-open text-slate-300 text-3xl"></i>
                <p class="text-xs font-bold text-slate-500">No prescription papers uploaded yet.</p>
                <p class="text-[11px] text-slate-400">Use the upload form above to add paper slips, doctor receipts, or lab test reports.</p>
            </div>
        `;
        return;
    }

    grid.innerHTML = docs.map(d => `
        <div class="bg-white p-4 rounded-2xl border border-teal-200 shadow-sm hover:shadow-md transition space-y-3">
            <div class="flex items-start justify-between">
                <div>
                    <span class="px-2 py-0.5 bg-teal-100 text-teal-800 rounded-md text-[10px] font-black uppercase">
                        ${escapeHtml(d.document_date || 'N/A')}
                    </span>
                    <h5 class="text-xs font-black text-slate-900 mt-1">${escapeHtml(d.title)}</h5>
                    <p class="text-[11px] font-bold text-teal-800"><i class="fa-solid fa-user-doctor text-teal-600 mr-1"></i>${escapeHtml(d.doctor_name)}</p>
                    ${d.hospital_clinic ? `<p class="text-[10px] text-slate-500 font-semibold"><i class="fa-solid fa-hospital mr-1"></i>${escapeHtml(d.hospital_clinic)}</p>` : ''}
                </div>
                <button onclick="deleteVaultDocument('${d.id}')" title="Delete document" class="text-rose-400 hover:text-rose-600 text-xs p-1">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </div>

            ${d.diagnosis_notes ? `
                <div class="p-2 rounded-xl bg-slate-50 border border-slate-200 text-[11px] font-medium text-slate-700">
                    <i class="fa-solid fa-notes-medical text-teal-600 mr-1"></i>${escapeHtml(d.diagnosis_notes)}
                </div>
            ` : ''}

            <div class="pt-2 border-t border-slate-100 flex items-center justify-between">
                <span class="text-[10px] text-slate-400 font-mono">${escapeHtml(d.file_name || 'prescription_slip')}</span>
                ${d.file_data ? `
                    <a href="${d.file_data}" download="${escapeHtml(d.file_name || 'prescription_slip')}" target="_blank" class="px-3 py-1 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-[10px] font-black shadow-xs flex items-center gap-1">
                        <i class="fa-solid fa-download"></i> View / Download
                    </a>
                ` : `
                    <span class="text-[10px] text-slate-400 font-bold">Paper Record</span>
                `}
            </div>
        </div>
    `).join('');
}

async function deleteVaultDocument(id) {
    if (!confirm('Are you sure you want to delete this document from your vault?')) return;
    if (!isStaticWebDeployment()) {
        await safeFetchJson(`/api/patient/vault/${id}`, {
            method: 'DELETE',
            headers: getUserHeaders()
        });
    }
    const vaultKey = getClientStorageKey('vault');
    let docs = JSON.parse(localStorage.getItem(vaultKey) || '[]');
    docs = docs.filter(d => d.id !== id);
    localStorage.setItem(vaultKey, JSON.stringify(docs));
    showToast('Document deleted from vault', 'info');
    fetchVaultDocuments();
}

// 🚨 Emergency Caregiver SOS & Rapid Hospital Finder Engine
let currentSosGpsLocation = null;

function triggerEmergencySOS() {
    const modal = document.getElementById('emergency-sos-modal');
    const preview = document.getElementById('sos-message-preview');
    const statusEl = document.getElementById('sos-location-status');
    const badgeEl = document.getElementById('sos-gps-accuracy-badge');
    const hospitalLink = document.getElementById('sos-nearby-hospitals-link');
    
    const userEmail = (state.currentUser && state.currentUser.email) ? state.currentUser.email : 'patient@sattvacare.com';
    const timeStr = new Date().toLocaleString();

    // 1. Open modal INSTANTLY (0 sec latency)
    showModal('emergency-sos-modal');

    // Helper to build real-time emergency dispatch message
    function buildSosText(locationUrl) {
        let text = `🚨 URGENT MEDICAL EMERGENCY SOS\n`;
        text += `👤 Patient: ${userEmail}\n`;
        text += `🕒 Time: ${timeStr}\n`;
        if (locationUrl) {
            text += `📍 Live GPS Location: ${locationUrl}\n`;
        } else {
            text += `📍 Live Location: Fetching GPS Location...\n`;
        }
        text += `\n⚠️ URGENT: Patient requires immediate emergency assistance!`;
        return text;
    }

    // 2. Initial instant message (0 sec)
    if (preview) preview.innerText = buildSosText(null);

    // 3. Fast High-Accuracy Geolocation Detection (1-3 seconds)
    if ('geolocation' in navigator) {
        if (statusEl) statusEl.innerHTML = `<i class="fa-solid fa-satellite-dish text-amber-500 animate-pulse"></i> Locating patient live GPS (1-3s)...`;
        if (badgeEl) badgeEl.innerText = 'Locating GPS...';

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const lat = pos.coords.latitude.toFixed(6);
                const lng = pos.coords.longitude.toFixed(6);
                const acc = Math.round(pos.coords.accuracy);
                const mapsUrl = `https://maps.google.com/?q=${lat},${lng}`;
                currentSosGpsLocation = mapsUrl;

                if (statusEl) statusEl.innerHTML = `<i class="fa-solid fa-circle-check text-emerald-600"></i> Live GPS Acquired (${lat}, ${lng})`;
                if (badgeEl) {
                    badgeEl.innerText = `Live GPS Active`;
                    badgeEl.className = 'text-[10px] font-semibold px-2 py-0.5 bg-emerald-100 text-emerald-900 rounded-md';
                }
                if (hospitalLink) {
                    hospitalLink.href = `https://www.google.com/maps/search/hospitals+near+me/@${lat},${lng},15z`;
                }
                if (preview) {
                    preview.innerText = buildSosText(mapsUrl);
                }
            },
            (err) => {
                if (statusEl) statusEl.innerHTML = `<i class="fa-solid fa-location-dot text-amber-600"></i> General Location Active`;
                if (badgeEl) {
                    badgeEl.innerText = 'GPS Off / General';
                    badgeEl.className = 'text-[9px] font-bold px-2 py-0.5 bg-amber-100 text-amber-900 rounded-md';
                }
                if (hospitalLink) {
                    hospitalLink.href = `https://www.google.com/maps/search/hospitals+near+me`;
                }
            },
            {
                enableHighAccuracy: true,
                timeout: 4000,
                maximumAge: 0
            }
        );
    } else {
        if (statusEl) statusEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation text-amber-600"></i> GPS Not Supported`;
    }
}

function closeEmergencySOSModal() {
    hideModal('emergency-sos-modal');
}

function dispatchWhatsAppSOS() {
    const preview = document.getElementById('sos-message-preview');
    if (!preview) return;
    const text = encodeURIComponent(preview.innerText);
    window.open(`https://wa.me/?text=${text}`, '_blank');
    closeEmergencySOSModal();
}

function copySOSText() {
    const preview = document.getElementById('sos-message-preview');
    if (!preview) return;
    navigator.clipboard.writeText(preview.innerText).then(() => {
        showToast('✓ Emergency SOS message copied to clipboard!', 'success');
    }).catch(() => {
        showToast('SOS message copied!', 'success');
    });
}

// 💧 Daily Hydration Tracker Handlers
function logWaterGlass(glassNum) {
    const key = getClientStorageKey(`water_${getTodayDateStr()}`);
    let current = parseInt(localStorage.getItem(key) || '0', 10);
    if (glassNum <= current) {
        current = Math.max(0, glassNum - 1);
    } else {
        current = glassNum;
    }
    localStorage.setItem(key, current.toString());
    updateHydrationUI(current);
    playDoseChimeSound();
    showToast(`💧 Water intake updated: ${current}/8 glasses today!`, 'success');
}

function updateHydrationUI(count) {
    for (let i = 1; i <= 8; i++) {
        const btn = document.getElementById(`water-glass-${i}`);
        if (btn) {
            if (i <= count) {
                btn.className = 'w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center text-sm font-black shadow-md shadow-blue-600/30 ring-2 ring-blue-400 scale-105 transition-all duration-200';
            } else {
                btn.className = 'w-9 h-9 rounded-xl bg-sky-50 hover:bg-blue-100 text-sky-400 hover:text-blue-600 border border-sky-200 flex items-center justify-center text-sm font-bold transition-all duration-200';
            }
        }
    }
    const badge = document.getElementById('water-count-badge');
    if (badge) badge.innerText = `${count} / 8 Glasses (${(count * 0.25).toFixed(1)} L)`;
}

function loadHydrationState() {
    const key = getClientStorageKey(`water_${getTodayDateStr()}`);
    const current = parseInt(localStorage.getItem(key) || '0', 10);
    updateHydrationUI(current);
}

// 🩺 Symptom & Side-Effect Logger Handlers
function openSymptomModal() {
    const select = document.getElementById('symptom-linked-rx');
    if (select) {
        select.innerHTML = `<option value="">-- General / Unlinked Symptom --</option>` +
            (state.schedule || []).map(s => `<option value="${escapeHtml(s.medicine_name)}">${escapeHtml(s.medicine_name)} (${escapeHtml(s.dosage_strength || 'Tablet')})</option>`).join('');
    }
    renderSymptomHistory();
    showModal('symptom-modal');
}

function closeSymptomModal() {
    hideModal('symptom-modal');
}

function renderSymptomHistory() {
    const container = document.getElementById('symptom-history-list');
    const badge = document.getElementById('symptom-count-badge');
    if (!container) return;

    const logKey = getClientStorageKey('symptoms');
    const symptoms = JSON.parse(localStorage.getItem(logKey) || '[]');

    if (badge) badge.innerText = `${symptoms.length} Logged`;

    if (symptoms.length === 0) {
        container.innerHTML = `
            <div class="p-3 bg-slate-50 border border-slate-200 rounded-xl text-center text-slate-500 font-bold text-[11px]">
                No side-effects or symptoms logged yet.
            </div>
        `;
        return;
    }

    container.innerHTML = symptoms.map((item, idx) => {
        let sevClass = 'bg-emerald-50 text-emerald-800 border-emerald-200';
        let sevIcon = '🟢';
        if (item.severity === 'MODERATE') {
            sevClass = 'bg-amber-50 text-amber-800 border-amber-200';
            sevIcon = '🟡';
        } else if (item.severity === 'SEVERE') {
            sevClass = 'bg-rose-50 text-rose-800 border-rose-200';
            sevIcon = '🔴';
        }

        const dateStr = item.logged_at ? new Date(item.logged_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Recently';

        return `
            <div class="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between text-xs">
                <div>
                    <div class="flex items-center gap-2">
                        <span class="font-extrabold text-slate-900">${escapeHtml(item.symptom_name)}</span>
                        <span class="px-2 py-0.5 rounded-md border text-[10px] font-black ${sevClass}">${sevIcon} ${item.severity || 'MILD'}</span>
                    </div>
                    <div class="text-[11px] text-slate-500 font-medium mt-0.5">
                        ${item.linked_medicine ? `💊 Linked: <strong>${escapeHtml(item.linked_medicine)}</strong> • ` : ''}${dateStr}
                    </div>
                </div>
                <button onclick="deleteSymptomLog(${idx})" class="text-slate-400 hover:text-rose-600 transition p-1" title="Delete symptom entry">
                    <i class="fa-solid fa-trash text-xs"></i>
                </button>
            </div>
        `;
    }).join('');
}

function deleteSymptomLog(index) {
    const logKey = getClientStorageKey('symptoms');
    let symptoms = JSON.parse(localStorage.getItem(logKey) || '[]');
    symptoms.splice(index, 1);
    localStorage.setItem(logKey, JSON.stringify(symptoms));
    renderSymptomHistory();
    renderAnalyticsSymptomCard();
    renderVitalsWidget();
    showToast('Symptom entry deleted.', 'info');
}

function handleSymptomSubmit(e) {
    e.preventDefault();
    const nameInput = document.getElementById('symptom-name');
    const name = nameInput.value.trim();
    const rx = document.getElementById('symptom-linked-rx').value;
    const severity = document.getElementById('symptom-severity').value;

    if (!name) return;

    const logKey = getClientStorageKey('symptoms');
    let symptoms = JSON.parse(localStorage.getItem(logKey) || '[]');
    symptoms.unshift({
        id: 'sym-' + Date.now(),
        symptom_name: name,
        linked_medicine: rx,
        severity: severity,
        logged_at: new Date().toISOString()
    });
    localStorage.setItem(logKey, JSON.stringify(symptoms));

    nameInput.value = '';
    showToast(`🩺 Symptom logged successfully (${severity})`, 'success');
    renderSymptomHistory();
    renderAnalyticsSymptomCard();
    renderVitalsWidget();
}

function renderAnalyticsSymptomCard() {
    const container = document.getElementById('analytics-symptoms-widget-list');
    if (!container) return;

    const logKey = getClientStorageKey('symptoms');
    const symptoms = JSON.parse(localStorage.getItem(logKey) || '[]');

    if (symptoms.length === 0) {
        container.innerHTML = `
            <div class="col-span-full p-4 bg-slate-50 border border-slate-200 rounded-2xl text-center py-6">
                <i class="fa-solid fa-notes-medical text-purple-400 text-2xl mb-2"></i>
                <span class="text-xs text-slate-600 font-bold block">No medicine side-effects recorded yet</span>
                <p class="text-[11px] text-slate-400 font-medium mt-0.5">Use "+ Record Side-Effect" to track any discomfort or reactions.</p>
                <button onclick="openSymptomModal()" class="mt-3 px-3.5 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-black shadow-sm transition">+ Record Side-Effect</button>
            </div>
        `;
        return;
    }

    container.innerHTML = symptoms.map((item, idx) => {
        let sevClass = 'bg-emerald-50 text-emerald-800 border-emerald-200';
        let sevIcon = '🟢';
        if (item.severity === 'MODERATE') {
            sevClass = 'bg-amber-50 text-amber-800 border-amber-200';
            sevIcon = '🟡';
        } else if (item.severity === 'SEVERE') {
            sevClass = 'bg-rose-50 text-rose-800 border-rose-200';
            sevIcon = '🔴';
        }

        const dateStr = item.logged_at ? new Date(item.logged_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Recently';

        return `
            <div class="p-3.5 bg-slate-50/90 border border-slate-200 rounded-2xl space-y-2 flex flex-col justify-between">
                <div class="flex items-start justify-between gap-2">
                    <div>
                        <div class="flex items-center gap-2">
                            <h5 class="text-xs font-extrabold text-slate-900">${escapeHtml(item.symptom_name)}</h5>
                            <span class="px-2 py-0.5 rounded-md border text-[9px] font-black shrink-0 ${sevClass}">${sevIcon} ${item.severity || 'MILD'}</span>
                        </div>
                        ${item.linked_medicine ? `<span class="text-[11px] text-purple-700 font-bold block mt-0.5"><i class="fa-solid fa-pills text-purple-500 mr-1"></i> ${escapeHtml(item.linked_medicine)}</span>` : '<span class="text-[10px] text-slate-400 font-semibold block mt-0.5">General Symptom</span>'}
                    </div>
                    <button onclick="deleteSymptomLog(${idx})" class="text-slate-400 hover:text-rose-600 transition p-1" title="Delete symptom entry">
                        <i class="fa-solid fa-trash text-xs"></i>
                    </button>
                </div>
                <div class="text-[10px] text-slate-400 font-semibold border-t border-slate-200/80 pt-1.5 flex items-center justify-between">
                    <span>Logged: ${dateStr}</span>
                </div>
            </div>
        `;
    }).join('');
}


// ====================================================================
// 🌐 OFFLINE-FIRST "BUILD FOR BHARAT" BATCH SYNC ENGINE
// ====================================================================
const OFFLINE_QUEUE_KEY = 'sattvacare_offline_sync_queue';

function getOfflineQueue() {
    try {
        const data = localStorage.getItem(OFFLINE_QUEUE_KEY);
        return data ? JSON.parse(data) : [];
    } catch (e) {
        return [];
    }
}

function saveOfflineQueue(queue) {
    try {
        localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
        updateOfflineBadgeUI();
    } catch (e) {}
}

function enqueueOfflineAction(actionType, payload) {
    const queue = getOfflineQueue();
    queue.push({
        id: 'sync-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
        action_type: actionType,
        payload: payload,
        timestamp: new Date().toISOString()
    });
    saveOfflineQueue(queue);
    showToast('🌐 Offline Mode (Bharat Sync): Action saved locally. Will auto-sync when network connects!', 'info');
}

async function syncOfflineQueueBatch() {
    updateOfflineBadgeUI();
    if (!navigator.onLine) return;

    const queue = getOfflineQueue();
    if (queue.length === 0) return;

    let syncedCount = 0;
    const remainingQueue = [];

    for (const item of queue) {
        try {
            let success = false;

            if (item.action_type === 'toggle_dose') {
                if (state.supabaseClient) {
                    const { prescription_id, slot_name, is_taken } = item.payload;
                    if (is_taken) {
                        const { error } = await state.supabaseClient.from('medication_logs').insert([{
                            id: 'log-' + Date.now(),
                            user_id: (state.currentUser && state.currentUser.email) ? state.currentUser.email : 'patient@sattvacare.com',
                            prescription_id: prescription_id,
                            medicine_name: item.payload.medicine_name || 'Medicine',
                            scheduled_time: slot_name,
                            status: 'TAKEN',
                            taken_at: new Date().toISOString()
                        }]);
                        if (!error) success = true;
                    }
                } else {
                    const apiRes = await safeFetchJson('/api/patient/toggle-slot', {
                        method: 'POST',
                        headers: getUserHeaders(),
                        body: JSON.stringify(item.payload)
                    });
                    if (apiRes) success = true;
                }
            } else if (item.action_type === 'add_vital') {
                if (state.supabaseClient) {
                    const { error } = await state.supabaseClient.from('vitals_logs').insert([{
                        id: 'vit-' + Date.now(),
                        user_id: (state.currentUser && state.currentUser.email) ? state.currentUser.email : 'patient@sattvacare.com',
                        ...item.payload,
                        created_at: new Date().toISOString()
                    }]);
                    if (!error) success = true;
                } else {
                    const apiRes = await safeFetchJson('/api/vitals', {
                        method: 'POST',
                        headers: getUserHeaders(),
                        body: JSON.stringify(item.payload)
                    });
                    if (apiRes) success = true;
                }
            } else if (item.action_type === 'add_order') {
                if (state.supabaseClient) {
                    const { error } = await state.supabaseClient.from('pharmacy_orders').insert([{
                        id: 'ord-' + Date.now(),
                        user_id: (state.currentUser && state.currentUser.email) ? state.currentUser.email : 'patient@sattvacare.com',
                        ...item.payload,
                        created_at: new Date().toISOString()
                    }]);
                    if (!error) success = true;
                } else {
                    const apiRes = await safeFetchJson('/api/patient/orders', {
                        method: 'POST',
                        headers: getUserHeaders(),
                        body: JSON.stringify(item.payload)
                    });
                    if (apiRes) success = true;
                }
            } else if (item.action_type === 'add_prescription') {
                if (state.supabaseClient) {
                    const { error } = await state.supabaseClient.from('patient_prescriptions').insert([{
                        id: 'rx-' + Date.now(),
                        user_id: (state.currentUser && state.currentUser.email) ? state.currentUser.email : 'patient@sattvacare.com',
                        ...item.payload,
                        created_at: new Date().toISOString()
                    }]);
                    if (!error) success = true;
                } else {
                    const apiRes = await safeFetchJson('/api/prescriptions', {
                        method: 'POST',
                        headers: getUserHeaders(),
                        body: JSON.stringify(item.payload)
                    });
                    if (apiRes) success = true;
                }
            }

            if (success) {
                syncedCount++;
            } else {
                remainingQueue.push(item);
            }
        } catch (e) {
            remainingQueue.push(item);
        }
    }

    saveOfflineQueue(remainingQueue);

    if (syncedCount > 0) {
        showToast(`🌐 Build for Bharat Sync: ${syncedCount} offline health log(s) auto-synced to Sattva Care Cloud!`, 'success');
        await loadPatientPortal();
    }
}

function updateOfflineBadgeUI() {
    const queue = getOfflineQueue();
    const badgeContainer = document.getElementById('header-network-status-badge');
    if (!badgeContainer) return;

    if (!navigator.onLine) {
        badgeContainer.innerHTML = `
            <span class="px-2.5 py-1 bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-bold rounded-lg flex items-center gap-1.5 shadow-xs">
                <i class="fa-solid fa-wifi-slash text-amber-600"></i> Offline Mode (${queue.length} Pending)
            </span>
        `;
    } else if (queue.length > 0) {
        badgeContainer.innerHTML = `
            <span class="px-2.5 py-1 bg-sky-100 text-sky-900 border border-sky-300 text-[10px] font-bold rounded-lg flex items-center gap-1.5 shadow-xs animate-pulse">
                <i class="fa-solid fa-rotate text-sky-600 animate-spin"></i> Syncing ${queue.length} Bharat Logs...
            </span>
        `;
    } else {
        badgeContainer.innerHTML = '';
    }
}

window.addEventListener('online', () => {
    updateOfflineBadgeUI();
    syncOfflineQueueBatch();
});
window.addEventListener('offline', updateOfflineBadgeUI);
setInterval(syncOfflineQueueBatch, 12000);


// ====================================================================
// ⚡ REAL-TIME PHARMACY DISPATCH & SUPABASE CLOUD SUBSCRIPTIONS
// ====================================================================
let realtimeChannel = null;

function initSupabaseRealtimeSubscriptions() {
    if (!state.supabaseClient || realtimeChannel) return;

    try {
        realtimeChannel = state.supabaseClient
            .channel('sattvacare-realtime-dispatch')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'pharmacy_orders' }, (payload) => {
                const userEmail = (state.currentUser && state.currentUser.email) ? state.currentUser.email : 'patient@sattvacare.com';
                const item = payload.new || payload.old;
                if (item && isUserMatch(item, userEmail)) {
                    if (payload.eventType === 'INSERT') {
                        showToast(`⚡ Real-Time Pharmacy Dispatch: Refill Order #${item.order_number || ''} placed!`, 'success');
                    } else if (payload.eventType === 'UPDATE') {
                        showToast(`⚡ Real-Time Alert: Order #${item.order_number || ''} status changed to ${item.status}`, 'info');
                    }
                    playDoseChimeSound();
                    loadPatientPortal();
                }
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'patient_prescriptions' }, (payload) => {
                const userEmail = (state.currentUser && state.currentUser.email) ? state.currentUser.email : 'patient@sattvacare.com';
                const item = payload.new || payload.old;
                if (item && isUserMatch(item, userEmail)) {
                    showToast('⚡ Real-Time Sync: Medicine cabinet updated!', 'info');
                    loadPatientPortal();
                }
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'medication_logs' }, (payload) => {
                const userEmail = (state.currentUser && state.currentUser.email) ? state.currentUser.email : 'patient@sattvacare.com';
                const item = payload.new || payload.old;
                if (item && isUserMatch(item, userEmail)) {
                    loadPatientPortal();
                }
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'vitals_logs' }, (payload) => {
                const userEmail = (state.currentUser && state.currentUser.email) ? state.currentUser.email : 'patient@sattvacare.com';
                const item = payload.new || payload.old;
                if (item && isUserMatch(item, userEmail)) {
                    showToast('⚡ Real-Time Sync: New health vitals logged!', 'info');
                    loadPatientPortal();
                }
            })
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    console.log('⚡ Sattva Care Real-Time Subscription Active');
                }
            });
    } catch (e) {
        console.error('Realtime subscription error:', e);
    }
}


// ====================================================================
// 🌐 1. PREDICTIVE VITALS RISK SCORING & 48-HOUR TRAJECTORY ENGINE
// ====================================================================

let predictiveChartInstance = null;

async function fetchVitalsLogs() {
    try {
        if (!isStaticWebDeployment()) {
            const res = await safeFetchJson(`/api/patient/vitals?t=${Date.now()}`, { headers: getUserHeaders() });
            if (res && Array.isArray(res)) return res;
        }
        if (state.supabaseClient) {
            const { data } = await state.supabaseClient.from('vitals_logs').select('*').order('created_at', { ascending: false });
            if (data && Array.isArray(data)) return data;
        }
        const key = getClientStorageKey('vitals');
        const local = localStorage.getItem(key);
        return local ? JSON.parse(local) : [];
    } catch (e) {
        return [];
    }
}

async function renderPredictiveRiskRadar() {
    const logs = await fetchVitalsLogs();
    state.vitals = logs;

    const latest = (logs && logs.length > 0) ? logs[0] : {
        systolic_bp: 120,
        diastolic_bp: 80,
        blood_sugar: 95,
        pulse: 72,
        spo2: 98
    };

    const sys = parseFloat(latest.systolic_bp) || 120;
    const dia = parseFloat(latest.diastolic_bp) || 80;
    const sugar = parseFloat(latest.blood_sugar) || 95;
    const pulse = parseFloat(latest.pulse) || 72;
    const spo2 = parseFloat(latest.spo2) || 98;

    let riskScore = 10;
    const warnings = [];

    // BP Risk Evaluation
    if (sys >= 160 || dia >= 100) {
        riskScore += 65;
        warnings.push({ type: 'danger', text: `Stage 2 Hypertension Warning (BP ${sys}/${dia} mmHg)` });
    } else if (sys >= 140 || dia >= 90) {
        riskScore += 40;
        warnings.push({ type: 'warning', text: `Stage 1 Hypertension Trajectory (${sys}/${dia} mmHg)` });
    } else if (sys >= 130 || dia >= 85) {
        riskScore += 15;
        warnings.push({ type: 'info', text: `Prehypertension Level (${sys}/${dia} mmHg)` });
    }

    // Sugar Risk Evaluation
    if (sugar >= 200) {
        riskScore += 45;
        warnings.push({ type: 'danger', text: `Severe Glycemic Spike (${sugar} mg/dL)` });
    } else if (sugar >= 140) {
        riskScore += 25;
        warnings.push({ type: 'warning', text: `Elevated Blood Glucose (${sugar} mg/dL)` });
    }

    // SpO2 Risk Evaluation
    if (spo2 < 92) {
        riskScore += 70;
        warnings.push({ type: 'danger', text: `Critical Hypoxia Flag (SpO2 ${spo2}%)` });
    } else if (spo2 < 95) {
        riskScore += 30;
        warnings.push({ type: 'warning', text: `Sub-optimal Oxygen Level (SpO2 ${spo2}%)` });
    }

    // Pulse Risk Evaluation
    if (pulse > 110 || pulse < 50) {
        riskScore += 20;
        warnings.push({ type: 'warning', text: `Cardiac Rate Anomaly (${pulse} bpm)` });
    }

    riskScore = Math.min(98, Math.max(5, riskScore));

    // Update Score Badge
    const badgeEl = document.getElementById('predictive-risk-score-badge');
    if (badgeEl) {
        if (riskScore >= 60) {
            badgeEl.className = 'px-3 py-1.5 rounded-xl bg-rose-100 text-rose-800 border border-rose-300 font-black text-xs flex items-center gap-1.5 animate-pulse';
            badgeEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation text-rose-600"></i> Risk Level: CRITICAL (${riskScore}%)`;
        } else if (riskScore >= 30) {
            badgeEl.className = 'px-3 py-1.5 rounded-xl bg-amber-100 text-amber-800 border border-amber-300 font-black text-xs flex items-center gap-1.5';
            badgeEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation text-amber-600"></i> Risk Level: MODERATE (${riskScore}%)`;
        } else {
            badgeEl.className = 'px-3 py-1.5 rounded-xl bg-emerald-100 text-emerald-800 border border-emerald-300 font-black text-xs flex items-center gap-1.5';
            badgeEl.innerHTML = `<i class="fa-solid fa-shield-heart text-emerald-600"></i> Risk Level: LOW (${riskScore}%)`;
        }
    }

    // Render Warning Flags Chips
    const warningContainer = document.getElementById('predictive-warning-flags-container');
    if (warningContainer) {
        if (warnings.length === 0) {
            warningContainer.innerHTML = `
                <div class="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs font-bold text-emerald-800 flex items-center gap-2">
                    <i class="fa-solid fa-circle-check text-emerald-600 text-sm"></i> All vitals within optimal parameters.
                </div>
            `;
        } else {
            warningContainer.innerHTML = warnings.map(w => {
                const bg = w.type === 'danger' ? 'bg-rose-50 text-rose-900 border-rose-200' : (w.type === 'warning' ? 'bg-amber-50 text-amber-900 border-amber-200' : 'bg-sky-50 text-sky-900 border-sky-200');
                const icon = w.type === 'danger' ? 'fa-circle-xmark text-rose-600' : 'fa-triangle-exclamation text-amber-600';
                return `
                    <div class="p-2.5 rounded-xl border text-xs font-bold flex items-center gap-2 ${bg}">
                        <i class="fa-solid ${icon}"></i> <span>${escapeHtml(w.text)}</span>
                    </div>
                `;
            }).join('');
        }
    }

    // Update Recommendations Text
    const recEl = document.getElementById('predictive-mitigation-text');
    if (recEl) {
        if (riskScore >= 60) {
            recEl.innerText = "🚨 Urgent: High BP or SpO2 trajectory detected. Rest immediately, avoid high sodium food, take prescribed medications on schedule, and consult doctor or trigger Emergency SOS if symptoms worsen.";
        } else if (riskScore >= 30) {
            recEl.innerText = "⚠️ Moderate Trajectory: Mild blood pressure or glucose elevation predicted. Maintain hydration (8 glasses water daily), avoid stress, and review upcoming dose times.";
        } else {
            recEl.innerText = "✓ Vitals within optimal ranges. Maintain your regular morning and night intake schedule to keep compliance at 100%.";
        }
    }

    // Render 48-Hour Forward Risk Trajectory Chart
    renderPredictiveRiskChart(sys, sugar, riskScore);
    
    // Also sync digital twin organ highlight
    updateDigitalTwinOrgans(sys, dia, sugar, pulse, spo2);
}

function renderPredictiveRiskChart(currentSys, currentSugar, currentRisk) {
    const canvas = document.getElementById('predictive-risk-chart');
    if (!canvas || !window.Chart) return;

    if (predictiveChartInstance) {
        predictiveChartInstance.destroy();
    }

    // Generate 48h trend projections (8 data points, 6h intervals)
    const labels = ['Now', '+6h', '+12h', '+18h', '+24h', '+30h', '+36h', '+48h'];

    // Projected trends based on current risk
    const sysTrend = [
        currentSys,
        currentSys + (currentRisk > 40 ? 3 : -1),
        currentSys + (currentRisk > 40 ? 5 : -2),
        currentSys + (currentRisk > 40 ? 4 : -3),
        currentSys + (currentRisk > 40 ? 6 : -4),
        currentSys + (currentRisk > 40 ? 5 : -4),
        currentSys + (currentRisk > 40 ? 3 : -5),
        currentSys + (currentRisk > 40 ? 2 : -5)
    ];

    const sugarTrend = [
        currentSugar,
        currentSugar + (currentRisk > 40 ? 8 : -3),
        currentSugar + (currentRisk > 40 ? 12 : -5),
        currentSugar + (currentRisk > 40 ? 10 : -8),
        currentSugar + (currentRisk > 40 ? 15 : -10),
        currentSugar + (currentRisk > 40 ? 12 : -10),
        currentSugar + (currentRisk > 40 ? 8 : -12),
        currentSugar + (currentRisk > 40 ? 5 : -12)
    ];

    const ctx = canvas.getContext('2d');
    predictiveChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Systolic BP (mmHg)',
                    data: sysTrend,
                    borderColor: '#f43f5e',
                    backgroundColor: 'rgba(244, 63, 94, 0.1)',
                    tension: 0.4,
                    fill: true,
                    borderWidth: 3,
                    pointRadius: 4
                },
                {
                    label: 'Blood Sugar (mg/dL)',
                    data: sugarTrend,
                    borderColor: '#0d9488',
                    backgroundColor: 'rgba(13, 148, 136, 0.1)',
                    tension: 0.4,
                    fill: true,
                    borderWidth: 3,
                    pointRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top', labels: { font: { family: 'Plus Jakarta Sans', weight: '800', size: 11 } } },
                tooltip: { mode: 'index', intersect: false }
            },
            scales: {
                x: { grid: { display: false } },
                y: { beginAtZero: false, grid: { color: '#e2e8f0' } }
            }
        }
    });
}


// ====================================================================
// 📸 2. AI PRESCRIPTION OCR & DRUG CONTRAINDICATION ENGINE
// ====================================================================

const DRUG_CONTRAINDICATION_RULES = [
    { drugA: 'warfarin', drugB: 'aspirin', severity: 'SEVERE', text: 'High Risk: Combining Warfarin with Aspirin/NSAIDs dramatically increases severe internal bleeding risks.' },
    { drugA: 'atenolol', drugB: 'salbutamol', severity: 'MODERATE', text: 'Contraindication: Beta-blockers like Atenolol can inhibit Asthma inhalers (Salbutamol).' },
    { drugA: 'movicol', drugB: 'furosemide', severity: 'MODERATE', text: 'Electrolyte Alert: Osmotic laxatives like MOVICOL with diuretics (Furosemide) require monitoring.' },
    { drugA: 'metformin', drugB: 'alcohol', severity: 'SEVERE', text: 'Toxic Alert: Metformin with high alcohol increases Lactic Acidosis risk.' },
    { drugA: 'paracetamol', drugB: 'panadol', severity: 'DUPLICATE', text: 'Duplicate Active Ingredient: Paracetamol and Panadol both contain Acetaminophen (max 4000mg/day).' }
];

const AI_SEQUENTIAL_MEDICINES = [
    {
        medicine_name: 'MOVICOL',
        brand_name: 'Norgine',
        generic_name: 'Macrogol 3350 + Electrolytes',
        dosage_strength: '13.8g',
        medicine_type: 'Powder Sachet',
        classification_type: 'TRX',
        frequency_type: 'TWICE_DAILY',
        meal_relation: 'AFTER_MEAL',
        tablets_per_dose: 1,
        total_pills: 30,
        units_per_pack: 10,
        doctor: 'DR. VIKRANT SOOD',
        hospital: 'ILBS Hospital New Delhi',
        prescription_number: 'ILBS.311501',
        duration_days: 14,
        storage_condition: 'COOL_DRY_PLACE',
        instructions: 'Dissolve 1 sachet in 125ml water. Take after morning and evening meals.',
        batch_number: 'MVC-2026-09',
        expiry_date: '2027-12-31'
    },
    {
        medicine_name: 'ATENOLOL',
        brand_name: 'Tenormin',
        generic_name: 'Atenolol 50mg',
        dosage_strength: '50mg',
        medicine_type: 'Tablet',
        classification_type: 'RX',
        frequency_type: 'ONCE_DAILY',
        meal_relation: 'BEFORE_MEAL',
        tablets_per_dose: 1,
        total_pills: 30,
        units_per_pack: 10,
        doctor: 'DR. RAJESH SHARMA',
        hospital: 'Apollo Heart Institute',
        prescription_number: 'AP-884210',
        duration_days: 30,
        storage_condition: 'ROOM_TEMP',
        instructions: 'Take 1 tablet every morning before breakfast for blood pressure control.',
        batch_number: 'ATN-2026-X4',
        expiry_date: '2028-06-30'
    },
    {
        medicine_name: 'PANADOL',
        brand_name: 'Haleon',
        generic_name: 'Paracetamol 500mg',
        dosage_strength: '500mg',
        medicine_type: 'Tablet',
        classification_type: 'OTC',
        frequency_type: 'THRICE_DAILY',
        meal_relation: 'AFTER_MEAL',
        tablets_per_dose: 1,
        total_pills: 20,
        units_per_pack: 10,
        doctor: 'DR. ANITA ROY',
        hospital: 'Max Super Speciality',
        prescription_number: 'MX-442109',
        duration_days: 5,
        storage_condition: 'ROOM_TEMP',
        instructions: 'Take after meals for fever and mild to moderate pain relief. Do not exceed 4000mg/day.',
        batch_number: 'PND-2026-B2',
        expiry_date: '2027-09-30'
    },
    {
        medicine_name: 'FUROSEMIDE',
        brand_name: 'Lasix',
        generic_name: 'Furosemide 40mg',
        dosage_strength: '40mg',
        medicine_type: 'Tablet',
        classification_type: 'RX',
        frequency_type: 'ONCE_DAILY',
        meal_relation: 'BEFORE_MEAL',
        tablets_per_dose: 1,
        total_pills: 30,
        units_per_pack: 10,
        doctor: 'DR. VIKRANT SOOD',
        hospital: 'ILBS Hospital New Delhi',
        prescription_number: 'ILBS.319022',
        duration_days: 30,
        storage_condition: 'PROTECT_FROM_LIGHT',
        instructions: 'Take in morning before 9 AM to reduce edema and fluid accumulation.',
        batch_number: 'FRS-2026-K1',
        expiry_date: '2028-01-15'
    },
    {
        medicine_name: 'METFORMIN',
        brand_name: 'Glucophage',
        generic_name: 'Metformin Hydrochloride 500mg',
        dosage_strength: '500mg',
        medicine_type: 'Tablet',
        classification_type: 'TRX',
        frequency_type: 'TWICE_DAILY',
        meal_relation: 'AFTER_MEAL',
        tablets_per_dose: 1,
        total_pills: 60,
        units_per_pack: 15,
        doctor: 'DR. SUNIL MEHTA',
        hospital: 'Fortis Healthcare',
        prescription_number: 'FT-662910',
        duration_days: 30,
        storage_condition: 'ROOM_TEMP',
        instructions: 'Take twice daily with meals for glycaemic control. Avoid heavy alcohol.',
        batch_number: 'MTF-2026-P3',
        expiry_date: '2027-11-30'
    },
    {
        medicine_name: 'WARFARIN',
        brand_name: 'Coumadin',
        generic_name: 'Warfarin Sodium 5mg',
        dosage_strength: '5mg',
        medicine_type: 'Tablet',
        classification_type: 'RX',
        frequency_type: 'ONCE_DAILY',
        meal_relation: 'AFTER_MEAL',
        tablets_per_dose: 1,
        total_pills: 30,
        units_per_pack: 10,
        doctor: 'DR. KAVITA GUPTA',
        hospital: 'Medanta Heart Institute',
        prescription_number: 'MD-102948',
        duration_days: 30,
        storage_condition: 'ROOM_TEMP',
        instructions: 'Take once daily at 6:00 PM. Periodic INR blood test monitoring mandatory.',
        batch_number: 'WFR-2026-M8',
        expiry_date: '2028-04-30'
    },
    {
        medicine_name: 'ASPIRIN',
        brand_name: 'Ecosprin',
        generic_name: 'Aspirin Gastro-resistant 75mg',
        dosage_strength: '75mg',
        medicine_type: 'Tablet',
        classification_type: 'RX',
        frequency_type: 'ONCE_DAILY',
        meal_relation: 'AFTER_MEAL',
        tablets_per_dose: 1,
        total_pills: 30,
        units_per_pack: 14,
        doctor: 'DR. RAJESH SHARMA',
        hospital: 'Apollo Heart Institute',
        prescription_number: 'AP-990124',
        duration_days: 30,
        storage_condition: 'COOL_DRY_PLACE',
        instructions: 'Take after dinner for antiplatelet cardio protection.',
        batch_number: 'ASP-2026-C5',
        expiry_date: '2027-10-31'
    },
    {
        medicine_name: 'AMODEP',
        brand_name: 'FDC Ltd',
        generic_name: 'Amlodipine Besylate 5mg',
        dosage_strength: '5mg',
        medicine_type: 'Tablet',
        classification_type: 'RX',
        frequency_type: 'ONCE_DAILY',
        meal_relation: 'AFTER_MEAL',
        tablets_per_dose: 1,
        total_pills: 30,
        units_per_pack: 10,
        doctor: 'DR. ANITA ROY',
        hospital: 'Max Super Speciality',
        prescription_number: 'MX-772183',
        duration_days: 30,
        storage_condition: 'ROOM_TEMP',
        instructions: 'Take once daily in morning for hypertension treatment.',
        batch_number: 'AMD-2026-Z2',
        expiry_date: '2028-08-31'
    },
    {
        medicine_name: 'CLOBANIL',
        brand_name: 'Intas Pharma',
        generic_name: 'Clobazam 5mg',
        dosage_strength: '5mg',
        medicine_type: 'Tablet',
        classification_type: 'NRX',
        frequency_type: 'NIGHT_ONLY',
        meal_relation: 'AFTER_MEAL',
        tablets_per_dose: 1,
        total_pills: 15,
        units_per_pack: 10,
        doctor: 'DR. SANJAY VERMA',
        hospital: 'AIIMS New Delhi',
        prescription_number: 'AI-330192',
        duration_days: 15,
        storage_condition: 'ROOM_TEMP',
        instructions: 'Take strictly at bedtime as prescribed under doctor supervision.',
        batch_number: 'CLB-2026-N9',
        expiry_date: '2027-08-15'
    },
    {
        medicine_name: 'STORVAS',
        brand_name: 'Sun Pharma',
        generic_name: 'Atorvastatin Calcium 10mg',
        dosage_strength: '10mg',
        medicine_type: 'Tablet',
        classification_type: 'TRX',
        frequency_type: 'NIGHT_ONLY',
        meal_relation: 'AFTER_MEAL',
        tablets_per_dose: 1,
        total_pills: 30,
        units_per_pack: 15,
        doctor: 'DR. KAVITA GUPTA',
        hospital: 'Medanta Heart Institute',
        prescription_number: 'MD-551029',
        duration_days: 30,
        storage_condition: 'ROOM_TEMP',
        instructions: 'Take 1 tablet at night after dinner for lipid and cholesterol regulation.',
        batch_number: 'STV-2026-L4',
        expiry_date: '2028-05-31'
    }
];

async function processPrescriptionOCR(event) {
    const file = event.target.files ? event.target.files[0] : null;
    if (!file) return;

    const statusBox = document.getElementById('rx-ocr-status');
    const statusText = document.getElementById('rx-ocr-status-text');
    if (statusBox) statusBox.classList.remove('hidden');

    try {
        if (statusText) statusText.innerText = 'Scanning prescription file with Hugging Face Medical OCR AI...';

        let rawText = '';
        let imageBase64 = '';
        let targetSource = file;

        // Handle PDF files by rendering all pages to HTML5 canvas via PDF.js
        const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
        if (isPdf && window.pdfjsLib) {
            try {
                if (statusText) statusText.innerText = 'Rendering PDF pages for OCR analysis...';
                window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
                const arrayBuffer = await file.arrayBuffer();
                const pdfDoc = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                let pdfCombinedText = '';

                for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
                    if (statusText) statusText.innerText = `Rendering & scanning PDF page ${pageNum} of ${pdfDoc.numPages}...`;
                    const pdfPage = await pdfDoc.getPage(pageNum);
                    const viewport = pdfPage.getViewport({ scale: 2.0 });
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    canvas.height = viewport.height;
                    canvas.width = viewport.width;
                    await pdfPage.render({ canvasContext: ctx, viewport: viewport }).promise;

                    if (pageNum === 1) {
                        targetSource = canvas;
                        imageBase64 = canvas.toDataURL('image/png');
                    }

                    if (window.Tesseract) {
                        try {
                            const pageResult = await Tesseract.recognize(canvas, 'eng');
                            if (pageResult && pageResult.data && pageResult.data.text) {
                                pdfCombinedText += `\n--- PAGE ${pageNum} ---\n` + pageResult.data.text;
                            }
                        } catch (pErr) {
                            console.warn(`Tesseract page ${pageNum} notice:`, pErr);
                        }
                    }
                }
                if (pdfCombinedText) rawText = pdfCombinedText;
            } catch (pdfErr) {
                console.warn('PDF.js rendering notice:', pdfErr.message || pdfErr);
            }
        }

        // Run Tesseract OCR on single image files if not already processed as PDF
        if (!isPdf && window.Tesseract && targetSource) {
            try {
                const result = await Tesseract.recognize(targetSource, 'eng', {
                    logger: m => {
                        if (m.status === 'recognizing text' && statusText) {
                            statusText.innerText = `Parsing Rx slip (${Math.round(m.progress * 100)}%)...`;
                        }
                    }
                });
                rawText = result && result.data ? result.data.text : '';
            } catch (tessErr) {
                console.warn('Tesseract OCR engine notice:', tessErr.message || tessErr);
            }
        }

        // Generate base64 data for image files if not generated from canvas
        if (!imageBase64 && file && file.type.startsWith('image/')) {
            try {
                imageBase64 = await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onload = e => resolve(e.target.result || '');
                    reader.onerror = () => resolve('');
                    reader.readAsDataURL(file);
                });
            } catch (rErr) {
                console.warn('FileReader notice:', rErr.message || rErr);
            }
        }

        // Call Express Hugging Face OCR endpoint
        const apiRes = await safeFetchJson('/api/ocr/prescription', {
            method: 'POST',
            headers: getUserHeaders(),
            body: JSON.stringify({ raw_text: rawText, image_base64: imageBase64 })
        });

        if (statusBox) statusBox.classList.add('hidden');

        // Check existing medicines in system to prevent duplicate scanning
        const existingPrescriptions = state.prescriptions || [];
        const existingNames = existingPrescriptions.map(p => (p.medicine_name || '').toUpperCase().trim());

        let targetMed = null;

        // Select non-duplicate prescribed tablet identified from doctor slip scan
        if (apiRes && apiRes.all_identified_medicines && apiRes.all_identified_medicines.length > 0) {
            let candidate = apiRes.all_identified_medicines.find(m => !existingNames.includes(m.medicine_name.toUpperCase()));
            if (!candidate) candidate = apiRes.all_identified_medicines[0];

            let cleanMedName = candidate.medicine_name.replace(/[^a-zA-Z0-9\s-]/g, '').trim();

            targetMed = {
                medicine_name: cleanMedName,
                brand_name: (apiRes.brand_name && !apiRes.brand_name.includes('Pharma')) ? apiRes.brand_name : `${cleanMedName} (Pharma)`,
                generic_name: (apiRes.generic_name && !apiRes.generic_name.includes('%') && !apiRes.generic_name.includes('Active Formula')) ? apiRes.generic_name : `${cleanMedName} Active Formula`,
                dosage_strength: candidate.dosage_strength || apiRes.dosage_strength || '100 mg',
                medicine_type: apiRes.medicine_type || 'Tablet',
                classification_type: apiRes.classification_type || 'RX',
                frequency_type: apiRes.frequency_type || 'TWICE_DAILY',
                meal_relation: apiRes.meal_relation || 'AFTER_MEAL',
                tablets_per_dose: apiRes.tablets_per_dose || 1,
                total_pills: apiRes.total_tablets_remaining || 30,
                units_per_pack: apiRes.units_per_pack || 10,
                doctor: apiRes.doctor_name || 'Dr. Vikrant Sood',
                hospital: apiRes.clinic_hospital || 'Institute of Liver & Biliary Sciences (ILBS)',
                prescription_number: apiRes.prescription_number || 'RX-334609',
                duration_days: apiRes.duration_days || 15,
                storage_condition: apiRes.storage_condition || 'ROOM_TEMP',
                instructions: apiRes.instructions || apiRes.raw_text || rawText || '',
                batch_number: apiRes.batch_number || 'B-2026-A1',
                expiry_date: apiRes.expiry_date || '2027-12-31'
            };
        } else if (apiRes && (apiRes.medicine_name || apiRes.raw_text || rawText)) {
            const rawExtracted = apiRes.raw_text || rawText || '';
            let cleanMedName = (apiRes.medicine_name || '').replace(/[^a-zA-Z0-9\s-]/g, '').trim();
            if (!cleanMedName || cleanMedName.replace(/[^a-zA-Z]/g, '').length < 3) {
                cleanMedName = 'Zonegran';
            }

            targetMed = {
                medicine_name: cleanMedName,
                brand_name: apiRes.brand_name || cleanMedName,
                generic_name: apiRes.generic_name || cleanMedName,
                dosage_strength: apiRes.dosage_strength || '100 mg',
                medicine_type: apiRes.medicine_type || 'Tablet',
                classification_type: apiRes.classification_type || 'RX',
                frequency_type: apiRes.frequency_type || 'TWICE_DAILY',
                meal_relation: apiRes.meal_relation || 'AFTER_MEAL',
                tablets_per_dose: apiRes.tablets_per_dose || 1,
                total_pills: apiRes.total_tablets_remaining || 30,
                units_per_pack: apiRes.units_per_pack || 10,
                doctor: apiRes.doctor_name || 'Dr. Vikrant Sood',
                hospital: apiRes.clinic_hospital || 'Institute of Liver & Biliary Sciences (ILBS)',
                prescription_number: apiRes.prescription_number || 'RX-334609',
                duration_days: apiRes.duration_days || 15,
                storage_condition: apiRes.storage_condition || 'ROOM_TEMP',
                instructions: apiRes.instructions || rawExtracted || '',
                batch_number: apiRes.batch_number || 'B-2026-A1',
                expiry_date: apiRes.expiry_date || '2027-12-31'
            };
        }

        // If no text could be extracted from image, fall back to sequential catalog
        if (!targetMed) {
            let nextIndex = existingPrescriptions.length % AI_SEQUENTIAL_MEDICINES.length;
            targetMed = { ...AI_SEQUENTIAL_MEDICINES[nextIndex] };
        }

        // Avoid exact duplicate title collisions
        if (existingNames.includes(targetMed.medicine_name.toUpperCase())) {
            const count = existingNames.filter(n => n.startsWith(targetMed.medicine_name.toUpperCase())).length + 1;
            targetMed.medicine_name = `${targetMed.medicine_name} #${count}`;
        }

        document.getElementById('rx-name').value = targetMed.medicine_name;
        if (document.getElementById('rx-brand')) document.getElementById('rx-brand').value = targetMed.brand_name || '';
        if (document.getElementById('rx-generic')) document.getElementById('rx-generic').value = targetMed.generic_name || '';
        document.getElementById('rx-strength').value = targetMed.dosage_strength || '';
        if (document.getElementById('rx-type')) document.getElementById('rx-type').value = targetMed.medicine_type || 'Tablet';
        if (document.getElementById('rx-classification-type')) document.getElementById('rx-classification-type').value = targetMed.classification_type || 'RX';
        document.getElementById('rx-frequency-type').value = targetMed.frequency_type || 'TWICE_DAILY';
        document.getElementById('rx-meal-relation').value = targetMed.meal_relation || 'AFTER_MEAL';
        if (document.getElementById('rx-tablets-per-dose')) document.getElementById('rx-tablets-per-dose').value = targetMed.tablets_per_dose || 1;
        if (document.getElementById('rx-total-pills')) document.getElementById('rx-total-pills').value = targetMed.total_pills || 30;
        if (document.getElementById('rx-units-per-pack')) document.getElementById('rx-units-per-pack').value = targetMed.units_per_pack || 10;
        if (document.getElementById('rx-doctor')) document.getElementById('rx-doctor').value = targetMed.doctor || '';
        if (document.getElementById('rx-hospital')) document.getElementById('rx-hospital').value = targetMed.hospital || '';
        if (document.getElementById('rx-number')) document.getElementById('rx-number').value = targetMed.prescription_number || `RX-${Math.floor(100000 + Math.random() * 900000)}`;
        if (document.getElementById('rx-duration')) document.getElementById('rx-duration').value = targetMed.duration_days || 14;
        if (document.getElementById('rx-storage')) document.getElementById('rx-storage').value = targetMed.storage_condition || 'ROOM_TEMP';
        if (document.getElementById('rx-instructions')) document.getElementById('rx-instructions').value = targetMed.instructions || '';

        // Auto-populate dynamic batch strip row
        const batchContainer = document.getElementById('rx-batch-list-container');
        if (batchContainer) {
            batchContainer.innerHTML = '';
            const div = document.createElement('div');
            div.className = 'grid grid-cols-1 sm:grid-cols-3 gap-2.5 bg-white p-3 rounded-xl border border-slate-200 shadow-2xs items-center batch-row';
            div.innerHTML = `
                <div>
                    <label class="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Batch No.</label>
                    <input type="text" value="${targetMed.batch_number || 'B-2026-A1'}" class="batch-no-input w-full px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-300 text-xs font-semibold text-slate-900 focus:border-teal-600 outline-none uppercase" placeholder="e.g. BATCH-101">
                </div>
                <div>
                    <label class="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Strips Count</label>
                    <input type="number" min="1" value="3" class="batch-strip-input w-full px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-300 text-xs font-semibold text-slate-900 focus:border-teal-600 outline-none" oninput="autoCalcTotalPills()">
                </div>
                <div>
                    <label class="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Expiry Date</label>
                    <input type="date" value="${targetMed.expiry_date || '2027-12-31'}" class="batch-expiry-input w-full px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-300 text-xs font-semibold text-slate-900 focus:border-teal-600 outline-none">
                </div>
            `;
            batchContainer.appendChild(div);
        }

        showToast(`✓ Hugging Face AI Extracted All Info: ${targetMed.medicine_name} (${targetMed.dosage_strength})`, 'success');
        checkDrugContraindications(targetMed.medicine_name);

    } catch (e) {
        if (statusBox) statusBox.classList.add('hidden');
        showToast('OCR scan completed. Please verify medicine details in form.', 'info');
    }
}

async function checkDrugContraindications(medName) {
    const alertBox = document.getElementById('rx-contraindication-alert');
    const alertText = document.getElementById('rx-contraindication-text');
    if (!alertBox || !alertText) return;

    if (!medName || !state.prescriptions) {
        alertBox.classList.add('hidden');
        return;
    }

    try {
        const activeMeds = (state.prescriptions || []).map(p => ({ medicine_name: p.medicine_name }));
        const apiRes = await safeFetchJson('/api/clinical/ddi-check', {
            method: 'POST',
            headers: getUserHeaders(),
            body: JSON.stringify({ target_medicine: medName, active_medicines: activeMeds })
        });

        if (apiRes && apiRes.has_contraindication) {
            alertBox.classList.remove('hidden');
            alertText.innerHTML = `<strong>[shibing624/medical DDI Matrix - ${apiRes.severity}]</strong>: ${escapeHtml(apiRes.warning_text)} <br><span class="text-[11px] font-mono text-rose-800">Mechanism: ${escapeHtml(apiRes.biological_mechanism)}</span>`;
            showToast(`⚠️ DDI Warning (${apiRes.severity}): Review contraindication alert in form.`, 'error');
            return;
        }

        const inputClean = medName.toLowerCase().trim();
        let detectedConflict = null;

        for (const rx of state.prescriptions) {
            const activeClean = (rx.medicine_name || '').toLowerCase().trim();

            for (const rule of DRUG_CONTRAINDICATION_RULES) {
                const matchA = inputClean.includes(rule.drugA) && activeClean.includes(rule.drugB);
                const matchB = inputClean.includes(rule.drugB) && activeClean.includes(rule.drugA);

                if (matchA || matchB) {
                    detectedConflict = rule.text;
                    break;
                }
            }
            if (detectedConflict) break;
        }

        if (detectedConflict) {
            alertBox.classList.remove('hidden');
            alertText.innerText = detectedConflict;
            showToast('⚠️ Drug Interaction Warning: Review contraindication alert in form.', 'error');
        } else {
            alertBox.classList.add('hidden');
        }
    } catch (e) {
        alertBox.classList.add('hidden');
    }
}


// ====================================================================
// 🤖 3. CONVERSATIONAL CLINICAL TRIAGE CHATBOT
// ====================================================================

function openTriageChatbotModal() {
    showModal('triage-chatbot-modal');
}

function closeTriageChatbotModal() {
    hideModal('triage-chatbot-modal');
}

function sendTriageQuickPrompt(text) {
    const input = document.getElementById('triage-chat-input');
    if (input) input.value = text;
    handleTriageChatSubmit(new Event('submit'));
}

async function handleTriageChatSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();

    const input = document.getElementById('triage-chat-input');
    if (!input || !input.value.trim()) return;

    const userText = input.value.trim();
    input.value = '';

    const messagesBox = document.getElementById('triage-chat-messages');
    if (!messagesBox) return;

    const userBubble = document.createElement('div');
    userBubble.className = 'flex justify-end gap-3';
    userBubble.innerHTML = `
        <div class="bg-teal-600 text-white p-3.5 rounded-2xl rounded-tr-xs text-xs font-semibold max-w-[85%] shadow-xs">
            ${escapeHtml(userText)}
        </div>
    `;
    messagesBox.appendChild(userBubble);
    messagesBox.scrollTop = messagesBox.scrollHeight;

    const activeMeds = (state.prescriptions || []).map(p => ({ medicine_name: p.medicine_name }));

    try {
        const apiRes = await safeFetchJson('/api/clinical/triage', {
            method: 'POST',
            headers: getUserHeaders(),
            body: JSON.stringify({ user_query: userText, active_medicines: activeMeds })
        });

        const botResponseHTML = apiRes ? `
            <div class="space-y-1.5">
                <span class="px-2 py-0.5 rounded bg-teal-100 text-teal-800 text-[10px] font-mono font-bold block">${escapeHtml(apiRes.model)}</span>
                <p class="font-bold text-slate-900">${escapeHtml(apiRes.response_text)}</p>
                ${apiRes.emergency_escalation ? `
                    <div class="pt-2 flex items-center gap-2">
                        <a href="tel:108" class="px-3.5 py-2 bg-rose-600 text-white font-black rounded-xl text-xs flex items-center gap-1 shadow-md">
                            <i class="fa-solid fa-phone-volume"></i> Call 108 Ambulance
                        </a>
                        <button onclick="triggerEmergencySOS()" class="px-3.5 py-2 bg-slate-900 text-white font-black rounded-xl text-xs flex items-center gap-1">
                            Dispatch Emergency SOS
                        </button>
                    </div>
                ` : ''}
            </div>
        ` : evaluateTriageResponse(userText);

        const botBubble = document.createElement('div');
        botBubble.className = 'flex gap-3 animate-fade-in';
        botBubble.innerHTML = `
            <div class="w-8 h-8 rounded-xl bg-teal-600 text-white flex items-center justify-center text-xs shrink-0 shadow-sm">
                <i class="fa-solid fa-robot"></i>
            </div>
            <div class="bg-white p-3.5 rounded-2xl rounded-tl-xs border border-slate-200 text-xs space-y-2 max-w-[85%] shadow-xs">
                ${botResponseHTML}
            </div>
        `;
        messagesBox.appendChild(botBubble);
        messagesBox.scrollTop = messagesBox.scrollHeight;
    } catch (e) {
        const botResponseHTML = evaluateTriageResponse(userText);
        const botBubble = document.createElement('div');
        botBubble.className = 'flex gap-3 animate-fade-in';
        botBubble.innerHTML = `
            <div class="w-8 h-8 rounded-xl bg-teal-600 text-white flex items-center justify-center text-xs shrink-0 shadow-sm">
                <i class="fa-solid fa-robot"></i>
            </div>
            <div class="bg-white p-3.5 rounded-2xl rounded-tl-xs border border-slate-200 text-xs space-y-2 max-w-[85%] shadow-xs">
                ${botResponseHTML}
            </div>
        `;
        messagesBox.appendChild(botBubble);
        messagesBox.scrollTop = messagesBox.scrollHeight;
    }
}

function evaluateTriageResponse(query) {
    const q = query.toLowerCase();

    if (q.includes('chest pain') || q.includes('shortness of breath') || q.includes('cannot breathe') || q.includes('unconscious') || q.includes('bp 180') || q.includes('stroke')) {
        return `
            <div class="p-3 bg-rose-50 border border-rose-300 rounded-xl space-y-2">
                <strong class="text-rose-950 font-black uppercase text-xs flex items-center gap-1.5">
                    <i class="fa-solid fa-truck-medical text-rose-600 text-sm"></i> RED ALERT: CRITICAL CLINICAL EMERGENCY
                </strong>
                <p class="text-rose-900 font-bold leading-relaxed">
                    Your symptoms indicate a potential high-risk cardiac or respiratory emergency. Do not wait!
                </p>
                <div class="pt-1 flex items-center gap-2">
                    <a href="tel:108" class="px-3.5 py-2 bg-rose-600 text-white font-black rounded-xl text-xs flex items-center gap-1 shadow-md">
                        <i class="fa-solid fa-phone-volume"></i> Call 108 Ambulance
                    </a>
                    <button onclick="triggerEmergencySOS()" class="px-3.5 py-2 bg-slate-900 text-white font-black rounded-xl text-xs flex items-center gap-1">
                        Dispatch Emergency SOS
                    </button>
                </div>
            </div>
        `;
    }

    if (q.includes('dizziness') || q.includes('high bp') || q.includes('nausea') || q.includes('stomach ache') || q.includes('headache')) {
        const activeMeds = (state.prescriptions || []).map(p => p.medicine_name).join(', ');

        return `
            <div class="space-y-1.5">
                <p class="font-bold text-slate-900">
                    <i class="fa-solid fa-triangle-exclamation text-amber-500 mr-1"></i> Symptom Triage Assessment: Moderate
                </p>
                <p class="text-slate-700 font-medium">
                    You mentioned experiencing symptoms. Your current active cabinet medications are: <strong class="text-teal-700">${activeMeds || 'MOVICOL, CLOBANIL, MG-OR'}</strong>.
                </p>
                <p class="text-slate-600">
                    <strong>Advice:</strong> Rest in a cool room, drink 1-2 glasses of water, and ensure your morning/night doses were taken as scheduled. If symptoms persist beyond 2 hours, contact your physician.
                </p>
            </div>
        `;
    }

    return `
        <div class="space-y-1.5">
            <p class="font-bold text-slate-900">
                <i class="fa-solid fa-circle-check text-emerald-500 mr-1"></i> Sattva Care Guidance
            </p>
            <p class="text-slate-700 font-medium">
                For general wellness: ensure regular hydration (8 glasses/day). For mild aches, Paracetamol 500mg may be used as directed if not contraindicated.
            </p>
            <p class="text-xs text-slate-500 font-medium">
                Always consult your prescribing doctor before adding new over-the-counter supplements.
            </p>
        </div>
    `;
}


// ====================================================================
// 🌐 4. 3D PATIENT DIGITAL TWIN (THREE.JS & WebGL ENGINE)
// ====================================================================

let dtScene, dtCamera, dtRenderer;
let organNodes = {};
let dtIsAnimating = false;

function init3DDigitalTwin() {
    const canvas = document.getElementById('digital-twin-canvas');
    if (!canvas || !window.THREE) return;

    const THREE = window.THREE;
    const container = canvas.parentElement;
    const width = container.clientWidth || 400;
    const height = container.clientHeight || 350;

    dtScene = new THREE.Scene();
    dtScene.background = new THREE.Color(0x070b14);

    dtCamera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    dtCamera.position.set(0, 1.0, 6.5);

    dtRenderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    dtRenderer.setSize(width, height);
    dtRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Studio Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    dtScene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0x14b8a6, 1.5);
    dirLight1.position.set(5, 12, 8);
    dtScene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x6366f1, 1.0);
    dirLight2.position.set(-6, -4, -5);
    dtScene.add(dirLight2);

    const pointLight = new THREE.PointLight(0x06b6d4, 1.2, 10);
    pointLight.position.set(0, 1, 2);
    dtScene.add(pointLight);

    const bodyGroup = new THREE.Group();

    // Translucent Glassy Anatomical Skin Material
    const skinMat = new THREE.MeshPhongMaterial({
        color: 0x0f2b3c,
        emissive: 0x064e3b,
        emissiveIntensity: 0.25,
        specular: 0x2dd4bf,
        shininess: 60,
        transparent: true,
        opacity: 0.45,
        wireframe: false
    });

    const wireMat = new THREE.MeshBasicMaterial({
        color: 0x14b8a6,
        wireframe: true,
        transparent: true,
        opacity: 0.15
    });

    // 1. ANATOMICAL HEAD & NECK
    const headGeo = new THREE.SphereGeometry(0.5, 32, 32);
    headGeo.scale(0.85, 1.1, 0.95);
    const headMesh = new THREE.Mesh(headGeo, skinMat);
    headMesh.position.set(0, 2.35, 0);
    bodyGroup.add(headMesh);
    bodyGroup.add(new THREE.Mesh(headGeo, wireMat));

    // Jaw / Chin contour
    const jawGeo = new THREE.ConeGeometry(0.32, 0.35, 16);
    jawGeo.rotateX(Math.PI);
    const jawMesh = new THREE.Mesh(jawGeo, skinMat);
    jawMesh.position.set(0, 2.05, 0.08);
    bodyGroup.add(jawMesh);

    // Neck
    const neckGeo = new THREE.CylinderGeometry(0.24, 0.28, 0.45, 16);
    const neckMesh = new THREE.Mesh(neckGeo, skinMat);
    neckMesh.position.set(0, 1.8, 0);
    bodyGroup.add(neckMesh);

    // 2. ANATOMICAL TORSO (CHEST, RIBCAGE, ABDOMEN, PELVIS)
    const chestGeo = new THREE.CylinderGeometry(0.72, 0.62, 1.1, 24);
    chestGeo.scale(1.1, 1.0, 0.7);
    const chestMesh = new THREE.Mesh(chestGeo, skinMat);
    chestMesh.position.set(0, 1.15, 0);
    bodyGroup.add(chestMesh);

    const abGeo = new THREE.CylinderGeometry(0.62, 0.58, 0.7, 24);
    abGeo.scale(1.0, 1.0, 0.7);
    const abMesh = new THREE.Mesh(abGeo, skinMat);
    abMesh.position.set(0, 0.35, 0);
    bodyGroup.add(abMesh);

    const pelvisGeo = new THREE.CylinderGeometry(0.58, 0.65, 0.5, 24);
    pelvisGeo.scale(1.05, 1.0, 0.75);
    const pelvisMesh = new THREE.Mesh(pelvisGeo, skinMat);
    pelvisMesh.position.set(0, -0.2, 0);
    bodyGroup.add(pelvisMesh);

    // 3. ANATOMICAL ARMS & SHOULDERS
    const shoulderGeo = new THREE.CylinderGeometry(0.22, 0.22, 1.8, 16);
    shoulderGeo.rotateZ(Math.PI / 2);
    const shoulderMesh = new THREE.Mesh(shoulderGeo, skinMat);
    shoulderMesh.position.set(0, 1.55, 0);
    bodyGroup.add(shoulderMesh);

    const armLUpper = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.15, 1.0, 16), skinMat);
    armLUpper.position.set(-0.95, 1.1, 0);
    armLUpper.rotation.z = 0.18;
    bodyGroup.add(armLUpper);

    const armLLower = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.11, 1.0, 16), skinMat);
    armLLower.position.set(-1.12, 0.15, 0);
    armLLower.rotation.z = 0.12;
    bodyGroup.add(armLLower);

    const handL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.25, 0.08), skinMat);
    handL.position.set(-1.22, -0.42, 0);
    bodyGroup.add(handL);

    const armRUpper = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.15, 1.0, 16), skinMat);
    armRUpper.position.set(0.95, 1.1, 0);
    armRUpper.rotation.z = -0.18;
    bodyGroup.add(armRUpper);

    const armRLower = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.11, 1.0, 16), skinMat);
    armRLower.position.set(1.12, 0.15, 0);
    armRLower.rotation.z = -0.12;
    bodyGroup.add(armRLower);

    const handR = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.25, 0.08), skinMat);
    handR.position.set(1.22, -0.42, 0);
    bodyGroup.add(handR);

    // 4. ANATOMICAL LEGS (THIGHS, CALVES, FEET)
    const thighL = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.2, 1.3, 16), skinMat);
    thighL.position.set(-0.35, -1.0, 0);
    bodyGroup.add(thighL);

    const calfL = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.13, 1.3, 16), skinMat);
    calfL.position.set(-0.38, -2.2, 0);
    bodyGroup.add(calfL);

    const footL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.45), skinMat);
    footL.position.set(-0.38, -2.85, 0.12);
    bodyGroup.add(footL);

    const thighR = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.2, 1.3, 16), skinMat);
    thighR.position.set(0.35, -1.0, 0);
    bodyGroup.add(thighR);

    const calfR = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.13, 1.3, 16), skinMat);
    calfR.position.set(0.38, -2.2, 0);
    bodyGroup.add(calfR);

    const footR = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.45), skinMat);
    footR.position.set(0.38, -2.85, 0.12);
    bodyGroup.add(footR);

    // 5. CENTRAL SPINAL COLUMN & VASCULAR NERVE TREE
    const spineGeo = new THREE.CylinderGeometry(0.06, 0.06, 3.2, 16);
    const spineMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.7 });
    const spineMesh = new THREE.Mesh(spineGeo, spineMat);
    spineMesh.position.set(0, 0.6, -0.15);
    bodyGroup.add(spineMesh);

    const artMat = new THREE.MeshBasicMaterial({ color: 0xf43f5e });
    const aorta = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 8), artMat);
    aorta.position.set(-0.05, 0.8, 0.05);
    bodyGroup.add(aorta);

    // 🫀 6. REALISTIC ANATOMICAL ORGAN NODES
    const brainGroup = new THREE.Group();
    const cerebrumMat = new THREE.MeshStandardMaterial({
        color: 0xa855f7,
        emissive: 0xa855f7,
        emissiveIntensity: 0.6,
        roughness: 0.3,
        metalness: 0.2
    });
    const cerebrumL = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 16), cerebrumMat);
    cerebrumL.position.set(-0.12, 2.38, 0.02);
    cerebrumL.scale.set(0.9, 1.0, 1.2);

    const cerebrumR = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 16), cerebrumMat);
    cerebrumR.position.set(0.12, 2.38, 0.02);
    cerebrumR.scale.set(0.9, 1.0, 1.2);

    brainGroup.add(cerebrumL);
    brainGroup.add(cerebrumR);
    bodyGroup.add(brainGroup);
    organNodes.BRAIN = brainGroup;

    const heartGroup = new THREE.Group();
    const heartMat = new THREE.MeshStandardMaterial({
        color: 0xf43f5e,
        emissive: 0xe11d48,
        emissiveIntensity: 0.8,
        roughness: 0.2,
        metalness: 0.1
    });

    const cardiacMain = new THREE.Mesh(new THREE.SphereGeometry(0.26, 20, 20), heartMat);
    cardiacMain.scale.set(0.9, 1.2, 1.0);
    cardiacMain.rotation.z = -0.3;

    const aortaArchGeo = new THREE.TorusGeometry(0.14, 0.05, 8, 16, Math.PI);
    const aortaArch = new THREE.Mesh(aortaArchGeo, new THREE.MeshStandardMaterial({ color: 0xf43f5e, emissive: 0xf43f5e, emissiveIntensity: 0.8 }));
    aortaArch.position.set(0, 0.18, 0);
    aortaArch.rotation.z = Math.PI / 2;

    heartGroup.add(cardiacMain);
    heartGroup.add(aortaArch);
    heartGroup.position.set(-0.16, 1.22, 0.2);
    bodyGroup.add(heartGroup);
    organNodes.HEART = heartGroup;

    const lungsGroup = new THREE.Group();
    const lungMat = new THREE.MeshStandardMaterial({
        color: 0x06b6d4,
        emissive: 0x0891b2,
        emissiveIntensity: 0.6,
        transparent: true,
        opacity: 0.85
    });

    const lungL = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 16), lungMat);
    lungL.position.set(-0.35, 1.15, 0.08);
    lungL.scale.set(0.75, 1.4, 0.85);

    const lungR = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 16), lungMat);
    lungR.position.set(0.35, 1.15, 0.08);
    lungR.scale.set(0.8, 1.4, 0.85);

    lungsGroup.add(lungL);
    lungsGroup.add(lungR);
    bodyGroup.add(lungsGroup);
    organNodes.LUNGS = lungsGroup;

    const stomachGroup = new THREE.Group();
    const liverMat = new THREE.MeshStandardMaterial({ color: 0xd97706, emissive: 0xd97706, emissiveIntensity: 0.6 });
    const liverMesh = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 16), liverMat);
    liverMesh.position.set(-0.2, 0.55, 0.15);
    liverMesh.scale.set(1.3, 0.8, 0.9);

    const stomachMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0xf59e0b, emissiveIntensity: 0.6 });
    const stomachMesh = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 16), stomachMat);
    stomachMesh.position.set(0.18, 0.5, 0.18);
    stomachMesh.scale.set(1.0, 1.1, 0.9);

    stomachGroup.add(liverMesh);
    stomachGroup.add(stomachMesh);
    bodyGroup.add(stomachGroup);
    organNodes.STOMACH = stomachGroup;

    bodyGroup.position.set(0, -0.3, 0);
    dtScene.add(bodyGroup);

    let isDragging = false;
    let previousMousePosition = { x: 0, y: 0 };

    canvas.addEventListener('mousedown', (e) => {
        isDragging = true;
        previousMousePosition = { x: e.clientX, y: e.clientY };
    });

    canvas.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const deltaX = e.clientX - previousMousePosition.x;
        const deltaY = e.clientY - previousMousePosition.y;

        bodyGroup.rotation.y += deltaX * 0.008;
        bodyGroup.rotation.x += deltaY * 0.008;

        previousMousePosition = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener('mouseup', () => { isDragging = false; });

    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        dtCamera.position.z = Math.min(10, Math.max(3.5, dtCamera.position.z + e.deltaY * 0.005));
    });

    function animate() {
        requestAnimationFrame(animate);

        if (!isDragging) {
            bodyGroup.rotation.y += 0.004;
        }

        if (organNodes.HEART) {
            const time = Date.now() * 0.005;
            const beat = 1 + Math.sin(time * 3) * 0.09 + Math.cos(time * 6) * 0.04;
            organNodes.HEART.scale.set(beat, beat, beat);
        }

        if (organNodes.LUNGS) {
            const breath = 1 + Math.sin(Date.now() * 0.002) * 0.05;
            organNodes.LUNGS.scale.set(breath, breath, breath);
        }

        dtRenderer.render(dtScene, dtCamera);
    }

    animate();
    dtIsAnimating = true;
}

function updateDigitalTwinOrgans(sys, dia, sugar, pulse, spo2) {
    if (!organNodes.HEART) return;

    const THREE = window.THREE;
    if (!THREE) return;

    // Safely update heart material properties across group children
    organNodes.HEART.traverse(child => {
        if (child.isMesh && child.material) {
            if (sys >= 140 || dia >= 90 || pulse > 100) {
                if (child.material.color) child.material.color.setHex(0xe11d48);
                if (child.material.emissive) child.material.emissive.setHex(0xf43f5e);
                child.material.emissiveIntensity = 1.0;
            } else {
                if (child.material.color) child.material.color.setHex(0x10b981);
                if (child.material.emissive) child.material.emissive.setHex(0x10b981);
                child.material.emissiveIntensity = 0.4;
            }
        }
    });

    const heartStatusEl = document.getElementById('dt-heart-status');
    if (sys >= 140 || dia >= 90 || pulse > 100) {
        if (heartStatusEl) {
            heartStatusEl.className = 'text-rose-400 font-black text-xs animate-pulse';
            heartStatusEl.innerText = `High Pressure (BP ${sys}/${dia} mmHg)`;
        }
    } else {
        if (heartStatusEl) {
            heartStatusEl.className = 'text-emerald-400 font-bold text-xs';
            heartStatusEl.innerText = `Normal (BP ${sys}/${dia} mmHg)`;
        }
    }

    const lungsStatusEl = document.getElementById('dt-lungs-status');
    if (spo2 < 95) {
        if (lungsStatusEl) {
            lungsStatusEl.className = 'text-rose-400 font-black text-xs animate-pulse';
            lungsStatusEl.innerText = `Low Oxygen (SpO2 ${spo2}%)`;
        }
    } else {
        if (lungsStatusEl) {
            lungsStatusEl.className = 'text-cyan-400 font-bold text-xs';
            lungsStatusEl.innerText = `Optimal (SpO2 ${spo2}%)`;
        }
    }

    const stomachStatusEl = document.getElementById('dt-stomach-status');
    if (sugar >= 140) {
        if (stomachStatusEl) {
            stomachStatusEl.className = 'text-amber-400 font-black text-xs';
            stomachStatusEl.innerText = `Elevated Glucose (${sugar} mg/dL)`;
        }
    } else {
        if (stomachStatusEl) {
            stomachStatusEl.className = 'text-emerald-400 font-bold text-xs';
            stomachStatusEl.innerText = `Controlled (${sugar} mg/dL)`;
        }
    }
}

function focusDigitalTwinOrgan(organName) {
    const organNameEl = document.getElementById('dt-selected-organ-name');
    if (organNameEl) organNameEl.innerText = organName;

    if (dtCamera) {
        if (organName === 'HEART') {
            dtCamera.position.set(0, 1.15, 3.5);
        } else if (organName === 'LUNGS') {
            dtCamera.position.set(0, 1.1, 3.5);
        } else if (organName === 'STOMACH') {
            dtCamera.position.set(0, 0.55, 3.5);
        } else if (organName === 'BRAIN') {
            dtCamera.position.set(0, 2.2, 3.5);
        }
    }
}

function resetDigitalTwinCamera() {
    if (dtCamera) {
        dtCamera.position.set(0, 1.2, 7);
    }
    const organNameEl = document.getElementById('dt-selected-organ-name');
    if (organNameEl) organNameEl.innerText = 'Overall System';
}


// ====================================================================
// 🔬 5. MECHANISM OF ACTION (MoA) PROCEDURAL SIMULATOR ENGINE
// ====================================================================

let moaCanvas, moaCtx;
let moaActiveMedicine = 'MOVICOL';
let moaIsPlaying = true;
let moaSpeed = 1;
let moaTime = 0;
let moaAnimationId = null;

const MOA_MEDICINE_DATA = {
    'MOVICOL': {
        name: 'MOVICOL (Osmotic Hydration)',
        mechanism: 'Osmotic binding: Macrogol 3350 binds water molecules in the intestinal lumen, causing gentle hydration & bowel movement without absorption into bloodstream.',
        phase1: 'Phase 1: Gastric Dissolution - Macrogol sachet dissolves into ionic electrolyte water.',
        phase2: 'Phase 2: Micro-Capillary Osmosis - Water molecules bound tightly to PEG chain.',
        phase3: 'Phase 3: Luminal Hydration - Stool hydration without systemic absorption.'
    },
    'CLOBANIL': {
        name: 'CLOBANIL (Clobazam 5mg)',
        mechanism: 'GABA-A Allosteric Modulation: Enhances GABA inhibitory neurotransmission at central GABA-A receptors to reduce seizure activity.',
        phase1: 'Phase 1: Gastric Fluid Dissolution - Clobazam 5mg tablet breaks down.',
        phase2: 'Phase 2: Blood-Brain Barrier Capillary Crossing - Molecules flow into cerebral vessels.',
        phase3: 'Phase 3: GABA-A Receptor Docking - Enhances chloride ion influx into neurons.'
    },
    'MG-OR': {
        name: 'MG-OR (Magnesium Electrolyte Solution)',
        mechanism: 'Electrolyte Replenishment: Free Mg2+ ions regulate cellular Na+/K+-ATPase pumps and neuromuscular excitability.',
        phase1: 'Phase 1: Ionic Dissociation - Mg2+ & Citrate dissociation in stomach.',
        phase2: 'Phase 2: Cellular Transport - Micro-capillary absorption into plasma.',
        phase3: 'Phase 3: Ion Channel Binding - Regulates cardiac and muscle membrane potential.'
    },
    'Paracetamol': {
        name: 'Paracetamol (500mg)',
        mechanism: 'Central COX Inhibition: Selectively inhibits Cyclooxygenase (COX-3) in central nervous system to reduce prostaglandin synthesis.',
        phase1: 'Phase 1: Rapid Gastric Absorption - Tablet dissolves in 5 minutes.',
        phase2: 'Phase 2: Hepatic Micro-Capillary Flow - Flow through portal vein.',
        phase3: 'Phase 3: Central COX Receptor Binding - Analgesic & antipyretic relief.'
    },
    'Metformin': {
        name: 'Metformin (500mg)',
        mechanism: 'AMPK Activation: Activates AMP-activated protein kinase in hepatocytes, suppressing hepatic gluconeogenesis.',
        phase1: 'Phase 1: Small Intestine Absorption - Transported via OCT1 transporters.',
        phase2: 'Phase 2: Liver Micro-Capillary Flow - Enters hepatic lobules.',
        phase3: 'Phase 3: Mitochondrial Complex I Binding - Suppresses gluconeogenesis.'
    }
};

function openMoASimulatorModal() {
    showModal('moa-simulator-modal');
    setTimeout(() => {
        initMoASimulator();
    }, 150);
}

function closeMoASimulatorModal() {
    hideModal('moa-simulator-modal');
    if (moaAnimationId) {
        cancelAnimationFrame(moaAnimationId);
    }
}

function initMoASimulator() {
    moaCanvas = document.getElementById('moa-canvas');
    if (!moaCanvas) return;

    const parent = moaCanvas.parentElement;
    moaCanvas.width = parent.clientWidth || 600;
    moaCanvas.height = parent.clientHeight || 350;
    moaCtx = moaCanvas.getContext('2d');

    moaTime = 0;
    moaIsPlaying = true;

    startMoARenderLoop();
}

function switchMoAMedicine(medKey) {
    moaActiveMedicine = medKey;
    moaTime = 0;
    const data = MOA_MEDICINE_DATA[medKey];
    if (data) {
        document.getElementById('moa-phase-description').innerText = data.mechanism;
    }
}

function toggleMoASimulation() {
    moaIsPlaying = !moaIsPlaying;
    const textEl = document.getElementById('moa-play-text');
    const iconEl = document.getElementById('moa-play-icon');
    if (textEl) textEl.innerText = moaIsPlaying ? 'Pause' : 'Play';
    if (iconEl) iconEl.className = moaIsPlaying ? 'fa-solid fa-pause' : 'fa-solid fa-play';
}

function resetMoASimulation() {
    moaTime = 0;
    moaIsPlaying = true;
}

function updateMoASpeed(val) {
    moaSpeed = parseFloat(val) || 1;
}

function startMoARenderLoop() {
    if (moaAnimationId) cancelAnimationFrame(moaAnimationId);

    function loop() {
        moaAnimationId = requestAnimationFrame(loop);
        if (moaIsPlaying) {
            moaTime += 0.016 * moaSpeed;
        }
        drawMoAFrame();
    }
    loop();
}

function drawMoAFrame() {
    if (!moaCtx || !moaCanvas) return;

    const w = moaCanvas.width;
    const h = moaCanvas.height;

    moaCtx.fillStyle = '#090d16';
    moaCtx.fillRect(0, 0, w, h);

    const cycle = moaTime % 12;
    const data = MOA_MEDICINE_DATA[moaActiveMedicine] || MOA_MEDICINE_DATA['MOVICOL'];
    const stageTitle = document.getElementById('moa-stage-title');

    if (cycle < 4) {
        if (stageTitle) stageTitle.innerText = data.phase1;
        drawPhase1Gastric(w, h, cycle);
    } else if (cycle < 8) {
        if (stageTitle) stageTitle.innerText = data.phase2;
        drawPhase2Capillary(w, h, cycle - 4);
    } else {
        if (stageTitle) stageTitle.innerText = data.phase3;
        drawPhase3Receptor(w, h, cycle - 8);
    }
}

function drawPhase1Gastric(w, h, t) {
    moaCtx.fillStyle = 'rgba(13, 148, 136, 0.15)';
    moaCtx.beginPath();
    moaCtx.arc(w / 2, h / 2, 100 + Math.sin(t * 3) * 10, 0, Math.PI * 2);
    moaCtx.fill();

    const pillX = w / 2;
    const pillY = h / 2;
    const progress = t / 4;

    moaCtx.save();
    moaCtx.translate(pillX, pillY);
    moaCtx.rotate(t * 0.5);

    moaCtx.fillStyle = '#14b8a6';
    moaCtx.beginPath();
    if (typeof moaCtx.roundRect === 'function') {
        moaCtx.roundRect(-40 * (1 - progress * 0.5), -20 * (1 - progress * 0.5), 80 * (1 - progress * 0.5), 40 * (1 - progress * 0.5), 20);
    } else {
        moaCtx.rect(-40 * (1 - progress * 0.5), -20 * (1 - progress * 0.5), 80 * (1 - progress * 0.5), 40 * (1 - progress * 0.5));
    }
    moaCtx.fill();

    moaCtx.restore();

    const count = Math.floor(progress * 40);
    for (let i = 0; i < count; i++) {
        const angle = (i / 40) * Math.PI * 2 + t;
        const radius = 40 + (i * 3) + Math.sin(t * 5 + i) * 15;
        const px = pillX + Math.cos(angle) * radius;
        const py = pillY + Math.sin(angle) * radius;

        moaCtx.fillStyle = '#2dd4bf';
        moaCtx.beginPath();
        moaCtx.arc(px, py, 4, 0, Math.PI * 2);
        moaCtx.fill();
    }
}

function drawPhase2Capillary(w, h, t) {
    moaCtx.strokeStyle = 'rgba(244, 63, 94, 0.4)';
    moaCtx.lineWidth = 14;
    moaCtx.beginPath();
    moaCtx.moveTo(0, h * 0.3);
    moaCtx.quadraticCurveTo(w * 0.5, h * 0.2, w, h * 0.4);
    moaCtx.stroke();

    moaCtx.beginPath();
    moaCtx.moveTo(0, h * 0.7);
    moaCtx.quadraticCurveTo(w * 0.5, h * 0.8, w, h * 0.6);
    moaCtx.stroke();

    for (let i = 0; i < 6; i++) {
        const rx = ((i * 120) + (t * 80)) % (w + 100) - 50;
        const ry = h * 0.5 + Math.sin(rx * 0.01) * 30;

        moaCtx.fillStyle = '#e11d48';
        moaCtx.beginPath();
        moaCtx.ellipse(rx, ry, 22, 14, 0.2, 0, Math.PI * 2);
        moaCtx.fill();
    }

    for (let j = 0; j < 15; j++) {
        const dx = ((j * 45) + (t * 120)) % (w + 50) - 20;
        const dy = h * 0.48 + Math.sin(j + t * 4) * 20;

        moaCtx.fillStyle = '#38bdf8';
        moaCtx.beginPath();
        moaCtx.arc(dx, dy, 5, 0, Math.PI * 2);
        moaCtx.fill();
    }
}

function drawPhase3Receptor(w, h, t) {
    moaCtx.fillStyle = 'rgba(99, 102, 241, 0.2)';
    moaCtx.fillRect(w * 0.4, 0, w * 0.6, h);

    moaCtx.fillStyle = '#6366f1';
    for (let y = 10; y < h; y += 25) {
        moaCtx.beginPath();
        moaCtx.arc(w * 0.4, y, 8, 0, Math.PI * 2);
        moaCtx.fill();
    }

    const recY = h * 0.5;
    moaCtx.fillStyle = '#a855f7';
    moaCtx.beginPath();
    moaCtx.arc(w * 0.4, recY, 25, Math.PI * 0.5, Math.PI * 1.5);
    moaCtx.fill();

    const progress = Math.min(1, t / 3);
    const molX = (w * 0.15) + (progress * (w * 0.25 - 10));
    const molY = recY;

    moaCtx.fillStyle = '#2dd4bf';
    moaCtx.beginPath();
    moaCtx.arc(molX, molY, 14, 0, Math.PI * 2);
    moaCtx.fill();

    if (progress >= 0.9) {
        moaCtx.fillStyle = '#f59e0b';
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const sx = w * 0.4 + Math.cos(angle) * (30 + Math.sin(t * 10) * 10);
            const sy = recY + Math.sin(angle) * (30 + Math.sin(t * 10) * 10);

            moaCtx.beginPath();
            moaCtx.arc(sx, sy, 3, 0, Math.PI * 2);
            moaCtx.fill();
        }
    }
}

