import { sqlClient } from './index.js';
import bcrypt from 'bcryptjs';

async function clearAllOperationalData() {
  console.log('🧹 [Database Wipe] Starting complete transactional data wipe...');

  try {
    // 1. Truncate all transactional operational tables with CASCADE
    await sqlClient.unsafe(`
      TRUNCATE TABLE 
        payment_allocations,
        payments,
        payment_webhooks,
        invoice_items,
        invoices,
        journal_entry_lines,
        journal_entries,
        bank_transactions,
        bank_statements,
        vat_filings,
        project_photos,
        project_milestones,
        planning_events,
        tasks,
        documents,
        messages,
        conversation_participants,
        conversations,
        commercial_actions,
        lead_voice_notes,
        partner_candidates,
        partner_offers,
        partner_price_requests,
        quote_items,
        quote_versions,
        quotes,
        projects,
        leads,
        customers
      RESTART IDENTITY CASCADE;
    `);

    console.log('✅ Successfully truncated all 29 operational and transactional tables!');

    // 2. Clean users table except primary seeded credentials
    await sqlClient.unsafe(`
      DELETE FROM users 
      WHERE email NOT IN (
        'admin@vanuitambacht.nl',
        'tim@vanuitambacht.nl',
        'bram@vanuitambacht.nl',
        'partner@vanuitambacht.nl',
        'customer@vanuitambacht.nl'
      );
    `);

    // 3. Ensure primary login passwords and users are freshly active
    const saltRounds = 10;
    const adminHash = await bcrypt.hash('admin123', saltRounds);
    const partnerHash = await bcrypt.hash('partner123', saltRounds);
    const customerHash = await bcrypt.hash('customer123', saltRounds);

    // Admin
    await sqlClient.unsafe(`
      INSERT INTO users (id, email, password_hash, role, full_name, is_active, created_at, updated_at)
      VALUES (
        gen_random_uuid(),
        'admin@vanuitambacht.nl',
        '${adminHash}',
        'admin',
        'Tim & Bram (Vanuit Ambacht Admin)',
        true,
        NOW(),
        NOW()
      )
      ON CONFLICT (email) DO UPDATE SET
        password_hash = '${adminHash}',
        is_active = true,
        role = 'admin';
    `);

    // Partner
    const [pUser] = await sqlClient.unsafe(`
      INSERT INTO users (id, email, password_hash, role, full_name, is_active, created_at, updated_at)
      VALUES (
        gen_random_uuid(),
        'partner@vanuitambacht.nl',
        '${partnerHash}',
        'partner',
        'Sven Hoek',
        true,
        NOW(),
        NOW()
      )
      ON CONFLICT (email) DO UPDATE SET
        password_hash = '${partnerHash}',
        is_active = true,
        role = 'partner'
      RETURNING id;
    `);

    // Partner profile
    await sqlClient.unsafe(`
      DELETE FROM partners WHERE partner_code != 'PRT-SVEN-01';
      INSERT INTO partners (
        id, user_id, partner_code, company_name, contact_person, email, phone, 
        region, workload_status, rating, specialties, product_types, is_active, created_at, updated_at
      ) VALUES (
        gen_random_uuid(),
        '${pUser.id}',
        'PRT-SVEN-01',
        'Hoek Ambachtelijke Houtbouw',
        'Sven Hoek',
        'partner@vanuitambacht.nl',
        '+31 6 33334444',
        'Zuid-Holland',
        'available',
        '5.00',
        ARRAY['Buitenkeukens', 'Houtbouw', 'Overkappingen'],
        ARRAY['outdoor_kitchen', 'garden_room'],
        true,
        NOW(),
        NOW()
      )
      ON CONFLICT (partner_code) DO UPDATE SET
        user_id = '${pUser.id}',
        is_active = true;
    `);

    // Customer user
    const [cUser] = await sqlClient.unsafe(`
      INSERT INTO users (id, email, password_hash, role, full_name, is_active, created_at, updated_at)
      VALUES (
        gen_random_uuid(),
        'customer@vanuitambacht.nl',
        '${customerHash}',
        'customer',
        'Bjorn Valk',
        true,
        NOW(),
        NOW()
      )
      ON CONFLICT (email) DO UPDATE SET
        password_hash = '${customerHash}',
        is_active = true,
        role = 'customer'
      RETURNING id;
    `);

    // Fresh customer profile (with 0 projects, 0 quotes, 0 invoices)
    await sqlClient.unsafe(`
      INSERT INTO customers (
        id, user_id, customer_number, first_name, last_name, email, phone, street_address, city, postal_code, country, created_at, updated_at
      ) VALUES (
        gen_random_uuid(),
        '${cUser.id}',
        'CUST-2026-001',
        'Bjorn',
        'Valk',
        'customer@vanuitambacht.nl',
        '+31 6 55556666',
        'Keizersgracht 101',
        'Amsterdam',
        '1015 CJ',
        'NL',
        NOW(),
        NOW()
      )
      ON CONFLICT (customer_number) DO UPDATE SET
        user_id = '${cUser.id}',
        email = 'customer@vanuitambacht.nl';
    `);

    console.log('✅ Core authenticable users preserved (admin@vanuitambacht.nl, partner@vanuitambacht.nl, customer@vanuitambacht.nl)');

    // 4. Verify all counts are exactly 0
    console.log('\n--- 📊 VERIFYING 0 0 DASHBOARD COUNTS ---');
    const verifyTables = [
      'leads',
      'quotes',
      'projects',
      'invoices',
      'partner_price_requests',
      'partner_offers',
      'tasks',
      'planning_events',
      'documents',
      'messages',
      'conversations',
      'bank_transactions',
      'vat_filings',
      'commercial_actions'
    ];

    let allZero = true;
    for (const t of verifyTables) {
      const res = await sqlClient.unsafe(`SELECT COUNT(*)::int as count FROM ${t}`);
      const count = res[0].count;
      console.log(`Table ${t.padEnd(25)} : ${count} ${count === 0 ? '✅ (0)' : '❌ NOT ZERO'}`);
      if (count !== 0) allZero = false;
    }

    if (allZero) {
      console.log('\n🚀 ALL 3 DASHBOARDS & MENUS ARE COMPLETELY CLEARED TO 0 0!');
    } else {
      console.warn('\n⚠️ Some tables still have rows.');
    }

  } catch (error) {
    console.error('❌ Wipe failed with error:', error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

clearAllOperationalData();
