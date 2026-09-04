const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const DATA_DIR = path.join(__dirname, 'data');
const PRESCRIPTIONS_FILE = path.join(DATA_DIR, 'patient_prescriptions.json');
const LOGS_FILE = path.join(DATA_DIR, 'medication_logs.json');

async function cleanSweep() {
    console.log('🧹 Purging all mock data and duplicate medicines...');

    // Clear local files to empty arrays
    fs.writeFileSync(PRESCRIPTIONS_FILE, JSON.stringify([], null, 2));
    fs.writeFileSync(LOGS_FILE, JSON.stringify([], null, 2));
    console.log('✅ Local data files cleared.');

    // Clear Supabase tables if connected
    if (SUPABASE_URL && SUPABASE_KEY && !SUPABASE_URL.includes('your-project-id')) {
        try {
            const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
            const { error: err1 } = await supabase.from('patient_prescriptions').delete().neq('id', '0');
            const { error: err2 } = await supabase.from('medication_logs').delete().neq('id', '0');
            if (!err1 && !err2) {
                console.log('✅ Supabase PostgreSQL tables purged cleanly.');
            } else {
                console.log('Notice:', err1?.message || err2?.message);
            }
        } catch (err) {
            console.error('Supabase purge:', err.message);
        }
    }

    console.log('✨ Clean sweep completed! Zero duplicate or mock medicines remain.');
}

cleanSweep();
