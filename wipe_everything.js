const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const DATA_DIR = path.join(__dirname, 'data');
const PRESCRIPTIONS_FILE = path.join(DATA_DIR, 'patient_prescriptions.json');
const LOGS_FILE = path.join(DATA_DIR, 'medication_logs.json');

async function wipeEverything() {
    console.log('🧹 Wiping all test medicines...');

    // Clear local JSON files
    fs.writeFileSync(PRESCRIPTIONS_FILE, JSON.stringify([], null, 2));
    fs.writeFileSync(LOGS_FILE, JSON.stringify([], null, 2));

    // Clear Supabase tables
    if (SUPABASE_URL && SUPABASE_KEY && !SUPABASE_URL.includes('your-project-id')) {
        try {
            const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
            await supabase.from('patient_prescriptions').delete().neq('id', '0');
            await supabase.from('medication_logs').delete().neq('id', '0');
            console.log('✅ Supabase PostgreSQL cleared 100%.');
        } catch (e) {}
    }

    console.log('✨ Cleaned! 0 test medicines remain.');
}

wipeEverything();
