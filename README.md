# SATTVACARE

A comprehensive smart healthcare and medication management application built with Express.js, Supabase, and JavaScript.

## Features
- **Multi-Tenant Data Privacy**: Secure user authentication via Supabase. Each user's medication schedules, cabinet inventory, and pharmacy orders are strictly private.
- **Medication Schedule & Inventory**: Track daily dosage timing, stock counts, and daily consumption rates.
- **Smart Supply Duration Tracking**: Automatic calculation of remaining medication supply (days left) with visual inventory alerts.
- **Pharmacy & Medicine Orders**: Order prescriptions directly, track delivery status, and auto-restock cabinet upon delivery.
- **Multi-Format Health Export**: Export health reports as Excel (.xlsx/.csv), Markdown (.md), Plain Text (.txt), and PDF (.pdf).

## Getting Started

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Environment Configuration**:
   Create a `.env` file based on `.env.example`:
   ```env
   PORT=3000
   SUPABASE_URL=your_supabase_url
   SUPABASE_KEY=your_supabase_anon_key
   ```

3. **Run the Application**:
   ```bash
   npm start
   ```

---
© 2026 VSAV GYANTAPA. All Rights Reserved.
