-- ====================================================================
-- MEDIBUDDY PATIENT MEDICINE MANAGEMENT PORTAL - FULL POSTGRESQL SCHEMA
-- Project ID: rksrrkkqqivvcdeiljax
-- Run in SQL Editor: https://supabase.com/dashboard/project/rksrrkkqqivvcdeiljax/sql/new
-- ====================================================================

-- Create Patient Prescriptions Table with Rich Medical Fields
CREATE TABLE IF NOT EXISTS public.patient_prescriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT DEFAULT 'patient-1',
    medicine_name TEXT NOT NULL,
    brand_name TEXT, -- Brand / Manufacturer (e.g. Panadol, GSK, Lipitor)
    generic_name TEXT, -- Generic chemical name
    dosage_strength TEXT, -- e.g. 500mg, 10ml, 250mcg
    medicine_type TEXT NOT NULL DEFAULT 'Tablet', -- Tablet, Capsule, Syrup, Injection, Eye Drops, Inhaler, Ointment
    
    -- Prescription Classification & Dose Amount
    prescription_type TEXT NOT NULL DEFAULT 'RX', -- 'RX', 'NRX', 'TRX', 'OTC'
    tablets_per_dose NUMERIC NOT NULL DEFAULT 1.0, -- 1.0 (Full), 0.5 (1/2 Tablet), 0.25 (1/4 Tablet), 1.5, 2.0
    
    -- Frequency & Timing Options
    dosage_frequency_type TEXT NOT NULL DEFAULT 'TWICE_DAILY', -- 'ONCE_MORNING', 'ONCE_NIGHT', 'TWICE_DAILY', 'THRICE_DAILY', 'FOUR_TIMES_DAILY', 'AS_NEEDED'
    daily_frequency NUMERIC NOT NULL DEFAULT 2.0, -- Pills per day
    dose_times TEXT[], -- Array of scheduled times e.g. ['08:00 AM', '08:00 PM']
    
    -- Meal & Food Instructions
    meal_relation TEXT DEFAULT 'AFTER_MEAL', -- 'BEFORE_MEAL', 'AFTER_MEAL', 'WITH_FOOD', 'BEDTIME'
    instructions TEXT, -- Specific instructions from doctor
    
    -- Inventory & Cabinet Details (NUMERIC to support half/quarter tablets)
    total_tablets_remaining NUMERIC NOT NULL DEFAULT 30, -- Total pills in cabinet
    units_per_pack INTEGER DEFAULT 10,
    refill_threshold_days INTEGER NOT NULL DEFAULT 5, -- 5-Day Run-Out Alert trigger
    unit_price NUMERIC DEFAULT 0.0,
    
    -- Doctor & Medical Records
    doctor_name TEXT, -- Doctor Name & Specialty
    clinic_hospital TEXT, -- Hospital / Clinic Name
    pharmacy_name TEXT, -- Pharmacy Name
    prescription_number TEXT, -- Rx ID
    duration_days INTEGER, -- e.g. 7 days course, 30 days
    start_date DATE DEFAULT CURRENT_DATE,
    end_date DATE,
    storage_condition TEXT DEFAULT 'ROOM_TEMP', -- 'ROOM_TEMP', 'REFRIGERATE', 'PROTECT_LIGHT'
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Medication Intake History Log Table
CREATE TABLE IF NOT EXISTS public.medication_logs (
    id TEXT PRIMARY KEY,
    prescription_id TEXT REFERENCES public.patient_prescriptions(id) ON DELETE CASCADE,
    medicine_name TEXT NOT NULL,
    brand_name TEXT,
    scheduled_time TEXT NOT NULL, -- e.g. 'MORNING', 'NIGHT'
    status TEXT NOT NULL, -- 'TAKEN', 'SKIPPED', 'MISSED'
    tablets_consumed NUMERIC DEFAULT 1.0,
    tablets_remaining_after NUMERIC NOT NULL,
    taken_at TIMESTAMPTZ DEFAULT NOW(),
    notes TEXT
);

-- Patient Profile Table
CREATE TABLE IF NOT EXISTS public.patient_profile (
    id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL DEFAULT 'Patient',
    age INTEGER,
    blood_group TEXT,
    allergies TEXT,
    primary_doctor TEXT,
    emergency_contact TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.patient_prescriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medication_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_profile ENABLE ROW LEVEL SECURITY;

-- Create Permissive Access Policies
DROP POLICY IF EXISTS "Allow access patient_prescriptions" ON public.patient_prescriptions;
CREATE POLICY "Allow access patient_prescriptions" ON public.patient_prescriptions FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow access medication_logs" ON public.medication_logs;
CREATE POLICY "Allow access medication_logs" ON public.medication_logs FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow access patient_profile" ON public.patient_profile;
CREATE POLICY "Allow access patient_profile" ON public.patient_profile FOR ALL USING (true) WITH CHECK (true);

-- ====================================================================
-- MIGRATION ALTER TABLE STATEMENTS FOR EXISTING SUPABASE TABLES
-- ====================================================================
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

ALTER TABLE public.patient_prescriptions ALTER COLUMN total_tablets_remaining TYPE NUMERIC USING total_tablets_remaining::NUMERIC;
ALTER TABLE public.patient_prescriptions ALTER COLUMN daily_frequency TYPE NUMERIC USING daily_frequency::NUMERIC;

ALTER TABLE public.medication_logs ALTER COLUMN tablets_consumed TYPE NUMERIC USING tablets_consumed::NUMERIC;
ALTER TABLE public.medication_logs ALTER COLUMN tablets_remaining_after TYPE NUMERIC USING tablets_remaining_after::NUMERIC;

-- 5. Create Pharmacy Orders Table
CREATE TABLE IF NOT EXISTS public.pharmacy_orders (
    id TEXT PRIMARY KEY,
    user_id TEXT DEFAULT 'patient-1',
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

ALTER TABLE public.pharmacy_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow access pharmacy_orders" ON public.pharmacy_orders;
CREATE POLICY "Allow access pharmacy_orders" ON public.pharmacy_orders FOR ALL USING (true) WITH CHECK (true);
