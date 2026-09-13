-- ====================================================================
-- SATTVA CARE / MEDIBUDDY PATIENT PORTAL - FULL SUPABASE POSTGRESQL SCHEMA
-- Project URL: https://rksrrkkqqivvcdeiljax.supabase.co
-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/rksrrkkqqivvcdeiljax/sql/new
-- ====================================================================

-- 1. Create Patient Prescriptions Table with Rich Medical & Batch Fields
CREATE TABLE IF NOT EXISTS public.patient_prescriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT DEFAULT 'patient-1',
    user_email TEXT DEFAULT 'patient@medibuddy.com',
    medicine_name TEXT NOT NULL,
    brand_name TEXT,
    generic_name TEXT,
    dosage_strength TEXT,
    medicine_type TEXT NOT NULL DEFAULT 'Tablet',
    
    -- Prescription Classification & Dose Amount
    prescription_type TEXT NOT NULL DEFAULT 'RX', -- 'RX', 'NRX', 'TRX', 'OTC'
    tablets_per_dose NUMERIC NOT NULL DEFAULT 1.0, -- 1.0 (Full), 0.5 (1/2 Tablet), 0.25 (1/4 Tablet), 1.5, 2.0
    
    -- Frequency & Timing Options
    dosage_frequency_type TEXT NOT NULL DEFAULT 'TWICE_DAILY',
    daily_frequency NUMERIC NOT NULL DEFAULT 2.0,
    dose_times TEXT[],
    
    -- Meal & Food Instructions
    meal_relation TEXT DEFAULT 'AFTER_MEAL',
    instructions TEXT,
    
    -- Inventory & Multi-Batch Details
    total_tablets_remaining NUMERIC NOT NULL DEFAULT 30,
    units_per_pack INTEGER DEFAULT 10,
    refill_threshold_days INTEGER NOT NULL DEFAULT 5,
    unit_price NUMERIC DEFAULT 0.0,
    
    -- Multi-Batch Strip Breakdown & Expiry Date
    batch_number TEXT,
    batch_strip_count INTEGER DEFAULT 1,
    expiry_date DATE,
    batch_details JSONB DEFAULT '[]'::jsonb,
    batches JSONB DEFAULT '[]'::jsonb,
    
    -- Doctor & Medical Records
    doctor_name TEXT,
    clinic_hospital TEXT,
    pharmacy_name TEXT,
    prescription_number TEXT,
    duration_days INTEGER,
    start_date DATE DEFAULT CURRENT_DATE,
    end_date DATE,
    storage_condition TEXT DEFAULT 'ROOM_TEMP',
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Medication Intake History Log Table
CREATE TABLE IF NOT EXISTS public.medication_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT DEFAULT 'patient-1',
    user_email TEXT DEFAULT 'patient@medibuddy.com',
    prescription_id TEXT REFERENCES public.patient_prescriptions(id) ON DELETE CASCADE,
    medicine_name TEXT NOT NULL,
    brand_name TEXT,
    scheduled_time TEXT NOT NULL, -- 'MORNING', 'AFTERNOON', 'EVENING', 'NIGHT', '08:00'
    status TEXT NOT NULL DEFAULT 'TAKEN', -- 'TAKEN', 'SKIPPED', 'MISSED'
    tablets_consumed NUMERIC DEFAULT 1.0,
    tablets_remaining_after NUMERIC DEFAULT 0.0,
    taken_at TIMESTAMPTZ DEFAULT NOW(),
    date TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Pharmacy Orders Table
CREATE TABLE IF NOT EXISTS public.pharmacy_orders (
    id TEXT PRIMARY KEY,
    user_id TEXT DEFAULT 'patient-1',
    user_email TEXT DEFAULT 'patient@medibuddy.com',
    prescription_id TEXT REFERENCES public.patient_prescriptions(id) ON DELETE SET NULL,
    medicine_name TEXT NOT NULL,
    brand_name TEXT,
    pharmacy_name TEXT DEFAULT 'Online Pharmacy',
    order_number TEXT,
    quantity_ordered NUMERIC NOT NULL DEFAULT 30,
    unit_price NUMERIC DEFAULT 0.0,
    total_price NUMERIC DEFAULT 0.0,
    status TEXT NOT NULL DEFAULT 'ORDERED', -- 'ORDERED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'
    order_date DATE DEFAULT CURRENT_DATE,
    expected_delivery DATE,
    delivered_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Health Vitals Logs Table
CREATE TABLE IF NOT EXISTS public.vitals_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT DEFAULT 'patient-1',
    user_email TEXT DEFAULT 'patient@sattvacare.com',
    sys_bp INTEGER,
    dia_bp INTEGER,
    blood_sugar INTEGER,
    sugar_type TEXT DEFAULT 'FASTING',
    pulse INTEGER,
    symptoms TEXT,
    notes TEXT,
    logged_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Safe Column Migrations for Existing Tables
ALTER TABLE public.patient_prescriptions ADD COLUMN IF NOT EXISTS user_id TEXT DEFAULT 'patient-1';
ALTER TABLE public.patient_prescriptions ADD COLUMN IF NOT EXISTS user_email TEXT DEFAULT 'patient@medibuddy.com';
ALTER TABLE public.patient_prescriptions ADD COLUMN IF NOT EXISTS prescription_type TEXT DEFAULT 'RX';
ALTER TABLE public.patient_prescriptions ADD COLUMN IF NOT EXISTS tablets_per_dose NUMERIC DEFAULT 1.0;
ALTER TABLE public.patient_prescriptions ADD COLUMN IF NOT EXISTS brand_name TEXT;
ALTER TABLE public.patient_prescriptions ADD COLUMN IF NOT EXISTS generic_name TEXT;
ALTER TABLE public.patient_prescriptions ADD COLUMN IF NOT EXISTS dosage_frequency_type TEXT DEFAULT 'TWICE_DAILY';
ALTER TABLE public.patient_prescriptions ADD COLUMN IF NOT EXISTS meal_relation TEXT DEFAULT 'AFTER_MEAL';
ALTER TABLE public.patient_prescriptions ADD COLUMN IF NOT EXISTS clinic_hospital TEXT;
ALTER TABLE public.patient_prescriptions ADD COLUMN IF NOT EXISTS duration_days INTEGER;
ALTER TABLE public.patient_prescriptions ADD COLUMN IF NOT EXISTS storage_condition TEXT DEFAULT 'ROOM_TEMP';
ALTER TABLE public.patient_prescriptions ADD COLUMN IF NOT EXISTS units_per_pack INTEGER DEFAULT 10;
ALTER TABLE public.patient_prescriptions ADD COLUMN IF NOT EXISTS batch_number TEXT;
ALTER TABLE public.patient_prescriptions ADD COLUMN IF NOT EXISTS batch_strip_count INTEGER DEFAULT 1;
ALTER TABLE public.patient_prescriptions ADD COLUMN IF NOT EXISTS expiry_date DATE;
ALTER TABLE public.patient_prescriptions ADD COLUMN IF NOT EXISTS batch_details JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.patient_prescriptions ADD COLUMN IF NOT EXISTS batches JSONB DEFAULT '[]'::jsonb;

ALTER TABLE public.medication_logs ADD COLUMN IF NOT EXISTS user_id TEXT DEFAULT 'patient-1';
ALTER TABLE public.medication_logs ADD COLUMN IF NOT EXISTS user_email TEXT DEFAULT 'patient@medibuddy.com';
ALTER TABLE public.medication_logs ADD COLUMN IF NOT EXISTS date TEXT;
ALTER TABLE public.medication_logs ADD COLUMN IF NOT EXISTS taken_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.pharmacy_orders ADD COLUMN IF NOT EXISTS user_id TEXT DEFAULT 'patient-1';
ALTER TABLE public.pharmacy_orders ADD COLUMN IF NOT EXISTS user_email TEXT DEFAULT 'patient@medibuddy.com';

-- 5. Row Level Security (RLS) & Permissive Policies
ALTER TABLE public.patient_prescriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medication_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacy_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vitals_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow access patient_prescriptions" ON public.patient_prescriptions;
CREATE POLICY "Allow access patient_prescriptions" ON public.patient_prescriptions FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow access medication_logs" ON public.medication_logs;
CREATE POLICY "Allow access medication_logs" ON public.medication_logs FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow access pharmacy_orders" ON public.pharmacy_orders;
CREATE POLICY "Allow access pharmacy_orders" ON public.pharmacy_orders FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow access vitals_logs" ON public.vitals_logs;
CREATE POLICY "Allow access vitals_logs" ON public.vitals_logs FOR ALL USING (true) WITH CHECK (true);

-- 6. Indexes for Maximum Performance
CREATE INDEX IF NOT EXISTS idx_rx_user_id ON public.patient_prescriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_logs_prescription_id ON public.medication_logs(prescription_id);
CREATE INDEX IF NOT EXISTS idx_logs_taken_at ON public.medication_logs(taken_at);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON public.pharmacy_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_vitals_user_id ON public.vitals_logs(user_id);
