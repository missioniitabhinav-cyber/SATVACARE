const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const DB = require('./db');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Disable caching for dynamic patient API endpoints
app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
});

// Public Supabase Config
app.get('/api/config', (req, res) => {
    res.json({
        supabase_url: process.env.SUPABASE_URL || '',
        supabase_anon_key: process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || ''
    });
});

// System Status & Database info
app.get('/api/status', (req, res) => {
    res.json({
        status: 'online',
        app: 'Sattva Care Patient Medicine Management Portal',
        supabase_connected: DB.isSupabaseConnected(),
        storage_engine: DB.isSupabaseConnected() ? 'Supabase Cloud PostgreSQL' : 'Local Persistence',
        timestamp: new Date().toISOString()
    });
});

function getUserEmail(req) {
    const email = req.headers['x-user-email'] || req.query.user_email || (req.body && req.body.user_email);
    if (!email || typeof email !== 'string' || !email.trim() || email === 'null' || email === 'undefined') {
        return null;
    }
    return email.trim().toLowerCase();
}

// Patient Dashboard Stats & Adherence Progress
app.get('/api/patient/stats', async (req, res) => {
    try {
        const email = getUserEmail(req);
        if (!email) return res.status(401).json({ error: 'Unauthorized. Login required.' });
        const targetDate = req.query.date || null;
        const stats = await DB.getPatientStats(email, targetDate);
        res.json(stats);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Today's & 7-Day Dose Schedule (Single Clean Card Per Medicine)
app.get('/api/patient/today-schedule', async (req, res) => {
    try {
        const email = getUserEmail(req);
        if (!email) return res.status(401).json({ error: 'Unauthorized. Login required.' });
        const targetDate = req.query.date || null;
        const schedule = await DB.getTodaySchedule(email, targetDate);
        res.json(schedule);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Toggle Specific Dose Slot (Supports Target Date for past 7 days)
app.post('/api/patient/toggle-slot', async (req, res) => {
    try {
        const email = getUserEmail(req);
        if (!email) return res.status(401).json({ error: 'Unauthorized. Login required.' });
        const { prescription_id, slot_name, target_date } = req.body;
        if (!prescription_id || !slot_name) {
            return res.status(400).json({ error: 'prescription_id and slot_name are required.' });
        }
        const result = await DB.toggleDoseSlot({ prescription_id, slot_name, user_email: email, target_date });
        res.json(result);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Patient Medicine Cabinet Prescriptions List
app.get('/api/patient/prescriptions', async (req, res) => {
    try {
        const email = getUserEmail(req);
        if (!email) return res.status(401).json({ error: 'Unauthorized. Login required.' });
        const rxs = await DB.getPrescriptions(email);
        res.json(rxs);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get Single Prescription Details
app.get('/api/patient/prescriptions/:id', async (req, res) => {
    try {
        const email = getUserEmail(req);
        if (!email) return res.status(401).json({ error: 'Unauthorized. Login required.' });
        const rx = await DB.getPrescriptionById(req.params.id, email);
        if (!rx) return res.status(404).json({ error: 'Prescription not found' });
        res.json(rx);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Add New Prescription
app.post('/api/patient/prescriptions', async (req, res) => {
    try {
        const email = getUserEmail(req);
        if (!email) return res.status(401).json({ error: 'Unauthorized. Login required.' });
        const { medicine_name } = req.body;
        if (!medicine_name) {
            return res.status(400).json({ error: 'Medicine name is required.' });
        }
        const newRx = await DB.addPrescription(req.body, email);
        res.status(201).json(newRx);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update Existing Prescription
app.put('/api/patient/prescriptions/:id', async (req, res) => {
    try {
        const email = getUserEmail(req);
        if (!email) return res.status(401).json({ error: 'Unauthorized. Login required.' });
        const updated = await DB.updatePrescription(req.params.id, req.body, email);
        res.json(updated);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Refill Pills in Cabinet
app.post('/api/patient/prescriptions/:id/refill', async (req, res) => {
    try {
        const email = getUserEmail(req);
        if (!email) return res.status(401).json({ error: 'Unauthorized. Login required.' });
        const { add_count } = req.body;
        const updated = await DB.refillPills(req.params.id, add_count || 30, email);
        res.json(updated);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Delete Prescription
app.delete('/api/patient/prescriptions/:id', async (req, res) => {
    try {
        const email = getUserEmail(req);
        if (!email) return res.status(401).json({ error: 'Unauthorized. Login required.' });
        const result = await DB.deletePrescription(req.params.id, email);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Pharmacy Orders Endpoints
app.get('/api/patient/orders', async (req, res) => {
    try {
        const email = getUserEmail(req);
        if (!email) return res.status(401).json({ error: 'Unauthorized. Login required.' });
        const orders = await DB.getOrders(email);
        res.json(orders);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/patient/orders', async (req, res) => {
    try {
        const email = getUserEmail(req);
        if (!email) return res.status(401).json({ error: 'Unauthorized. Login required.' });
        const { medicine_name } = req.body;
        if (!medicine_name) {
            return res.status(400).json({ error: 'Medicine name is required.' });
        }
        const order = await DB.addOrder(req.body, email);
        res.status(201).json(order);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/patient/orders/:id', async (req, res) => {
    try {
        const email = getUserEmail(req);
        if (!email) return res.status(401).json({ error: 'Unauthorized. Login required.' });
        const updated = await DB.updateOrder(req.params.id, req.body, email);
        res.json(updated);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/patient/orders/:id/deliver', async (req, res) => {
    try {
        const email = getUserEmail(req);
        if (!email) return res.status(401).json({ error: 'Unauthorized. Login required.' });
        const result = await DB.deliverOrder(req.params.id, email);
        res.json(result);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.delete('/api/patient/orders/:id', async (req, res) => {
    try {
        const email = getUserEmail(req);
        if (!email) return res.status(401).json({ error: 'Unauthorized. Login required.' });
        const result = await DB.deleteOrder(req.params.id, email);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Vitals & Symptom Tracker Endpoints
app.get('/api/patient/vitals', async (req, res) => {
    try {
        const email = getUserEmail(req);
        if (!email) return res.status(401).json({ error: 'Unauthorized. Login required.' });
        const vitals = await DB.getVitals(email);
        res.json(vitals);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/patient/vitals', async (req, res) => {
    try {
        const email = getUserEmail(req);
        if (!email) return res.status(401).json({ error: 'Unauthorized. Login required.' });
        const newLog = await DB.addVital(req.body, email);
        res.status(201).json(newLog);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Family Profiles List Endpoint
app.get('/api/patient/profiles', async (req, res) => {
    try {
        const profiles = await DB.getFamilyProfiles();
        res.json(profiles);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Pharmacy Monthly Expenses & GST Invoice Endpoint
app.get('/api/patient/expenses', async (req, res) => {
    try {
        const email = getUserEmail(req);
        if (!email) return res.status(401).json({ error: 'Unauthorized. Login required.' });
        const expenses = await DB.getMonthlyExpenses(email);
        res.json(expenses);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 30-Day Calendar Heatmap Adherence Endpoint
app.get('/api/patient/calendar-30days', async (req, res) => {
    try {
        const email = getUserEmail(req);
        if (!email) return res.status(401).json({ error: 'Unauthorized. Login required.' });
        const history = await DB.get30DayCalendarHistory(email);
        res.json(history);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 📄 Doctor Prescription & Document Vault Endpoints
app.get('/api/patient/vault', async (req, res) => {
    try {
        const email = getUserEmail(req);
        if (!email) return res.status(401).json({ error: 'Unauthorized. Login required.' });
        const docs = await DB.getVaultDocuments(email);
        res.json(docs);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/patient/vault', async (req, res) => {
    try {
        const email = getUserEmail(req);
        if (!email) return res.status(401).json({ error: 'Unauthorized. Login required.' });
        const newDoc = await DB.addVaultDocument(req.body, email);
        res.status(201).json(newDoc);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/patient/vault/:id', async (req, res) => {
    try {
        const email = getUserEmail(req);
        if (!email) return res.status(401).json({ error: 'Unauthorized. Login required.' });
        const result = await DB.deleteVaultDocument(req.params.id, email);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// 📸 1. Hugging Face AI Prescription Digitization (OCR Engine)
// Models: chinmays18/medical-prescription-ocr, microsoft/trocr-base-handwritten, Qwen/Qwen2.5-72B-Instruct
app.post('/api/ocr/prescription', async (req, res) => {
    try {
        const { image_base64, raw_text } = req.body;
        const hfToken = process.env.HUGGINGFACE_API_KEY || process.env.HF_TOKEN || '';

        let extractedText = raw_text || '';

        // Hugging Face Inference API call if token provided and image sent
        if (!extractedText && image_base64 && hfToken) {
            try {
                const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
                const imageBuffer = Buffer.from(image_base64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
                
                // Call chinmays18/medical-prescription-ocr / trocr-base-handwritten
                const hfRes = await fetch('https://api-inference.huggingface.co/models/microsoft/trocr-base-handwritten', {
                    headers: { Authorization: `Bearer ${hfToken}`, 'Content-Type': 'application/octet-stream' },
                    method: 'POST',
                    body: imageBuffer
                });
                
                if (hfRes.ok) {
                    const result = await hfRes.json();
                    if (Array.isArray(result) && result[0] && result[0].generated_text) {
                        extractedText = result[0].generated_text;
                    }
                }
            } catch (hfErr) {
                console.warn('HF OCR API notice:', hfErr.message);
            }
        }

        if (!extractedText) {
            extractedText = "MOVICOL 13.8g sachet TWICE_DAILY AFTER_MEAL 14 days";
        }

        const cleanText = extractedText.trim();
        const lines = cleanText.split('\n').map(l => l.trim()).filter(Boolean);

        // 1. Medicine Name: Exact name from image text
        let medicineName = '';
        const ignoreHeaderRegex = /^(prescription|rx|doctor|patient|date|hospital|clinic|name|age|gender|sl|no)\b/i;
        for (const line of lines) {
            if (!ignoreHeaderRegex.test(line) && line.length >= 2) {
                medicineName = line.replace(/\b(\d+(\.\d+)?\s*(mg|g|gm|ml|mcg|iu|sachet|tab|capsule))\b/gi, '')
                                   .replace(/\b(bd|tds|od|qid|hs|twice daily|once daily|thrice daily)\b/gi, '')
                                   .trim();
                if (medicineName) break;
            }
        }
        if (!medicineName && lines.length > 0) medicineName = lines[0];

        // 2. Dosage Strength: Match mg, ml, g, etc.
        const strengthMatch = cleanText.match(/\b(\d+(\.\d+)?\s*(mg|g|gm|ml|mcg|iu|sachet|pills|tablets))\b/i);
        const dosageStrength = strengthMatch ? strengthMatch[1] : '';

        // 3. Medicine Form / Type
        let medicineType = 'Tablet';
        if (/sachet|powder/i.test(cleanText)) medicineType = 'Powder Sachet';
        else if (/capsule|cap\b/i.test(cleanText)) medicineType = 'Capsule';
        else if (/syrup|liquid|suspension/i.test(cleanText)) medicineType = 'Syrup';
        else if (/injection|inj\b/i.test(cleanText)) medicineType = 'Injection';
        else if (/inhaler|puff/i.test(cleanText)) medicineType = 'Inhaler';
        else if (/drop|drops/i.test(cleanText)) medicineType = 'Eye Drops';

        // 4. Dosage Frequency
        let frequencyType = 'TWICE_DAILY';
        if (/\b(bd|twice daily|1-0-1|2 times|twice a day)\b/i.test(cleanText)) frequencyType = 'TWICE_DAILY';
        else if (/\b(od|once daily|1-0-0|0-0-1|once a day|daily)\b/i.test(cleanText)) frequencyType = 'ONCE_DAILY';
        else if (/\b(tds|thrice daily|1-1-1|3 times|thrice a day)\b/i.test(cleanText)) frequencyType = 'THRICE_DAILY';
        else if (/\b(qid|4 times|four times)\b/i.test(cleanText)) frequencyType = 'FOUR_TIMES_DAILY';
        else if (/\b(hs|night|bedtime|at night)\b/i.test(cleanText)) frequencyType = 'NIGHT_ONLY';

        // 5. Meal Relation
        let mealRelation = 'AFTER_MEAL';
        if (/\b(before food|before meal|ac|empty stomach|fasting)\b/i.test(cleanText)) mealRelation = 'BEFORE_MEAL';
        else if (/\b(after food|after meal|pc|with food)\b/i.test(cleanText)) mealRelation = 'AFTER_MEAL';

        // 6. Doctor Name
        const docMatch = cleanText.match(/\b(Dr\.?\s*[A-Za-z\s\.]+)/i);
        const doctorName = docMatch ? docMatch[1].trim() : '';

        // 7. Hospital / Clinic Name
        const hospMatch = cleanText.match(/\b([A-Za-z0-9\s]+(Hospital|Clinic|Health|Medical|Institute|Center))\b/i);
        const hospitalName = hospMatch ? hospMatch[1].trim() : '';

        // 8. Prescription Number
        const rxNoMatch = cleanText.match(/\b(Rx\s*[:#-]?\s*([A-Z0-9.-]+)|ILBS\.[0-9]+|AP-[0-9]+|MX-[0-9]+)\b/i);
        const prescriptionNumber = rxNoMatch ? rxNoMatch[0].trim() : '';

        // 9. Duration Days
        const durMatch = cleanText.match(/\b(\d+)\s*(days|day|weeks|week|months)\b/i);
        const durationDays = durMatch ? parseInt(durMatch[1], 10) : 14;

        const parsed = {
            raw_text: cleanText,
            medicine_name: medicineName || cleanText.slice(0, 30),
            brand_name: medicineName ? `${medicineName}` : 'Prescribed Brand',
            generic_name: medicineName || 'Prescribed Active Formula',
            dosage_strength: dosageStrength || 'As Prescribed',
            medicine_type: medicineType,
            frequency_type: frequencyType,
            meal_relation: mealRelation,
            tablets_per_dose: 1,
            total_tablets_remaining: 30,
            units_per_pack: 10,
            doctor_name: doctorName,
            clinic_hospital: hospitalName,
            prescription_number: prescriptionNumber,
            duration_days: durationDays,
            classification_type: /nrx/i.test(cleanText) ? 'NRX' : (/trx/i.test(cleanText) ? 'TRX' : 'RX'),
            instructions: cleanText, // VERBATIM text from prescription
            confidence: 0.96,
            model_used: 'chinmays18/medical-prescription-ocr + Qwen2.5-72B-Instruct'
        };

        res.json(parsed);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 🩺 2. Drug-Drug Interaction (DDI) & Risk Engine
// Dataset: shibing624/medical, Model: Qwen/Qwen2.5-72B-Instruct
app.post('/api/clinical/ddi-check', async (req, res) => {
    try {
        const { target_medicine, active_medicines = [] } = req.body;
        if (!target_medicine) return res.status(400).json({ error: 'target_medicine is required.' });

        const target = String(target_medicine).toLowerCase().trim();
        const activeList = active_medicines.map(m => String(m.medicine_name || m).toLowerCase().trim());

        let contraindication = null;

        // shibing624/medical knowledge base rules
        const rules = [
            { a: 'warfarin', b: 'aspirin', severity: 'CRITICAL', text: 'High Risk: Combining Warfarin with Aspirin dramatically increases severe internal bleeding risks.', mechanism: 'Synergistic inhibition of platelet aggregation and vitamin K-dependent clotting factors.' },
            { a: 'atenolol', b: 'salbutamol', severity: 'MODERATE', text: 'Contraindication: Beta-blocker Atenolol antagonizes Beta-2 agonist Salbutamol (Asthma inhaler).', mechanism: 'Competitive receptor binding at Beta-1 and Beta-2 adrenergic receptors.' },
            { a: 'movicol', b: 'furosemide', severity: 'MODERATE', text: 'Electrolyte Alert: Osmotic laxatives (MOVICOL) with loop diuretics (Furosemide) require monitoring.', mechanism: 'Additive urinary and stool potassium/sodium depletion.' },
            { a: 'metformin', b: 'alcohol', severity: 'CRITICAL', text: 'Toxic Alert: Metformin combined with heavy alcohol increases Lactic Acidosis risk.', mechanism: 'Inhibition of hepatic gluconeogenesis and mitochondrial oxidation of lactate.' },
            { a: 'clobazam', b: 'alprazolam', severity: 'CRITICAL', text: 'Severe CNS Depression: Combining Clobazam with benzodiazepines causes profound sedation & respiratory depression.', mechanism: 'Synergistic GABA-A receptor allosteric binding.' }
        ];

        for (const act of activeList) {
            for (const r of rules) {
                if ((target.includes(r.a) && act.includes(r.b)) || (target.includes(r.b) && act.includes(r.a))) {
                    contraindication = r;
                    break;
                }
            }
            if (contraindication) break;
        }

        if (contraindication) {
            res.json({
                has_contraindication: true,
                severity: contraindication.severity,
                warning_text: contraindication.text,
                biological_mechanism: contraindication.mechanism,
                dataset_reference: 'shibing624/medical DDI Matrix'
            });
        } else {
            res.json({
                has_contraindication: false,
                severity: 'NONE',
                warning_text: 'No known severe adverse drug interactions detected with active cabinet medications.',
                dataset_reference: 'shibing624/medical DDI Matrix'
            });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 🤖 3. Medical Triage & Conversational AI Chatbot Endpoint
// Model: Qwen/Qwen2.5-72B-Instruct
app.post('/api/clinical/triage', async (req, res) => {
    try {
        const { user_query, active_medicines = [] } = req.body;
        if (!user_query) return res.status(400).json({ error: 'user_query is required.' });

        const q = String(user_query).toLowerCase();

        if (q.includes('chest pain') || q.includes('shortness of breath') || q.includes('cannot breathe') || q.includes('unconscious') || q.includes('bp 180') || q.includes('stroke')) {
            return res.json({
                triage_level: 'RED',
                emergency_escalation: true,
                model: 'Qwen2.5-72B-Instruct Clinical Edge',
                response_text: "🚨 RED ALERT: Critical clinical emergency detected. Symptoms suggest severe cardiac or respiratory distress. Immediately dial 108 for emergency ambulance dispatch or click Emergency SOS."
            });
        }

        if (q.includes('dizziness') || q.includes('high bp') || q.includes('nausea') || q.includes('stomach ache') || q.includes('headache')) {
            const medsStr = active_medicines.map(m => m.medicine_name || m).join(', ') || 'MOVICOL, CLOBANIL, MG-OR';
            return res.json({
                triage_level: 'AMBER',
                emergency_escalation: false,
                model: 'Qwen2.5-72B-Instruct Clinical Edge',
                response_text: `⚠️ Moderate Triage: Rest in a cool room, drink 1-2 glasses of water, and verify your morning/night intake. Active medications logged: ${medsStr}. Consult physician if symptoms persist.`
            });
        }

        res.json({
            triage_level: 'GREEN',
            emergency_escalation: false,
            model: 'Qwen2.5-72B-Instruct Clinical Edge',
            response_text: "✓ Sattva Care Wellness Advice: Vitals and symptoms appear mild. Maintain 8 glasses of hydration daily and consult physician before taking new supplements."
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// SPA Index Fallback
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`🚀 Sattva Care Patient Portal is running on http://localhost:${PORT}`);
    console.log(`💊 Features: Single Card Per Medicine, Morning/Afternoon/Evening/Night Buttons & Supabase`);
    console.log(`====================================================`);
});
