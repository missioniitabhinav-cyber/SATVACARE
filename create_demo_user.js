const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function createUser() {
    console.log('Registering patient@medibuddy.com in Supabase Auth...');
    const { data, error } = await supabase.auth.signUp({
        email: 'patient@medibuddy.com',
        password: 'patient123'
    });
    if (error) {
        console.log('SignUp result:', error.message);
    } else {
        console.log('Successfully registered demo patient in Supabase Auth:', data.user ? data.user.email : 'Done');
    }
}
createUser();
