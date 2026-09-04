const DB = require('./db.js');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function clean() {
    await supabase.from('patient_prescriptions').delete().eq('id', 'rx-1788511224496');
    await DB.deletePrescription('rx-1788511224496');
    console.log('Cleaned test record rx-1788511224496');
}
clean();
