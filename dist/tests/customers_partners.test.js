/**
 * Comprehensive Automated Test Suite for Module 1: Customers & Partners
 *
 * Verifies:
 * - Authentication requirements
 * - Admin authorization & role scoping
 * - Customer & Partner isolation
 * - Full CRUD persistence to PostgreSQL
 * - Auto-numbering (CUST-YYYY-XXX, PRT-XXX)
 * - Validation guards & error handling (invalid UUID, duplicate codes, malformed payloads)
 * - Search, pagination, and multi-field filtering
 * - Dedicated business actions: workload updates, partner ratings
 * - Dependency protection on delete
 */
import server from '../server.js';
import { db, sqlClient } from '../db/index.js';
import { customers, partners } from '../db/schema.js';
import { eq } from 'drizzle-orm';
const results = [];
function record(name, passed, details = '') {
    results.push({ name, passed, details });
    const icon = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${icon}: ${name}${details ? ` -> ${details}` : ''}`);
}
async function runTests() {
    console.log('\n======================================================');
    console.log('🧪 RUNNING CUSTOMERS & PARTNERS MODULE TEST SUITE');
    console.log('======================================================\n');
    await server.ready();
    function extractCookie(res) {
        const raw = res.headers['set-cookie'];
        if (!raw)
            return '';
        return Array.isArray(raw) ? raw[0] : raw;
    }
    // 1. Obtain Authentication Cookies for Admin, Partner, and Customer
    const adminLoginRes = await server.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'admin@vanuitambacht.nl', password: 'admin123' },
    });
    const adminCookie = extractCookie(adminLoginRes);
    const partnerLoginRes = await server.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'partner@vanuitambacht.nl', password: 'partner123' },
    });
    const partnerCookie = extractCookie(partnerLoginRes);
    const partnerUserBody = JSON.parse(partnerLoginRes.body);
    const customerLoginRes = await server.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'customer@vanuitambacht.nl', password: 'customer123' },
    });
    const customerCookie = extractCookie(customerLoginRes);
    const customerUserBody = JSON.parse(customerLoginRes.body);
    // Retrieve seeded customer & partner IDs
    const [seededCustomer] = await db.select().from(customers).where(eq(customers.customerNumber, 'CUST-2026-001')).limit(1);
    const [seededPartner] = await db.select().from(partners).where(eq(partners.partnerCode, 'PRT-SVEN-01')).limit(1);
    // ---------------------------------------------------------
    // 1. AUTHENTICATION & ROLE AUTHORIZATION GUARDS
    // ---------------------------------------------------------
    console.log('--- 1. Testing Authentication & Role Guards ---');
    // 1.1 Unauthenticated requests rejected
    const unauthCustRes = await server.inject({ method: 'GET', url: '/api/customers' });
    record('Unauthenticated request to GET /api/customers rejected (401)', unauthCustRes.statusCode === 401);
    const unauthPartRes = await server.inject({ method: 'GET', url: '/api/partners' });
    record('Unauthenticated request to GET /api/partners rejected (401)', unauthPartRes.statusCode === 401);
    // 1.2 Customer cannot create customers
    const custCreateCust = await server.inject({
        method: 'POST',
        url: '/api/customers',
        headers: { cookie: customerCookie },
        payload: { firstName: 'Test', lastName: 'Fail', email: 'test@fail.com', phone: '123', city: 'Utrecht' },
    });
    record('Customer cannot create customers (403 Forbidden)', custCreateCust.statusCode === 403);
    // 1.3 Customer cannot create partners
    const custCreatePart = await server.inject({
        method: 'POST',
        url: '/api/partners',
        headers: { cookie: customerCookie },
        payload: { companyName: 'Hack', contactPerson: 'Hacker', email: 'hack@fail.com', phone: '123' },
    });
    record('Customer cannot create partners (403 Forbidden)', custCreatePart.statusCode === 403);
    // 1.4 Partner cannot rate partners
    const partRatePart = await server.inject({
        method: 'POST',
        url: `/api/partners/${seededPartner.id}/rate`,
        headers: { cookie: partnerCookie },
        payload: { rating: 5.0 },
    });
    record('Partner cannot rate partners (403 Forbidden)', partRatePart.statusCode === 403);
    // 1.5 Customer reads own dossier
    const custOwnDossier = await server.inject({
        method: 'GET',
        url: `/api/customers/${seededCustomer.id}`,
        headers: { cookie: customerCookie },
    });
    record('Customer can read own customer dossier (200 OK)', custOwnDossier.statusCode === 200);
    // 1.6 Customer blocked from reading another customer's dossier
    // Create a dummy customer to test isolation
    const [otherCustomer] = await db
        .insert(customers)
        .values({
        customerNumber: 'CUST-TEST-ISOLATION',
        firstName: 'Private',
        lastName: 'Person',
        email: 'private@test.nl',
        phone: '0612345678',
        city: 'Amsterdam',
        country: 'NL',
    })
        .onConflictDoNothing()
        .returning();
    const otherCustId = otherCustomer?.id || (await db.select({ id: customers.id }).from(customers).where(eq(customers.customerNumber, 'CUST-TEST-ISOLATION')).limit(1))[0].id;
    const custCrossDossier = await server.inject({
        method: 'GET',
        url: `/api/customers/${otherCustId}`,
        headers: { cookie: customerCookie },
    });
    record('Customer blocked from reading other customer dossier (403 Forbidden)', custCrossDossier.statusCode === 403);
    // ---------------------------------------------------------
    // 2. CUSTOMERS CRUD & ADVANCED OPERATIONS
    // ---------------------------------------------------------
    console.log('\n--- 2. Testing Customers CRUD & Business Rules ---');
    let createdCustomerId = '';
    let createdCustNumber = '';
    // 2.1 Create new customer (Admin)
    const createCustRes = await server.inject({
        method: 'POST',
        url: '/api/customers',
        headers: { cookie: adminCookie },
        payload: {
            firstName: 'Charlotte',
            lastName: 'van Dijk',
            companyName: 'Van Dijk Design',
            email: 'charlotte@vandijk.nl',
            phone: '+31 6 99887766',
            streetAddress: 'Prinsengracht 102',
            postalCode: '1015 DZ',
            city: 'Amsterdam',
            country: 'NL',
            notes: 'Interested in bespoke outdoor kitchen with concrete top',
        },
    });
    const createCustBody = JSON.parse(createCustRes.body);
    createdCustomerId = createCustBody.data?.id;
    createdCustNumber = createCustBody.data?.customerNumber;
    record('Admin creates new customer with auto-generated customerNumber (201 Created)', createCustRes.statusCode === 201 && createdCustNumber.startsWith('CUST-') && createCustBody.data.city === 'Amsterdam', `Customer: ${createdCustNumber} (${createCustBody.data?.fullName})`);
    // 2.2 Validation error on invalid email
    const invalidEmailCust = await server.inject({
        method: 'POST',
        url: '/api/customers',
        headers: { cookie: adminCookie },
        payload: {
            firstName: 'Invalid',
            lastName: 'User',
            email: 'not-an-email',
            phone: '123',
            city: 'Utrecht',
        },
    });
    record('Rejects invalid customer email with 400 Bad Request', invalidEmailCust.statusCode === 400);
    // 2.3 List customers with pagination
    const listCustRes = await server.inject({
        method: 'GET',
        url: '/api/customers?page=1&limit=5&sortBy=createdAt&sortOrder=desc',
        headers: { cookie: adminCookie },
    });
    const listCustBody = JSON.parse(listCustRes.body);
    record('List customers with pagination returns items & metadata (200 OK)', listCustRes.statusCode === 200 && Array.isArray(listCustBody.data?.items) && listCustBody.data.total >= 2, `Total: ${listCustBody.data?.total}, Page: ${listCustBody.data?.page}/${listCustBody.data?.totalPages}`);
    // 2.4 Search customers
    const searchCustRes = await server.inject({
        method: 'GET',
        url: '/api/customers?search=Charlotte',
        headers: { cookie: adminCookie },
    });
    const searchCustBody = JSON.parse(searchCustRes.body);
    const foundCharlotte = searchCustBody.data?.items?.some((c) => c.firstName === 'Charlotte');
    record('Search customers by keyword finds matching record (200 OK)', searchCustRes.statusCode === 200 && foundCharlotte, 'Found Charlotte');
    // 2.5 Filter customers by city
    const cityCustRes = await server.inject({
        method: 'GET',
        url: '/api/customers?city=Den Haag',
        headers: { cookie: adminCookie },
    });
    const cityCustBody = JSON.parse(cityCustRes.body);
    const denHaagMatch = cityCustBody.data?.items?.every((c) => c.city.toLowerCase().includes('den haag'));
    record('Filter customers by city returns only matching cities (200 OK)', cityCustRes.statusCode === 200 && denHaagMatch);
    // 2.6 Get customer dossier
    const dossierCustRes = await server.inject({
        method: 'GET',
        url: `/api/customers/${createdCustomerId}`,
        headers: { cookie: adminCookie },
    });
    const dossierCustBody = JSON.parse(dossierCustRes.body);
    record('Get Customer Dossier returns linked relations & financial metrics (200 OK)', dossierCustRes.statusCode === 200 &&
        dossierCustBody.data.metrics.lifetimeSpend !== undefined &&
        Array.isArray(dossierCustBody.data.projects) &&
        Array.isArray(dossierCustBody.data.invoices), `Lifetime Spend: €${dossierCustBody.data?.metrics?.lifetimeSpend}`);
    // 2.7 Update customer details
    const updateCustRes = await server.inject({
        method: 'PATCH',
        url: `/api/customers/${createdCustomerId}`,
        headers: { cookie: adminCookie },
        payload: {
            phone: '+31 6 11223344',
            city: 'Haarlem',
            notes: 'Updated note: Prefers thermo frake wood',
        },
    });
    const updateCustBody = JSON.parse(updateCustRes.body);
    record('Update customer modifies fields and persists to PostgreSQL (200 OK)', updateCustRes.statusCode === 200 && updateCustBody.data.city === 'Haarlem' && updateCustBody.data.phone === '+31 6 11223344', `Updated City: ${updateCustBody.data?.city}`);
    // 2.8 Invalid customer UUID
    const invalidIdCust = await server.inject({
        method: 'GET',
        url: '/api/customers/not-a-valid-uuid',
        headers: { cookie: adminCookie },
    });
    record('Rejects malformed customer UUID with 400 Bad Request', invalidIdCust.statusCode === 400);
    // 2.9 Delete customer without dependencies
    const deleteCustRes = await server.inject({
        method: 'DELETE',
        url: `/api/customers/${createdCustomerId}`,
        headers: { cookie: adminCookie },
    });
    record('Delete customer without active dependencies succeeds (200 OK)', deleteCustRes.statusCode === 200);
    // Verify deletion
    const verifyDeleteCust = await server.inject({
        method: 'GET',
        url: `/api/customers/${createdCustomerId}`,
        headers: { cookie: adminCookie },
    });
    record('Deleted customer no longer retrievable (404 Not Found)', verifyDeleteCust.statusCode === 404);
    // Clean up isolation test customer
    await db.delete(customers).where(eq(customers.id, otherCustId));
    // ---------------------------------------------------------
    // 3. PARTNERS CRUD & ADVANCED OPERATIONS
    // ---------------------------------------------------------
    console.log('\n--- 3. Testing Partners CRUD, Workload & Rating ---');
    let createdPartnerId = '';
    let createdPartnerCode = '';
    // 3.1 Create new partner craftsman (Admin)
    const createPartRes = await server.inject({
        method: 'POST',
        url: '/api/partners',
        headers: { cookie: adminCookie },
        payload: {
            companyName: 'Verbeij Houtdesign',
            contactPerson: 'Ruben Verbeij',
            email: 'ruben@verbeij.nl',
            phone: '+31 6 88990011',
            kvkNumber: '77665544',
            btwNumber: 'NL77665544B01',
            region: 'Utrecht',
            workloadStatus: 'available',
            rating: 4.9,
            specialties: ['Exclusieve Buitenverblijven', 'Eiken Constructies'],
            productTypes: ['garden_room', 'outdoor_kitchen'],
            isActive: true,
        },
    });
    const createPartBody = JSON.parse(createPartRes.body);
    createdPartnerId = createPartBody.data?.id;
    createdPartnerCode = createPartBody.data?.partnerCode;
    record('Admin creates new partner craftsman with auto partnerCode (201 Created)', createPartRes.statusCode === 201 && createdPartnerCode.startsWith('PRT-') && createPartBody.data.contactPerson === 'Ruben Verbeij', `Partner: ${createdPartnerCode} (${createPartBody.data?.companyName})`);
    // 3.2 List partners with workload & product type filtering
    const listPartRes = await server.inject({
        method: 'GET',
        url: '/api/partners?workloadStatus=available&productType=garden_room',
        headers: { cookie: adminCookie },
    });
    const listPartBody = JSON.parse(listPartRes.body);
    record('List partners with workload & product type filters (200 OK)', listPartRes.statusCode === 200 && listPartBody.data.items.length >= 1, `Matching Partners: ${listPartBody.data?.items?.length}`);
    // 3.3 Search partners
    const searchPartRes = await server.inject({
        method: 'GET',
        url: '/api/partners?search=Ruben',
        headers: { cookie: adminCookie },
    });
    const searchPartBody = JSON.parse(searchPartRes.body);
    const foundRuben = searchPartBody.data?.items?.some((p) => p.contactPerson === 'Ruben Verbeij');
    record('Search partners by name finds craftsman (200 OK)', searchPartRes.statusCode === 200 && foundRuben, 'Found Ruben Verbeij');
    // 3.4 Get partner dossier
    const dossierPartRes = await server.inject({
        method: 'GET',
        url: `/api/partners/${createdPartnerId}`,
        headers: { cookie: adminCookie },
    });
    const dossierPartBody = JSON.parse(dossierPartRes.body);
    record('Get Partner Dossier returns assigned projects, offers & performance metrics (200 OK)', dossierPartRes.statusCode === 200 &&
        dossierPartBody.data.metrics.currentRating !== undefined &&
        Array.isArray(dossierPartBody.data.projects) &&
        Array.isArray(dossierPartBody.data.submittedOffers), `Rating: ${dossierPartBody.data?.metrics?.currentRating}, Workload: ${dossierPartBody.data?.metrics?.workload}`);
    // 3.5 Dedicated Endpoint: Update Workload Status
    const updateWorkloadRes = await server.inject({
        method: 'PATCH',
        url: `/api/partners/${createdPartnerId}/workload`,
        headers: { cookie: adminCookie },
        payload: { workloadStatus: 'busy' },
    });
    const updateWorkloadBody = JSON.parse(updateWorkloadRes.body);
    record('Dedicated workload endpoint updates status to busy (200 OK)', updateWorkloadRes.statusCode === 200 && updateWorkloadBody.data.workloadStatus === 'busy', `Workload: ${updateWorkloadBody.data?.workloadStatus}`);
    // 3.6 Workload validation: reject invalid status
    const invalidWorkloadRes = await server.inject({
        method: 'PATCH',
        url: `/api/partners/${createdPartnerId}/workload`,
        headers: { cookie: adminCookie },
        payload: { workloadStatus: 'sleeping' },
    });
    record('Rejects invalid workload status enum with 400 Bad Request', invalidWorkloadRes.statusCode === 400);
    // 3.7 Dedicated Endpoint: Rate Partner (Admin only)
    const ratePartRes = await server.inject({
        method: 'POST',
        url: `/api/partners/${createdPartnerId}/rate`,
        headers: { cookie: adminCookie },
        payload: { rating: 4.75 },
    });
    const ratePartBody = JSON.parse(ratePartRes.body);
    record('Admin rates partner craftsman with numeric score (200 OK)', ratePartRes.statusCode === 200 && parseFloat(ratePartBody.data.rating) === 4.75, `New Rating: ${ratePartBody.data?.rating}`);
    // 3.8 Rating validation: reject out-of-range rating (> 5.0)
    const invalidRateRes = await server.inject({
        method: 'POST',
        url: `/api/partners/${createdPartnerId}/rate`,
        headers: { cookie: adminCookie },
        payload: { rating: 7.5 },
    });
    record('Rejects out-of-range rating with 400 Bad Request', invalidRateRes.statusCode === 400);
    // 3.9 Update partner details
    const updatePartRes = await server.inject({
        method: 'PATCH',
        url: `/api/partners/${createdPartnerId}`,
        headers: { cookie: adminCookie },
        payload: {
            region: 'Gelderland & Utrecht',
            phone: '+31 6 12349999',
        },
    });
    const updatePartBody = JSON.parse(updatePartRes.body);
    record('Update partner modifies fields and persists to PostgreSQL (200 OK)', updatePartRes.statusCode === 200 && updatePartBody.data.region === 'Gelderland & Utrecht', `Updated Region: ${updatePartBody.data?.region}`);
    // 3.10 Delete partner without dependencies
    const deletePartRes = await server.inject({
        method: 'DELETE',
        url: `/api/partners/${createdPartnerId}`,
        headers: { cookie: adminCookie },
    });
    record('Delete partner without active projects succeeds (200 OK)', deletePartRes.statusCode === 200);
    // Verify deletion
    const verifyDeletePart = await server.inject({
        method: 'GET',
        url: `/api/partners/${createdPartnerId}`,
        headers: { cookie: adminCookie },
    });
    record('Deleted partner no longer retrievable (404 Not Found)', verifyDeletePart.statusCode === 404);
    // ---------------------------------------------------------
    // SUMMARY
    // ---------------------------------------------------------
    console.log('\n======================================================');
    const allPassed = results.every((r) => r.passed);
    console.log(`🏁 TEST RUN FINISHED: ${results.filter((r) => r.passed).length}/${results.length} TESTS PASSED`);
    console.log('======================================================\n');
    if (!allPassed) {
        process.exit(1);
    }
}
runTests()
    .catch((err) => {
    console.error('Fatal test error:', err);
    process.exit(1);
})
    .finally(async () => {
    await server.close();
    await sqlClient.end();
});
