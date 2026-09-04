const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

let supabase = null;
let isSupabaseConnected = false;

if (SUPABASE_URL && SUPABASE_KEY && 
    !SUPABASE_URL.includes('your-project-id') && 
    !SUPABASE_KEY.includes('your-supabase-anon')) {
    try {
        supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
        isSupabaseConnected = true;
        console.log('⚡ Patient Portal connected directly to Supabase PostgreSQL Backend');
    } catch (err) {
        console.warn('⚠️ Supabase connection error:', err.message);
        isSupabaseConnected = false;
    }
}

// Storage paths
const DATA_DIR = path.join(__dirname, 'data');
const PRESCRIPTIONS_FILE = path.join(DATA_DIR, 'patient_prescriptions.json');
const LOGS_FILE = path.join(DATA_DIR, 'medication_logs.json');
const ORDERS_FILE = path.join(DATA_DIR, 'pharmacy_orders.json');

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(PRESCRIPTIONS_FILE)) {
    fs.writeFileSync(PRESCRIPTIONS_FILE, JSON.stringify([], null, 2));
}

if (!fs.existsSync(LOGS_FILE)) {
    fs.writeFileSync(LOGS_FILE, JSON.stringify([], null, 2));
}

if (!fs.existsSync(ORDERS_FILE)) {
    fs.writeFileSync(ORDERS_FILE, JSON.stringify([], null, 2));
}

function readLocalPrescriptions() {
    try {
        return JSON.parse(fs.readFileSync(PRESCRIPTIONS_FILE, 'utf-8'));
    } catch (e) {
        return [];
    }
}

function writeLocalPrescriptions(data) {
    fs.writeFileSync(PRESCRIPTIONS_FILE, JSON.stringify(data, null, 2));
}

function readLocalLogs() {
    try {
        return JSON.parse(fs.readFileSync(LOGS_FILE, 'utf-8'));
    } catch (e) {
        return [];
    }
}

function writeLocalLogs(data) {
    fs.writeFileSync(LOGS_FILE, JSON.stringify(data, null, 2));
}

function readLocalOrders() {
    try {
        return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf-8'));
    } catch (e) {
        return [];
    }
}

function writeLocalOrders(data) {
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(data, null, 2));
}

// Infer frequency type accurately even with un-migrated Supabase schemas
function inferFrequencyType(rx) {
    const text = (rx.instructions || '').toUpperCase();
    
    // Explicit instructions check first (overrides stale default DB column values)
    if (text.includes('NIGHT ONLY') || text.includes('BEDTIME') || text.includes('AT NIGHT') || text.includes('IN NIGHT') || text.includes('[NIGHT ONLY]')) return 'ONCE_NIGHT';
    if (text.includes('MORNING ONLY') || text.includes('IN MORNING') || text.includes('EVERY MORNING') || text.includes('[MORNING ONLY]')) return 'ONCE_MORNING';
    if (text.includes('THRICE') || text.includes('3 TIMES') || text.includes('[THRICE DAILY]')) return 'THRICE_DAILY';
    if (text.includes('FOUR TIMES') || text.includes('4 TIMES') || text.includes('[FOUR TIMES DAILY]')) return 'FOUR_TIMES_DAILY';
    if (text.includes('AS NEEDED') || text.includes('PRN')) return 'AS_NEEDED';

    // If explicit valid frequency type exists and doesn't conflict with daily_frequency count
    if (rx.dosage_frequency_type) {
        const type = rx.dosage_frequency_type;
        const count = parseFloat(rx.daily_frequency);

        if (type === 'ONCE_NIGHT' || type === 'ONCE_MORNING') return type;
        if (type === 'THRICE_DAILY' && (count === 3 || !count)) return 'THRICE_DAILY';
        if (type === 'FOUR_TIMES_DAILY' && (count === 4 || !count)) return 'FOUR_TIMES_DAILY';
        if (type === 'AS_NEEDED') return 'AS_NEEDED';
        if (type === 'TWICE_DAILY' && count === 1) return 'ONCE_NIGHT';
        if (type === 'TWICE_DAILY') return 'TWICE_DAILY';
    }

    const count = parseFloat(rx.daily_frequency);
    if (count === 1.0) return 'ONCE_NIGHT';
    if (count === 3.0) return 'THRICE_DAILY';
    if (count === 4.0) return 'FOUR_TIMES_DAILY';

    return 'TWICE_DAILY';
}

function inferPrescriptionType(rx) {
    if (rx.prescription_type && ['RX', 'NRX', 'TRX', 'OTC'].includes(String(rx.prescription_type).toUpperCase())) {
        return String(rx.prescription_type).toUpperCase();
    }
    const combined = ((rx.prescription_number || '') + ' ' + (rx.instructions || '') + ' ' + (rx.medicine_name || '')).toUpperCase();
    if (combined.includes('NRX') || combined.includes('SCHEDULE H') || combined.includes('NARCOTIC') || combined.includes('CONTROLLED')) return 'NRX';
    if (combined.includes('TRX') || combined.includes('TRANSFER') || combined.includes('CHRONIC')) return 'TRX';
    if (combined.includes('OTC') || combined.includes('OVER THE COUNTER') || combined.includes('SUPPLEMENT')) return 'OTC';
    return 'RX';
}

function getPrescriptionTypeLabel(type) {
    switch ((type || 'RX').toUpperCase()) {
        case 'NRX': return 'NRx (Controlled Substance)';
        case 'TRX': return 'TRx (Chronic Care Refill)';
        case 'OTC': return 'OTC (Over-The-Counter)';
        case 'RX': default: return 'Rx (Standard Prescription)';
    }
}

function inferTabletsPerDose(rx) {
    if (rx.tablets_per_dose && !isNaN(parseFloat(rx.tablets_per_dose))) {
        return parseFloat(rx.tablets_per_dose);
    }
    const text = ((rx.instructions || '') + ' ' + (rx.dosage_strength || '')).toUpperCase();
    if (text.includes('1/4') || text.includes('QUARTER TABLET') || text.includes('0.25')) return 0.25;
    if (text.includes('1/2') || text.includes('HALF TABLET') || text.includes('0.5')) return 0.5;
    if (text.includes('1.5') || text.includes('1 1/2') || text.includes('1.5 TABLET')) return 1.5;
    if (text.includes('2 TABLETS') || text.includes('2 TABS')) return 2.0;
    return 1.0;
}

function formatDoseQuantity(doseQty) {
    const qty = parseFloat(doseQty) || 1.0;
    if (qty === 0.25) return '1/4 Tablet (Quarter Dose)';
    if (qty === 0.5) return '1/2 Tablet (Half Dose)';
    if (qty === 0.75) return '3/4 Tablet';
    if (qty === 1.0) return '1 Tablet (Full Dose)';
    if (qty === 1.5) return '1 ½ Tablets (1.5 Dose)';
    if (qty === 2.0) return '2 Tablets (Double Dose)';
    return `${qty} Tablet(s)`;
}

function getFrequencyLabel(frequencyType) {
    switch (frequencyType) {
        case 'ONCE_MORNING': return 'Morning Only (08:00 AM)';
        case 'ONCE_NIGHT': return 'Night Only (09:00 PM)';
        case 'TWICE_DAILY': return 'Twice a Day (08:00 AM - 08:00 PM)';
        case 'THRICE_DAILY': return 'Thrice a Day (08:00 AM - 02:00 PM - 08:00 PM)';
        case 'FOUR_TIMES_DAILY': return 'Four Times a Day (08:00 AM - 01:00 PM - 05:00 PM - 09:00 PM)';
        case 'AS_NEEDED': return 'As Needed (Symptom-based)';
        default: return 'Twice a Day (08:00 AM - 08:00 PM)';
    }
}

function getDailyCount(frequencyType, manualDailyFreq, tabletsPerDose = 1.0) {
    const doseQty = parseFloat(tabletsPerDose) || 1.0;
    let intakeTimes = 2.0;
    switch (frequencyType) {
        case 'ONCE_MORNING': intakeTimes = 1.0; break;
        case 'ONCE_NIGHT': intakeTimes = 1.0; break;
        case 'TWICE_DAILY': intakeTimes = 2.0; break;
        case 'THRICE_DAILY': intakeTimes = 3.0; break;
        case 'FOUR_TIMES_DAILY': intakeTimes = 4.0; break;
        case 'AS_NEEDED': intakeTimes = 1.0; break;
        default: intakeTimes = parseFloat(manualDailyFreq) || 2.0; break;
    }
    return parseFloat((intakeTimes * doseQty).toFixed(2));
}

function formatMealRelation(type) {
    switch (type) {
        case 'BEFORE_MEAL': return 'Take on empty stomach (Before Meal)';
        case 'AFTER_MEAL': return 'Take after meal / food';
        case 'WITH_FOOD': return 'Take with first bite of food';
        case 'BEDTIME': return 'Take at bedtime';
        default: return 'Take as directed';
    }
}

// Enhance prescription with 5-Day Run-Out calculations & frequency text
function enhancePrescription(rx) {
    const freqType = inferFrequencyType(rx);
    const rxType = inferPrescriptionType(rx);
    const tabletsPerDose = inferTabletsPerDose(rx);
    const dailyFreq = getDailyCount(freqType, rx.daily_frequency, tabletsPerDose);
    const remaining = parseFloat(rx.total_tablets_remaining) || 0;
    const daysLeft = dailyFreq > 0 ? Math.floor(remaining / dailyFreq) : 999;

    const isRunoutAlert5Days = daysLeft <= 5 && remaining > 0;
    const isOutOfStock = remaining === 0;

    return {
        ...rx,
        units_per_pack: rx.units_per_pack ? parseInt(rx.units_per_pack, 10) : 10,
        prescription_type: rxType,
        dosage_frequency_type: freqType,
        tablets_per_dose: tabletsPerDose,
        daily_frequency: dailyFreq,
        days_supply_remaining: daysLeft,
        is_runout_alert_5days: isRunoutAlert5Days,
        is_out_of_stock: isOutOfStock,
        frequency_label: getFrequencyLabel(freqType),
        prescription_type_label: getPrescriptionTypeLabel(rxType),
        dose_quantity_label: formatDoseQuantity(tabletsPerDose),
        meal_relation_text: formatMealRelation(rx.meal_relation)
    };
}

function matchesUser(item, userEmail) {
    if (!userEmail || typeof userEmail !== 'string') return false;
    const target = userEmail.trim().toLowerCase();
    if (!target) return false;
    
    const itemUser = String(item.user_id || item.user_email || '').trim().toLowerCase();
    
    // Default demo user matches untagged or default patient-1 / patient@medibuddy.com items
    if (target === 'patient@medibuddy.com' || target === 'patient-1') {
        return !itemUser || itemUser === 'patient@medibuddy.com' || itemUser === 'patient-1';
    }
    
    return itemUser === target;
}

function sanitizeDbPayload(rx, userEmail = 'patient@medibuddy.com') {
    return {
        id: rx.id,
        user_id: rx.user_id || userEmail,
        medicine_name: rx.medicine_name,
        brand_name: rx.brand_name || '',
        generic_name: rx.generic_name || '',
        dosage_strength: rx.dosage_strength || '',
        medicine_type: rx.medicine_type || 'Tablet',
        prescription_type: rx.prescription_type || 'RX',
        tablets_per_dose: parseFloat(rx.tablets_per_dose) || 1.0,
        dosage_frequency_type: rx.dosage_frequency_type || 'TWICE_DAILY',
        daily_frequency: parseFloat(rx.daily_frequency) || 2.0,
        meal_relation: rx.meal_relation || 'AFTER_MEAL',
        instructions: rx.instructions || '',
        total_tablets_remaining: parseFloat(rx.total_tablets_remaining) || 0,
        refill_threshold_days: 5,
        unit_price: parseFloat(rx.unit_price) || 0,
        doctor_name: rx.doctor_name || 'Primary Physician',
        clinic_hospital: rx.clinic_hospital || '',
        pharmacy_name: rx.pharmacy_name || 'Local Pharmacy',
        prescription_number: rx.prescription_number || '',
        duration_days: rx.duration_days ? parseInt(rx.duration_days, 10) : null,
        storage_condition: rx.storage_condition || 'ROOM_TEMP',
        created_at: rx.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString()
    };
}

function sanitizeOrderDbPayload(order, userEmail = 'patient@medibuddy.com') {
    return {
        id: order.id,
        user_id: order.user_id || userEmail,
        prescription_id: order.prescription_id || null,
        medicine_name: order.medicine_name,
        brand_name: order.brand_name || '',
        pharmacy_name: order.pharmacy_name || 'Online Pharmacy',
        order_number: order.order_number || ('ORD-' + Math.floor(Math.random() * 90000 + 10000)),
        quantity_ordered: parseFloat(order.quantity_ordered) || 30.0,
        unit_price: parseFloat(order.unit_price) || 0.0,
        total_price: parseFloat(order.total_price) || 0.0,
        status: order.status || 'ORDERED',
        order_date: order.order_date || new Date().toISOString().split('T')[0],
        expected_delivery: order.expected_delivery || null,
        delivered_at: order.delivered_at || null,
        notes: order.notes || '',
        created_at: order.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString()
    };
}

function sanitizeLogDbPayload(log, userEmail = 'patient@medibuddy.com') {
    return {
        id: log.id,
        user_id: log.user_id || userEmail,
        prescription_id: log.prescription_id || null,
        medicine_name: log.medicine_name,
        brand_name: log.brand_name || '',
        scheduled_time: log.scheduled_time,
        status: log.status || 'TAKEN',
        tablets_consumed: parseFloat(log.tablets_consumed) || 1.0,
        tablets_remaining_after: parseFloat(log.tablets_remaining_after) || 0.0,
        taken_at: log.taken_at || new Date().toISOString(),
        notes: log.notes || ''
    };
}

const DB = {
    isSupabaseConnected: () => isSupabaseConnected,

    async getPrescriptions(userEmail = 'patient@medibuddy.com') {
        let rxs = [];
        if (isSupabaseConnected) {
            try {
                const { data, error } = await supabase.from('patient_prescriptions').select('*').order('created_at', { ascending: false });
                if (!error && data) {
                    rxs = data;
                } else {
                    rxs = readLocalPrescriptions();
                }
            } catch (err) {
                rxs = readLocalPrescriptions();
            }
        } else {
            rxs = readLocalPrescriptions();
        }

        const localRxs = readLocalPrescriptions();
        const map = new Map();
        rxs.forEach(item => map.set(item.id, item));
        localRxs.forEach(item => {
            if (!map.has(item.id)) map.set(item.id, item);
        });

        const userScoped = Array.from(map.values()).filter(item => matchesUser(item, userEmail));

        const uniqueMap = new Map();
        userScoped.forEach(item => {
            const key = item.id || item.medicine_name.trim().toLowerCase();
            if (!uniqueMap.has(key)) {
                uniqueMap.set(key, item);
            }
        });

        const deduplicated = Array.from(uniqueMap.values());
        return deduplicated.map(enhancePrescription);
    },

    async getPrescriptionById(id, userEmail = 'patient@medibuddy.com') {
        const rxs = await this.getPrescriptions(userEmail);
        return rxs.find(r => r.id === id) || null;
    },

    async addPrescription(data, userEmail = 'patient@medibuddy.com') {
        const newId = 'rx-' + Date.now();
        const freqType = data.dosage_frequency_type || 'TWICE_DAILY';
        const rxType = data.prescription_type ? data.prescription_type.toUpperCase() : inferPrescriptionType(data);
        const tabletsPerDose = parseFloat(data.tablets_per_dose) || 1.0;
        const dailyFreq = getDailyCount(freqType, data.daily_frequency, tabletsPerDose);
        const totalPills = parseFloat(data.total_tablets_remaining) || 30;

        let instructions = data.instructions || '';
        if (freqType === 'ONCE_NIGHT' && !instructions.toUpperCase().includes('NIGHT')) {
            instructions = (instructions ? instructions + ' ' : '') + '[NIGHT ONLY]';
        } else if (freqType === 'ONCE_MORNING' && !instructions.toUpperCase().includes('MORNING')) {
            instructions = (instructions ? instructions + ' ' : '') + '[MORNING ONLY]';
        }

        if (tabletsPerDose === 0.5 && !instructions.toUpperCase().includes('1/2')) {
            instructions = (instructions ? instructions + ' ' : '') + '[1/2 TABLET]';
        } else if (tabletsPerDose === 0.25 && !instructions.toUpperCase().includes('1/4')) {
            instructions = (instructions ? instructions + ' ' : '') + '[1/4 TABLET]';
        }

        if (rxType === 'NRX' && !instructions.toUpperCase().includes('NRX')) {
            instructions = (instructions ? instructions + ' ' : '') + '[NRX MEDICINE]';
        } else if (rxType === 'TRX' && !instructions.toUpperCase().includes('TRX')) {
            instructions = (instructions ? instructions + ' ' : '') + '[TRX MEDICINE]';
        } else if (rxType === 'OTC' && !instructions.toUpperCase().includes('OTC')) {
            instructions = (instructions ? instructions + ' ' : '') + '[OTC MEDICINE]';
        }

        const newRx = {
            id: newId,
            user_id: userEmail,
            user_email: userEmail,
            medicine_name: data.medicine_name,
            brand_name: data.brand_name || '',
            generic_name: data.generic_name || '',
            dosage_strength: data.dosage_strength || '',
            medicine_type: data.medicine_type || 'Tablet',
            prescription_type: rxType,
            dosage_frequency_type: freqType,
            tablets_per_dose: tabletsPerDose,
            daily_frequency: dailyFreq,
            meal_relation: data.meal_relation || 'AFTER_MEAL',
            instructions: instructions,
            total_tablets_remaining: totalPills,
            units_per_pack: parseInt(data.units_per_pack, 10) || 10,
            refill_threshold_days: 5,
            unit_price: parseFloat(data.unit_price) || 0.0,
            doctor_name: data.doctor_name || 'Primary Physician',
            clinic_hospital: data.clinic_hospital || '',
            pharmacy_name: data.pharmacy_name || 'Local Pharmacy',
            prescription_number: data.prescription_number || (rxType + '-' + Math.floor(Math.random() * 90000 + 10000)),
            duration_days: parseInt(data.duration_days, 10) || null,
            storage_condition: data.storage_condition || 'ROOM_TEMP',
            created_at: new Date().toISOString()
        };

        if (isSupabaseConnected) {
            try {
                const dbPayload = sanitizeDbPayload(newRx, userEmail);
                const { error } = await supabase.from('patient_prescriptions').insert([dbPayload]);
                if (error) {
                    const fallbackPayload = {
                        id: newRx.id,
                        user_id: userEmail,
                        medicine_name: newRx.medicine_name,
                        brand_name: newRx.brand_name || '',
                        generic_name: newRx.generic_name || '',
                        dosage_strength: newRx.dosage_strength || '',
                        medicine_type: newRx.medicine_type || 'Tablet',
                        prescription_type: newRx.prescription_type || 'RX',
                        tablets_per_dose: parseFloat(newRx.tablets_per_dose) || 1.0,
                        dosage_frequency_type: newRx.dosage_frequency_type || 'TWICE_DAILY',
                        daily_frequency: parseFloat(newRx.daily_frequency) || 2.0,
                        meal_relation: newRx.meal_relation || 'AFTER_MEAL',
                        instructions: newRx.instructions || '',
                        total_tablets_remaining: parseFloat(newRx.total_tablets_remaining) || 0,
                        refill_threshold_days: 5,
                        unit_price: parseFloat(newRx.unit_price) || 0,
                        doctor_name: newRx.doctor_name || '',
                        clinic_hospital: newRx.clinic_hospital || '',
                        pharmacy_name: newRx.pharmacy_name || 'Local Pharmacy',
                        prescription_number: newRx.prescription_number || '',
                        duration_days: newRx.duration_days ? parseInt(newRx.duration_days, 10) : null,
                        storage_condition: newRx.storage_condition || 'ROOM_TEMP'
                    };
                    await supabase.from('patient_prescriptions').insert([fallbackPayload]);
                }
            } catch (err) {}
        }

        const localRxs = readLocalPrescriptions();
        localRxs.push(newRx);
        writeLocalPrescriptions(localRxs);

        return enhancePrescription(newRx);
    },

    async updatePrescription(id, updateData, userEmail = 'patient@medibuddy.com') {
        const existing = await this.getPrescriptionById(id, userEmail);
        if (!existing) throw new Error('Prescription record not found');

        const freqType = updateData.dosage_frequency_type || existing.dosage_frequency_type || 'TWICE_DAILY';
        const rxType = updateData.prescription_type ? updateData.prescription_type.toUpperCase() : (existing.prescription_type || inferPrescriptionType(existing));
        const tabletsPerDose = updateData.tablets_per_dose !== undefined ? parseFloat(updateData.tablets_per_dose) : (existing.tablets_per_dose || inferTabletsPerDose(existing));
        const dailyFreq = getDailyCount(freqType, updateData.daily_frequency, tabletsPerDose);

        let instructions = (updateData.instructions !== undefined ? updateData.instructions : (existing.instructions || ''))
            .replace(/\[(NRX|TRX|OTC|RX)\s*MEDICINE\]/gi, '')
            .trim();

        if (freqType === 'ONCE_NIGHT' && !instructions.toUpperCase().includes('NIGHT')) {
            instructions = (instructions ? instructions + ' ' : '') + '[NIGHT ONLY]';
        } else if (freqType === 'ONCE_MORNING' && !instructions.toUpperCase().includes('MORNING')) {
            instructions = (instructions ? instructions + ' ' : '') + '[MORNING ONLY]';
        }

        if (tabletsPerDose === 0.5 && !instructions.toUpperCase().includes('1/2')) {
            instructions = (instructions ? instructions + ' ' : '') + '[1/2 TABLET]';
        } else if (tabletsPerDose === 0.25 && !instructions.toUpperCase().includes('1/4')) {
            instructions = (instructions ? instructions + ' ' : '') + '[1/4 TABLET]';
        }

        if (rxType === 'NRX' && !instructions.toUpperCase().includes('NRX')) {
            instructions = (instructions ? instructions + ' ' : '') + '[NRX MEDICINE]';
        } else if (rxType === 'TRX' && !instructions.toUpperCase().includes('TRX')) {
            instructions = (instructions ? instructions + ' ' : '') + '[TRX MEDICINE]';
        } else if (rxType === 'OTC' && !instructions.toUpperCase().includes('OTC')) {
            instructions = (instructions ? instructions + ' ' : '') + '[OTC MEDICINE]';
        }

        const updated = {
            ...existing,
            ...updateData,
            user_id: existing.user_id || userEmail,
            user_email: existing.user_email || userEmail,
            instructions: instructions,
            prescription_type: rxType,
            dosage_frequency_type: freqType,
            tablets_per_dose: tabletsPerDose,
            daily_frequency: dailyFreq,
            updated_at: new Date().toISOString()
        };

        if (isSupabaseConnected) {
            try {
                const dbPayload = sanitizeDbPayload(updated, userEmail);
                const { error } = await supabase.from('patient_prescriptions').update(dbPayload).eq('id', id);
                if (error) {
                    const fallbackUpdate = {
                        medicine_name: updated.medicine_name,
                        brand_name: updated.brand_name || '',
                        generic_name: updated.generic_name || '',
                        dosage_strength: updated.dosage_strength || '',
                        medicine_type: updated.medicine_type || 'Tablet',
                        prescription_type: updated.prescription_type || 'RX',
                        tablets_per_dose: parseFloat(updated.tablets_per_dose) || 1.0,
                        dosage_frequency_type: updated.dosage_frequency_type || 'TWICE_DAILY',
                        daily_frequency: parseFloat(updated.daily_frequency) || 2.0,
                        meal_relation: updated.meal_relation || 'AFTER_MEAL',
                        total_tablets_remaining: parseFloat(updated.total_tablets_remaining) || 0,
                        doctor_name: updated.doctor_name || '',
                        clinic_hospital: updated.clinic_hospital || '',
                        prescription_number: updated.prescription_number || '',
                        instructions: updated.instructions || '',
                        storage_condition: updated.storage_condition || 'ROOM_TEMP'
                    };
                    await supabase.from('patient_prescriptions').update(fallbackUpdate).eq('id', id);
                }
            } catch (e) {}
        }

        const rxs = readLocalPrescriptions();
        const index = rxs.findIndex(r => r.id === id);
        if (index !== -1) {
            rxs[index] = updated;
            writeLocalPrescriptions(rxs);
        }

        return enhancePrescription(updated);
    },

    async deletePrescription(id, userEmail = 'patient@medibuddy.com') {
        if (isSupabaseConnected) {
            try {
                await supabase.from('patient_prescriptions').delete().eq('id', id);
            } catch (e) {}
        }

        let rxs = readLocalPrescriptions();
        rxs = rxs.filter(r => r.id !== id);
        writeLocalPrescriptions(rxs);

        return { success: true, id };
    },

    // Refill Pills in Cabinet
    async refillPills(id, addPillCount = 30, userEmail = 'patient@medibuddy.com') {
        const rx = await this.getPrescriptionById(id, userEmail);
        if (!rx) throw new Error('Prescription not found');

        const newTotal = parseFloat(rx.total_tablets_remaining) + parseFloat(addPillCount);
        return await this.updatePrescription(id, { total_tablets_remaining: newTotal }, userEmail);
    },

    // Single Unified Card Schedule Data
    async getTodaySchedule(userEmail = 'patient@medibuddy.com') {
        const rxs = await this.getPrescriptions(userEmail);
        const logs = readLocalLogs().filter(l => matchesUser(l, userEmail));

        const todayStr = new Date().toISOString().split('T')[0];

        return rxs.map(rx => {
            const morningLog = logs.find(l => l.prescription_id === rx.id && l.scheduled_time === 'MORNING' && l.taken_at.startsWith(todayStr));
            const afternoonLog = logs.find(l => l.prescription_id === rx.id && l.scheduled_time === 'AFTERNOON' && l.taken_at.startsWith(todayStr));
            const eveningLog = logs.find(l => l.prescription_id === rx.id && l.scheduled_time === 'EVENING' && l.taken_at.startsWith(todayStr));
            const nightLog = logs.find(l => l.prescription_id === rx.id && l.scheduled_time === 'NIGHT' && l.taken_at.startsWith(todayStr));

            return {
                ...rx,
                morning_taken: Boolean(morningLog && morningLog.status === 'TAKEN'),
                afternoon_taken: Boolean(afternoonLog && afternoonLog.status === 'TAKEN'),
                evening_taken: Boolean(eveningLog && eveningLog.status === 'TAKEN'),
                night_taken: Boolean(nightLog && nightLog.status === 'TAKEN')
            };
        });
    },

    // Toggle Specific Dose Slot
    async toggleDoseSlot({ prescription_id, slot_name, user_email = 'patient@medibuddy.com' }) {
        const rx = await this.getPrescriptionById(prescription_id, user_email);
        if (!rx) throw new Error('Prescription record not found');

        const logs = readLocalLogs();
        const todayStr = new Date().toISOString().split('T')[0];
        const existingLogIndex = logs.findIndex(l => l.prescription_id === prescription_id && l.scheduled_time === slot_name && l.taken_at.startsWith(todayStr) && matchesUser(l, user_email));

        const doseQuantity = rx.tablets_per_dose || inferTabletsPerDose(rx);
        let newRemaining = rx.total_tablets_remaining;
        let isNowTaken = false;

        if (existingLogIndex !== -1 && logs[existingLogIndex].status === 'TAKEN') {
            newRemaining = parseFloat((newRemaining + doseQuantity).toFixed(2));
            logs.splice(existingLogIndex, 1);
            isNowTaken = false;
        } else {
            if (rx.total_tablets_remaining <= 0) {
                throw new Error(`Your cabinet is empty for ${rx.medicine_name}! Please refill.`);
            }
            newRemaining = Math.max(0, parseFloat((rx.total_tablets_remaining - doseQuantity).toFixed(2)));
            isNowTaken = true;

            const newLog = {
                id: 'log-' + Date.now(),
                user_id: user_email,
                user_email: user_email,
                prescription_id,
                medicine_name: rx.medicine_name,
                brand_name: rx.brand_name || '',
                scheduled_time: slot_name,
                status: 'TAKEN',
                tablets_consumed: doseQuantity,
                tablets_remaining_after: newRemaining,
                taken_at: new Date().toISOString()
            };

            logs.unshift(newLog);

            if (isSupabaseConnected) {
                try {
                    const dbPayload = sanitizeLogDbPayload(newLog, user_email);
                    await supabase.from('medication_logs').insert([dbPayload]);
                } catch (e) {}
            }
        }

        writeLocalLogs(logs);
        await this.updatePrescription(prescription_id, { total_tablets_remaining: newRemaining }, user_email);

        return {
            prescription_id,
            slot_name,
            is_taken: isNowTaken,
            tablets_consumed: doseQuantity,
            total_tablets_remaining: newRemaining
        };
    },

    // Patient Dashboard Stats
    async getPatientStats(userEmail = 'patient@medibuddy.com') {
        const rxs = await this.getPrescriptions(userEmail);
        const schedule = await this.getTodaySchedule(userEmail);

        const totalPrescriptions = rxs.length;
        let totalPillsRemaining = 0;
        let runout5DaysCount = 0;
        let outOfStockCount = 0;

        rxs.forEach(r => {
            totalPillsRemaining += r.total_tablets_remaining || 0;
            if (r.is_runout_alert_5days) runout5DaysCount++;
            if (r.is_out_of_stock) outOfStockCount++;
        });

        let totalDosesRequiredToday = 0;
        let totalDosesTakenToday = 0;

        schedule.forEach(s => {
            let reqCount = 2;
            if (s.dosage_frequency_type === 'ONCE_MORNING' || s.dosage_frequency_type === 'ONCE_NIGHT') reqCount = 1;
            else if (s.dosage_frequency_type === 'THRICE_DAILY') reqCount = 3;
            else if (s.dosage_frequency_type === 'FOUR_TIMES_DAILY') reqCount = 4;

            totalDosesRequiredToday += reqCount;

            if (s.morning_taken) totalDosesTakenToday++;
            if (s.afternoon_taken) totalDosesTakenToday++;
            if (s.evening_taken) totalDosesTakenToday++;
            if (s.night_taken) totalDosesTakenToday++;
        });

        const adherencePercent = totalDosesRequiredToday > 0 ? Math.round((totalDosesTakenToday / totalDosesRequiredToday) * 100) : 0;

        const runoutAlertList = rxs.filter(r => r.is_runout_alert_5days).map(r => ({
            id: r.id,
            medicine_name: r.medicine_name,
            brand_name: r.brand_name,
            total_tablets_remaining: r.total_tablets_remaining,
            daily_frequency: r.daily_frequency,
            days_left: r.days_supply_remaining
        }));

        return {
            database_connected: isSupabaseConnected,
            total_prescriptions: totalPrescriptions,
            total_pills_remaining: totalPillsRemaining,
            runout_5days_count: runout5DaysCount,
            out_of_stock_count: outOfStockCount,
            today_scheduled_count: totalDosesRequiredToday,
            today_taken_count: totalDosesTakenToday,
            adherence_percentage: adherencePercent,
            critical_runout_alerts: runoutAlertList
        };
    },

    // Pharmacy Orders Management
    async getOrders(userEmail = 'patient@medibuddy.com') {
        let orders = [];
        if (isSupabaseConnected) {
            try {
                const { data, error } = await supabase.from('pharmacy_orders').select('*').order('created_at', { ascending: false });
                if (!error && data) {
                    orders = data;
                } else {
                    orders = readLocalOrders();
                }
            } catch (e) {
                orders = readLocalOrders();
            }
        } else {
            orders = readLocalOrders();
        }

        const localOrders = readLocalOrders();
        const map = new Map();
        orders.forEach(o => map.set(o.id, o));
        localOrders.forEach(o => {
            if (!map.has(o.id)) map.set(o.id, o);
        });

        const combined = Array.from(map.values());
        return combined.filter(o => matchesUser(o, userEmail));
    },

    async addOrder(data, userEmail = 'patient@medibuddy.com') {
        const newOrder = {
            id: 'ord-' + Date.now(),
            user_id: userEmail,
            user_email: userEmail,
            prescription_id: data.prescription_id || null,
            medicine_name: data.medicine_name,
            brand_name: data.brand_name || '',
            pharmacy_name: data.pharmacy_name || 'Online Pharmacy',
            order_number: data.order_number || ('ORD-' + Math.floor(Math.random() * 90000 + 10000)),
            quantity_ordered: parseFloat(data.quantity_ordered) || 30.0,
            unit_price: parseFloat(data.unit_price) || 0.0,
            total_price: parseFloat(data.total_price) || 0.0,
            status: data.status || 'ORDERED',
            order_date: data.order_date || new Date().toISOString().split('T')[0],
            expected_delivery: data.expected_delivery || null,
            notes: data.notes || '',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        if (isSupabaseConnected) {
            try {
                const dbPayload = sanitizeOrderDbPayload(newOrder, userEmail);
                await supabase.from('pharmacy_orders').insert([dbPayload]);
            } catch (e) {}
        }

        const orders = readLocalOrders();
        orders.unshift(newOrder);
        writeLocalOrders(orders);

        return newOrder;
    },

    async updateOrder(id, updateData, userEmail = 'patient@medibuddy.com') {
        let orders = readLocalOrders();
        const existingIndex = orders.findIndex(o => o.id === id);
        const existing = existingIndex !== -1 ? orders[existingIndex] : null;

        const updated = {
            ...(existing || {}),
            ...updateData,
            id,
            user_id: (existing && existing.user_id) || userEmail,
            user_email: (existing && existing.user_email) || userEmail,
            updated_at: new Date().toISOString()
        };

        if (isSupabaseConnected) {
            try {
                const dbPayload = sanitizeOrderDbPayload(updated, userEmail);
                await supabase.from('pharmacy_orders').update(dbPayload).eq('id', id);
            } catch (e) {}
        }

        if (existingIndex !== -1) {
            orders[existingIndex] = updated;
        } else {
            orders.unshift(updated);
        }
        writeLocalOrders(orders);

        return updated;
    },

    async deliverOrder(id, userEmail = 'patient@medibuddy.com') {
        const orders = await this.getOrders(userEmail);
        const order = orders.find(o => o.id === id);
        if (!order) throw new Error('Order record not found');

        const updatedOrder = await this.updateOrder(id, {
            status: 'DELIVERED',
            delivered_at: new Date().toISOString()
        }, userEmail);

        // Automatically add pills to medicine cabinet stock
        const rxs = await this.getPrescriptions(userEmail);
        let matchingRx = rxs.find(r => r.id === order.prescription_id || (r.medicine_name && order.medicine_name && r.medicine_name.trim().toLowerCase() === order.medicine_name.trim().toLowerCase()));

        if (matchingRx) {
            await this.refillPills(matchingRx.id, order.quantity_ordered, userEmail);
        } else {
            await this.addPrescription({
                medicine_name: order.medicine_name,
                brand_name: order.brand_name || '',
                total_tablets_remaining: order.quantity_ordered,
                pharmacy_name: order.pharmacy_name || 'Online Pharmacy',
                instructions: 'Delivered from pharmacy order #' + (order.order_number || '')
            }, userEmail);
        }

        return { order: updatedOrder, added_to_cabinet: true };
    },

    async deleteOrder(id, userEmail = 'patient@medibuddy.com') {
        if (isSupabaseConnected) {
            try {
                await supabase.from('pharmacy_orders').delete().eq('id', id);
            } catch (e) {}
        }

        let orders = readLocalOrders();
        orders = orders.filter(o => o.id !== id);
        writeLocalOrders(orders);

        return { success: true, id };
    }
};

module.exports = DB;

module.exports = DB;
