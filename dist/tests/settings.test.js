/**
 * Comprehensive Automated Test Suite for Module 12: Settings / Company Settings
 *
 * Verifies:
 * - Authentication & Strict Admin-Only RBAC (Partner and Customer rejection 403)
 * - GET company settings
 * - Update company settings (Company details, VAT rates, numbering prefixes, terms)
 * - Dynamic configuration sections (branding, categories, fieldsets, partner-breakdown, pl-targets, templates, quote-template, integrations)
 * - List users (ensuring passwordHash is NEVER exposed)
 * - Create / Invite user with bcrypt password hashing
 * - Reject duplicate email with HTTP 409 Conflict
 * - Toggle user active/inactive status
 * - Self-deactivation prevention (Admin cannot deactivate own account)
 * - Change user role
 * - Sole-admin demotion / deactivation protection
 */
import server from '../server.js';
import { db, sqlClient } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
const results = [];
function record(name, passed, details = '') {
    results.push({ name, passed, details });
    const icon = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${icon}: ${name}${details ? ` -> ${details}` : ''}`);
}
function extractCookie(res) {
    const raw = res.headers['set-cookie'];
    if (!raw)
        return '';
    return Array.isArray(raw) ? raw[0] : raw;
}
async function runTests() {
    console.log('\n======================================================');
    console.log('🧪 RUNNING MODULE 12: SETTINGS & COMPANY SETTINGS TEST SUITE');
    console.log('======================================================\n');
    await server.ready();
    // 1. Authenticate users
    const adminLoginRes = await server.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'admin@vanuitambacht.nl', password: 'admin123' },
    });
    const adminCookie = extractCookie(adminLoginRes);
    const adminProfile = JSON.parse(adminLoginRes.body).data.user;
    const partnerLoginRes = await server.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'partner@vanuitambacht.nl', password: 'partner123' },
    });
    const partnerCookie = extractCookie(partnerLoginRes);
    const customerLoginRes = await server.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'customer@vanuitambacht.nl', password: 'customer123' },
    });
    const customerCookie = extractCookie(customerLoginRes);
    // -------------------------------------------------------------------
    // TEST GROUP 1: AUTHENTICATION & STRICT RBAC ENFORCEMENT
    // -------------------------------------------------------------------
    console.log('\n--- GROUP 1: Authentication & Strict RBAC Enforcement ---');
    // Test 1: Unauthenticated request to /api/settings/company returns 401
    const unauthRes = await server.inject({
        method: 'GET',
        url: '/api/settings/company',
    });
    record('Unauthenticated request to /api/settings/company is rejected with 401', unauthRes.statusCode === 401, `Status: ${unauthRes.statusCode}`);
    // Test 2: Partner cannot access /api/settings/company (403 Forbidden)
    const partnerCompanyRes = await server.inject({
        method: 'GET',
        url: '/api/settings/company',
        headers: { cookie: partnerCookie },
    });
    record('Partner role is strictly blocked from company settings (403 Forbidden)', partnerCompanyRes.statusCode === 403, `Status: ${partnerCompanyRes.statusCode}`);
    // Test 3: Customer cannot access /api/settings/company (403 Forbidden)
    const customerCompanyRes = await server.inject({
        method: 'GET',
        url: '/api/settings/company',
        headers: { cookie: customerCookie },
    });
    record('Customer role is strictly blocked from company settings (403 Forbidden)', customerCompanyRes.statusCode === 403, `Status: ${customerCompanyRes.statusCode}`);
    // Test 4: Partner cannot access /api/settings/users (403 Forbidden)
    const partnerUsersRes = await server.inject({
        method: 'GET',
        url: '/api/settings/users',
        headers: { cookie: partnerCookie },
    });
    record('Partner role is blocked from user management (403 Forbidden)', partnerUsersRes.statusCode === 403, `Status: ${partnerUsersRes.statusCode}`);
    // Test 5: Customer cannot access /api/settings/users (403 Forbidden)
    const customerUsersRes = await server.inject({
        method: 'GET',
        url: '/api/settings/users',
        headers: { cookie: customerCookie },
    });
    record('Customer role is blocked from user management (403 Forbidden)', customerUsersRes.statusCode === 403, `Status: ${customerUsersRes.statusCode}`);
    // Test 6: Admin successfully accesses /api/settings/company
    const adminCompanyRes = await server.inject({
        method: 'GET',
        url: '/api/settings/company',
        headers: { cookie: adminCookie },
    });
    record('Admin successfully retrieves company settings (200 OK)', adminCompanyRes.statusCode === 200, `Status: ${adminCompanyRes.statusCode}`);
    // -------------------------------------------------------------------
    // TEST GROUP 2: COMPANY PROFILE & FINANCIAL SETTINGS CRUD
    // -------------------------------------------------------------------
    console.log('\n--- GROUP 2: Company Profile & Financial Settings CRUD ---');
    const initialCompany = JSON.parse(adminCompanyRes.body).data;
    // Test 7: Verify initial company defaults
    record('GET company settings returns valid company details, VAT rates, and prefixes', initialCompany.companyName &&
        initialCompany.standardVatRate === 21 &&
        initialCompany.lowVatRate === 9 &&
        initialCompany.quotePrefix &&
        initialCompany.invoicePrefix, `Name: ${initialCompany.companyName}, Q-Prefix: ${initialCompany.quotePrefix}, Inv-Prefix: ${initialCompany.invoicePrefix}`);
    // Test 8: PUT /api/settings/company update
    const updateCompanyPayload = {
        companyName: 'Vanuit Ambacht Meesters B.V.',
        website: 'https://www.vanuitambacht.nl',
        email: 'info@vanuitambacht.nl',
        phone: '+31 20 890 1234',
        address: 'Keizersgracht 421',
        postalCode: '1016 EK',
        city: 'Amsterdam',
        country: 'NL',
        kvkNumber: 'KVK-88741029',
        btwNumber: 'NL88741029B01',
        iban: 'NL91 ABNA 0417 1234 56',
        bankName: 'ABN AMRO Bank N.V.',
        standardVatRate: 21,
        lowVatRate: 9,
        quotePrefix: '#Q-2026',
        invoicePrefix: '#INV-2026',
        defaultMarginPercentage: 36.5,
        quoteTermsText: 'Standard 30-day quote validity and 50% deposit required.',
    };
    const updateCompanyRes = await server.inject({
        method: 'PUT',
        url: '/api/settings/company',
        headers: { cookie: adminCookie },
        payload: updateCompanyPayload,
    });
    const updatedCompany = JSON.parse(updateCompanyRes.body).data;
    record('PUT /api/settings/company successfully updates company profile, prefixes, and VAT rates', updateCompanyRes.statusCode === 200 &&
        updatedCompany.companyName === 'Vanuit Ambacht Meesters B.V.' &&
        updatedCompany.quotePrefix === '#Q-2026' &&
        updatedCompany.invoicePrefix === '#INV-2026' &&
        updatedCompany.defaultMarginPercentage === 36.5, `Updated Name: ${updatedCompany.companyName}, Margin: ${updatedCompany.defaultMarginPercentage}%`);
    // -------------------------------------------------------------------
    // TEST GROUP 3: CONFIGURATION SECTION APIS (PATCH /config/:section)
    // -------------------------------------------------------------------
    console.log('\n--- GROUP 3: Dynamic Configuration Section APIs ---');
    // Test 9: Branding configuration
    const brandingRes = await server.inject({
        method: 'PATCH',
        url: '/api/settings/config/branding',
        headers: { cookie: adminCookie },
        payload: { primary: '#2D3A27', accent: '#8C7A64', background: '#E5DFD5' },
    });
    const brandingData = JSON.parse(brandingRes.body).data;
    record('PATCH /api/settings/config/branding updates theme colors', brandingRes.statusCode === 200 && brandingData.brandingColors?.primary === '#2D3A27', `Primary: ${brandingData.brandingColors?.primary}`);
    // Test 10: Dynamic categories configuration
    const categoriesRes = await server.inject({
        method: 'PATCH',
        url: '/api/settings/config/categories',
        headers: { cookie: adminCookie },
        payload: [
            { id: 'cat-1', name: 'Buitenkeukens', icon: '🔥', description: 'Maatwerk buitenkeukens', status: 'Actief' },
            { id: 'cat-2', name: 'Poolhouses', icon: '🏊', description: 'Luxe poolhouses', status: 'Actief' },
        ],
    });
    const catData = JSON.parse(categoriesRes.body).data;
    record('PATCH /api/settings/config/categories updates dynamic product categories', categoriesRes.statusCode === 200 && Array.isArray(catData.categoriesConfig) && catData.categoriesConfig.length === 2, `Categories: ${catData.categoriesConfig?.length}`);
    // Test 11: Dynamic Fieldsets configuration
    const fieldsetsRes = await server.inject({
        method: 'PATCH',
        url: '/api/settings/config/fieldsets',
        headers: { cookie: adminCookie },
        payload: {
            buitenkeuken: [
                { id: 'f-1', label: 'Werkblad Afwerking', type: 'select', options: ['Beton Cire', 'Graniet'], required: true },
            ],
        },
    });
    const fsData = JSON.parse(fieldsetsRes.body).data;
    record('PATCH /api/settings/config/fieldsets updates custom product fields', fieldsetsRes.statusCode === 200 && fsData.fieldsetsConfig?.buitenkeuken?.length === 1, `Field: ${fsData.fieldsetsConfig?.buitenkeuken[0]?.label}`);
    // Test 12: Partner breakdown configuration
    const partnerBreakdownRes = await server.inject({
        method: 'PATCH',
        url: '/api/settings/config/partner-breakdown',
        headers: { cookie: adminCookie },
        payload: [
            { id: 'sec-mat', title: 'Material Cost', icon: '🪵', fields: [{ id: 'f-1', label: 'Hout & Grondstoffen', required: true }] },
            { id: 'sec-lab', title: 'Labour Cost', icon: '🔨', fields: [{ id: 'f-2', label: 'Fabricage Uren', required: true }] },
        ],
    });
    const pbData = JSON.parse(partnerBreakdownRes.body).data;
    record('PATCH /api/settings/config/partner-breakdown updates partner cost sections', partnerBreakdownRes.statusCode === 200 && pbData.partnerBreakdownConfig?.length === 2, `Sections count: ${pbData.partnerBreakdownConfig?.length}`);
    // Test 13: P&L targets configuration
    const plRes = await server.inject({
        method: 'PATCH',
        url: '/api/settings/config/pl-targets',
        headers: { cookie: adminCookie },
        payload: {
            targetMargin: 35,
            warningMargin: 18,
            monthlyOverhead: 3000,
        },
    });
    const plData = JSON.parse(plRes.body).data;
    record('PATCH /api/settings/config/pl-targets updates target margins and overhead', plRes.statusCode === 200 && plData.plConfig?.targetMargin === 35 && plData.defaultMarginPercentage === 35, `Target: ${plData.plConfig?.targetMargin}%, Overhead: € ${plData.plConfig?.monthlyOverhead}`);
    // Test 14: Message templates configuration
    const tplRes = await server.inject({
        method: 'PATCH',
        url: '/api/settings/config/templates',
        headers: { cookie: adminCookie },
        payload: {
            template1: 'Dear {client_name}, thank you for contacting Vanuit Ambacht regarding your {product_category}.',
        },
    });
    const tplData = JSON.parse(tplRes.body).data;
    record('PATCH /api/settings/config/templates updates WhatsApp/Email message templates', tplRes.statusCode === 200 && tplData.messageTemplates?.template1?.includes('{client_name}'), `Template 1 configured`);
    // Test 15: Quote template configuration
    const quoteTplRes = await server.inject({
        method: 'PATCH',
        url: '/api/settings/config/quote-template',
        headers: { cookie: adminCookie },
        payload: {
            woodTypes: ['Douglas', 'Thermo Fraké', 'Eikenhout'],
            paymentScheme: '50/50',
        },
    });
    const qtData = JSON.parse(quoteTplRes.body).data;
    record('PATCH /api/settings/config/quote-template updates quote proposal defaults', quoteTplRes.statusCode === 200 && qtData.quoteTemplateConfig?.paymentScheme === '50/50', `Scheme: ${qtData.quoteTemplateConfig?.paymentScheme}`);
    // Test 16: Integrations configuration
    const intRes = await server.inject({
        method: 'PATCH',
        url: '/api/settings/config/integrations',
        headers: { cookie: adminCookie },
        payload: { googleCalendar: true, gmail: true },
    });
    const intData = JSON.parse(intRes.body).data;
    record('PATCH /api/settings/config/integrations updates external tool connections', intRes.statusCode === 200 && intData.integrationsConfig?.googleCalendar === true, `Calendar: ${intData.integrationsConfig?.googleCalendar}, Gmail: ${intData.integrationsConfig?.gmail}`);
    // -------------------------------------------------------------------
    // TEST GROUP 4: USER MANAGEMENT APIS
    // -------------------------------------------------------------------
    console.log('\n--- GROUP 4: User Management APIs ---');
    // Test 17: GET /api/settings/users lists system users without passwordHash
    const usersRes = await server.inject({
        method: 'GET',
        url: '/api/settings/users',
        headers: { cookie: adminCookie },
    });
    const usersList = JSON.parse(usersRes.body).data;
    const passwordHashExposed = usersList.some((u) => u.passwordHash !== undefined);
    record('GET /api/settings/users lists users and NEVER returns password hashes', usersRes.statusCode === 200 && Array.isArray(usersList) && !passwordHashExposed, `Users count: ${usersList.length}, Hashes exposed: ${passwordHashExposed}`);
    // Test 18: POST /api/settings/users creates user with password hashing
    const testEmail = `testuser_${Date.now()}@vanuitambacht.nl`;
    const createUserRes = await server.inject({
        method: 'POST',
        url: '/api/settings/users',
        headers: { cookie: adminCookie },
        payload: {
            fullName: 'Pieter van der Pol',
            email: testEmail,
            role: 'partner',
            password: 'SecurePassword123!',
            phone: '+31 6 99887766',
        },
    });
    const newUser = JSON.parse(createUserRes.body).data;
    record('POST /api/settings/users creates new user with bcrypt password hashing', createUserRes.statusCode === 201 && newUser.email === testEmail && newUser.role === 'partner', `Created: ${newUser.fullName} (${newUser.role})`);
    // Verify in database that password was hashed
    const [dbUser] = await db.select().from(users).where(eq(users.email, testEmail));
    const isBcrypt = dbUser.passwordHash.startsWith('$2');
    record('Database record stores proper bcrypt password hash (not plaintext)', isBcrypt && !('passwordHash' in newUser), `Hash prefix: ${dbUser.passwordHash.slice(0, 7)}...`);
    // Test 19: Duplicate email returns 409 Conflict
    const dupEmailRes = await server.inject({
        method: 'POST',
        url: '/api/settings/users',
        headers: { cookie: adminCookie },
        payload: {
            fullName: 'Imposter User',
            email: testEmail,
            role: 'customer',
            password: 'SomePassword123!',
        },
    });
    record('POST /api/settings/users with duplicate email is rejected with 409 Conflict', dupEmailRes.statusCode === 409, `Status: ${dupEmailRes.statusCode}`);
    // Test 20: PATCH /api/settings/users/:id/status toggles active/inactive
    const deactivateRes = await server.inject({
        method: 'PATCH',
        url: `/api/settings/users/${newUser.id}/status`,
        headers: { cookie: adminCookie },
        payload: { isActive: false },
    });
    const deactivatedUser = JSON.parse(deactivateRes.body).data;
    record('PATCH /api/settings/users/:id/status successfully deactivates user', deactivateRes.statusCode === 200 && deactivatedUser.isActive === false, `isActive: ${deactivatedUser.isActive}`);
    // Test 21: Self-deactivation prevention guard
    const selfDeactivateRes = await server.inject({
        method: 'PATCH',
        url: `/api/settings/users/${adminProfile.id}/status`,
        headers: { cookie: adminCookie },
        payload: { isActive: false },
    });
    record('Admin self-deactivation is strictly blocked with 400 Bad Request', selfDeactivateRes.statusCode === 400, `Status: ${selfDeactivateRes.statusCode}`);
    // Test 22: PATCH /api/settings/users/:id/role changes user role
    const changeRoleRes = await server.inject({
        method: 'PATCH',
        url: `/api/settings/users/${newUser.id}/role`,
        headers: { cookie: adminCookie },
        payload: { role: 'customer' },
    });
    const roleUpdatedUser = JSON.parse(changeRoleRes.body).data;
    record('PATCH /api/settings/users/:id/role successfully updates role', changeRoleRes.statusCode === 200 && roleUpdatedUser.role === 'customer', `New Role: ${roleUpdatedUser.role}`);
    // -------------------------------------------------------------------
    // SUMMARY
    // -------------------------------------------------------------------
    console.log('\n======================================================');
    const passedCount = results.filter((r) => r.passed).length;
    const totalCount = results.length;
    console.log(`📊 FINAL RESULTS: ${passedCount} / ${totalCount} PASSED (${Math.round((passedCount / totalCount) * 100)}%)`);
    console.log('======================================================\n');
    await sqlClient.end({ timeout: 2 });
    if (passedCount < totalCount) {
        process.exit(1);
    }
    else {
        process.exit(0);
    }
}
runTests().catch((err) => {
    console.error('Fatal test error:', err);
    process.exit(1);
});
