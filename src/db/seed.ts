/**
 * Development & Testing Seed Script for Vanuit Ambacht
 * 
 * IMPORTANT: This script is intended strictly for development and testing environments.
 * It seeds standard demo accounts with secure bcryptjs hashes.
 */

import bcrypt from 'bcryptjs';
import { db, sqlClient } from './index.js';
import { users, partners, customers, companySettings, chartOfAccounts } from './schema.js';
import { eq } from 'drizzle-orm';

async function seed() {
  console.log('🌱 Starting development seed...');

  // 1. Hash passwords
  const saltRounds = 10;
  const adminHash = await bcrypt.hash('admin123', saltRounds);
  const partnerHash = await bcrypt.hash('partner123', saltRounds);
  const customerHash = await bcrypt.hash('customer123', saltRounds);
  const inactiveHash = await bcrypt.hash('inactive123', saltRounds);

  // 2. Upsert Admin User
  let [adminUser] = await db
    .insert(users)
    .values({
      email: 'admin@vanuitambacht.nl',
      passwordHash: adminHash,
      role: 'admin',
      fullName: 'Tim & Bram (Vanuit Ambacht Admin)',
      phone: '+31 6 11112222',
      isActive: true,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        passwordHash: adminHash,
        fullName: 'Tim & Bram (Vanuit Ambacht Admin)',
        isActive: true,
      },
    })
    .returning();
  console.log(`✅ Admin user seeded: ${adminUser.email} (ID: ${adminUser.id})`);

  // 3. Upsert Partner User
  let [partnerUser] = await db
    .insert(users)
    .values({
      email: 'partner@vanuitambacht.nl',
      passwordHash: partnerHash,
      role: 'partner',
      fullName: 'Sven Hoek',
      phone: '+31 6 33334444',
      isActive: true,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        passwordHash: partnerHash,
        fullName: 'Sven Hoek',
        isActive: true,
      },
    })
    .returning();
  console.log(`✅ Partner user seeded: ${partnerUser.email} (ID: ${partnerUser.id})`);

  // Upsert Partner Profile
  const existingPartner = await db.query.partners?.findFirst?.({
    where: eq(partners.partnerCode, 'PRT-SVEN-01'),
  });

  if (!existingPartner) {
    const [partnerProfile] = await db
      .insert(partners)
      .values({
        userId: partnerUser.id,
        partnerCode: 'PRT-SVEN-01',
        companyName: 'Hoek Ambachtelijke Houtbouw',
        contactPerson: 'Sven Hoek',
        email: 'partner@vanuitambacht.nl',
        phone: '+31 6 33334444',
        kvkNumber: '88776655',
        btwNumber: 'NL88776655B01',
        region: 'Zuid-Holland',
        workloadStatus: 'available',
        rating: '5.00',
        specialties: ['Buitenkeukens', 'Houtbouw', 'Overkappingen'],
        productTypes: ['outdoor_kitchen', 'garden_room'],
        isActive: true,
      })
      .returning();
    console.log(`✅ Partner profile linked: ${partnerProfile.companyName} (ID: ${partnerProfile.id})`);
  } else {
    await db
      .update(partners)
      .set({ userId: partnerUser.id, email: partnerUser.email })
      .where(eq(partners.partnerCode, 'PRT-SVEN-01'));
    console.log(`✅ Partner profile refreshed: PRT-SVEN-01`);
  }

  // 4. Upsert Customer User
  let [customerUser] = await db
    .insert(users)
    .values({
      email: 'customer@vanuitambacht.nl',
      passwordHash: customerHash,
      role: 'customer',
      fullName: 'Bjorn Valk',
      phone: '+31 6 55556666',
      isActive: true,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        passwordHash: customerHash,
        fullName: 'Bjorn Valk',
        isActive: true,
      },
    })
    .returning();
  console.log(`✅ Customer user seeded: ${customerUser.email} (ID: ${customerUser.id})`);

  // Upsert Customer Profile
  const existingCustomer = await db.query.customers?.findFirst?.({
    where: eq(customers.customerNumber, 'CUST-2026-001'),
  });

  if (!existingCustomer) {
    const [customerProfile] = await db
      .insert(customers)
      .values({
        userId: customerUser.id,
        customerNumber: 'CUST-2026-001',
        companyName: 'Valk Vastgoed B.V.',
        firstName: 'Bjorn',
        lastName: 'Valk',
        email: 'customer@vanuitambacht.nl',
        phone: '+31 6 55556666',
        streetAddress: 'Wassenaarseweg 42',
        postalCode: '2596 CJ',
        city: 'Den Haag',
        country: 'NL',
        notes: 'Premium buitenverblijf met luxe eiken buitenkeuken',
      })
      .returning();
    console.log(`✅ Customer profile linked: ${customerProfile.firstName} ${customerProfile.lastName} (ID: ${customerProfile.id})`);
  } else {
    await db
      .update(customers)
      .set({ userId: customerUser.id, email: customerUser.email })
      .where(eq(customers.customerNumber, 'CUST-2026-001'));
    console.log(`✅ Customer profile refreshed: CUST-2026-001`);
  }

  // 5. Upsert Inactive User (For testing inactive user rejection)
  let [inactiveUser] = await db
    .insert(users)
    .values({
      email: 'inactive@vanuitambacht.nl',
      passwordHash: inactiveHash,
      role: 'partner',
      fullName: 'Inactive Test User',
      phone: '+31 6 00000000',
      isActive: false,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        passwordHash: inactiveHash,
        fullName: 'Inactive Test User',
        isActive: false,
      },
    })
    .returning();
  console.log(`✅ Inactive test user seeded: ${inactiveUser.email} (ID: ${inactiveUser.id}, isActive: false)`);

  // 6. Upsert Company Settings
  const [existingSettings] = await db.select().from(companySettings).limit(1);
  if (!existingSettings) {
    await db.insert(companySettings).values({
      companyName: 'Vanuit Ambacht B.V.',
      kvkNumber: '92847192',
      btwNumber: 'NL865912401B01',
      iban: 'NL91ABNA0417164300',
      bankName: 'ABN AMRO',
      email: 'info@vanuitambacht.nl',
      phone: '+31 85 060 2844',
      address: 'Ambachtsweg 14',
      postalCode: '3445 AE',
      city: 'Woerden',
      country: 'NL',
      defaultMarginPercentage: '35.00',
      quoteTermsText: 'Offertes zijn 30 dagen geldig. Prijzen inclusief 21% BTW tenzij anders vermeld.',
    });
    console.log('✅ Company settings seeded.');
  } else {
    console.log('✅ Company settings already initialized.');
  }

  // 7. Upsert Standard Dutch Chart of Accounts (Module 8)
  console.log('📊 Seeding standard Dutch Chart of Accounts...');
  const standardAccounts = [
    { accountCode: '1000', accountName: 'ABN AMRO / Bank', accountType: 'Asset' as const, standardVatRule: null },
    { accountCode: '1020', accountName: 'Spaarrekening / Savings', accountType: 'Asset' as const, standardVatRule: null },
    { accountCode: '1090', accountName: 'Kruisposten / Suspense', accountType: 'Asset' as const, standardVatRule: null },
    { accountCode: '1300', accountName: 'Debiteuren / Accounts Receivable', accountType: 'Asset' as const, standardVatRule: null },
    { accountCode: '1500', accountName: 'Te betalen BTW (Af te dragen)', accountType: 'Liability' as const, standardVatRule: 'NL_21' },
    { accountCode: '1510', accountName: 'Voorbelasting (Terug te vorderen BTW)', accountType: 'Asset' as const, standardVatRule: 'NL_21' },
    { accountCode: '1600', accountName: 'Crediteuren / Accounts Payable', accountType: 'Liability' as const, standardVatRule: null },
    { accountCode: '2000', accountName: 'ICS / Creditcard', accountType: 'Liability' as const, standardVatRule: null },
    { accountCode: '4000', accountName: 'Kosten Bol.com / Commissie', accountType: 'Expense' as const, standardVatRule: 'NL_21' },
    { accountCode: '4100', accountName: 'Software & ICT kosten', accountType: 'Expense' as const, standardVatRule: 'NL_21' },
    { accountCode: '4200', accountName: 'Advertentie- & Marketingkosten', accountType: 'Expense' as const, standardVatRule: 'NL_21' },
    { accountCode: '4300', accountName: 'Reiskosten', accountType: 'Expense' as const, standardVatRule: null },
    { accountCode: '4350', accountName: 'Representatie & Diner', accountType: 'Expense' as const, standardVatRule: null },
    { accountCode: '4400', accountName: 'Relatiegeschenken', accountType: 'Expense' as const, standardVatRule: null },
    { accountCode: '4450', accountName: 'Kantoorkosten', accountType: 'Expense' as const, standardVatRule: 'NL_21' },
    { accountCode: '4500', accountName: 'Bankkosten & Transactiekosten', accountType: 'Expense' as const, standardVatRule: null },
    { accountCode: '4510', accountName: 'Koersverschillen & Wisselkosten', accountType: 'Expense' as const, standardVatRule: null },
    { accountCode: '4600', accountName: 'Transport- & Bezorgkosten', accountType: 'Expense' as const, standardVatRule: 'NL_21' },
    { accountCode: '7000', accountName: 'Inkoop Hout & Materialen', accountType: 'Expense' as const, standardVatRule: 'NL_21' },
    { accountCode: '8000', accountName: 'Omzet Buitenkeukens & Maatwerk', accountType: 'Revenue' as const, standardVatRule: 'NL_21' },
    { accountCode: '8010', accountName: 'Omzet Bol.com Verkopen', accountType: 'Revenue' as const, standardVatRule: 'NL_21' },
  ];

  for (const acc of standardAccounts) {
    await db
      .insert(chartOfAccounts)
      .values(acc)
      .onConflictDoUpdate({
        target: chartOfAccounts.accountCode,
        set: {
          accountName: acc.accountName,
          accountType: acc.accountType,
          standardVatRule: acc.standardVatRule,
          isActive: true,
        },
      });
  }
  console.log(`✅ Seeded ${standardAccounts.length} standard accounts in chart_of_accounts.`);

  console.log('🎉 Development seed finished successfully!');
}

seed()
  .catch((err) => {
    console.error('❌ Error during seed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await sqlClient.end();
  });
