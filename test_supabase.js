const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing Supabase credentials in .env');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function testAndSeed() {
    console.log('Connecting to Supabase at:', SUPABASE_URL);
    
    // Check if medicines table exists
    const { data, error } = await supabase.from('medicines').select('count', { count: 'exact' });
    
    if (error) {
        console.log('⚠️ Medicines table query status:', error.message);
        console.log('💡 TIP: If tables do not exist yet in Supabase, run `supabase_schema.sql` in your Supabase SQL Editor!');
    } else {
        console.log('✅ Supabase connected successfully! Current medicines row count:', data ? data.length : 0);
    }
}

testAndSeed();
