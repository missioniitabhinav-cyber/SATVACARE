const DB = require('./db.js');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function fixRecords() {
    console.log('Fixing CARDIVAS records in Supabase and local DB...');

    // 1. Fetch current prescriptions from Supabase directly
    const { data: list, error } = await supabase.from('patient_prescriptions').select('*');
    if (error) {
        console.error('Error fetching:', error);
        return;
    }

    console.log('Found records:', list.length);

    for (const rx of list) {
        console.log(`Record ${rx.id}: ${rx.medicine_name} | instructions: ${rx.instructions} | freq: ${rx.dosage_frequency_type}`);

        if (rx.medicine_name.toUpperCase().includes('CARDIVAS')) {
            if (rx.id === 'rx-1788510516142') {
                // Delete duplicate/older entry
                console.log(`Deleting duplicate record ${rx.id}...`);
                await supabase.from('patient_prescriptions').delete().eq('id', rx.id);
            } else {
                // Update CARDIVAS 3.125mg to NIGHT ONLY (ONCE_NIGHT), 1 daily frequency
                console.log(`Updating record ${rx.id} to ONCE_NIGHT / 1 daily frequency...`);
                await supabase.from('patient_prescriptions').update({
                    dosage_frequency_type: 'ONCE_NIGHT',
                    daily_frequency: 1,
                    instructions: 'AFTER FOOD IN NIGHT ONLY'
                }).eq('id', rx.id);
            }
        }
    }

    // Refresh DB
    const updatedList = await DB.getPrescriptions();
    console.log('Cleaned DB state:');
    console.log(JSON.stringify(updatedList, null, 2));
}

fixRecords();
