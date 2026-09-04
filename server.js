const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const DB = require('./db');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
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
        app: 'MediBuddy Patient Medicine Management Portal',
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
        const stats = await DB.getPatientStats(email);
        res.json(stats);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Today's Dose Schedule (Single Clean Card Per Medicine)
app.get('/api/patient/today-schedule', async (req, res) => {
    try {
        const email = getUserEmail(req);
        if (!email) return res.status(401).json({ error: 'Unauthorized. Login required.' });
        const schedule = await DB.getTodaySchedule(email);
        res.json(schedule);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Toggle Specific Dose Slot (MORNING, AFTERNOON, EVENING, NIGHT)
app.post('/api/patient/toggle-slot', async (req, res) => {
    try {
        const email = getUserEmail(req);
        if (!email) return res.status(401).json({ error: 'Unauthorized. Login required.' });
        const { prescription_id, slot_name } = req.body;
        if (!prescription_id || !slot_name) {
            return res.status(400).json({ error: 'prescription_id and slot_name are required.' });
        }
        const result = await DB.toggleDoseSlot({ prescription_id, slot_name, user_email: email });
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

// SPA Index Fallback
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`🚀 MediBuddy Patient Portal is running on http://localhost:${PORT}`);
    console.log(`💊 Features: Single Card Per Medicine, Morning/Afternoon/Evening/Night Buttons & Supabase`);
    console.log(`====================================================`);
});
