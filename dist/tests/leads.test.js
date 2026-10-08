/**
 * Comprehensive Automated Test Suite for Module 2: Leads & Sales Pipeline
 *
 * Verifies:
 * - Authentication requirements (401)
 * - RBAC guards: Admin only; Partner & Customer forbidden (403)
 * - Lead intake creation with auto-numbering (LEAD-YYYY-XXX) & initial note
 * - Input validation & error responses (400)
 * - Query filters, search, and pagination
 * - Complete Lead Dossier retrieval (voice notes, commercial actions, linked customer)
 * - Lead field updates (PATCH /api/leads/:id)
 * - 8-step workflow progression with automatic status synchronization (PATCH /api/leads/:id/step)
 * - Status transitions (Won, Lost with lostReason) (PATCH /api/leads/:id/status)
 * - Plaud AI voice note upload and transcript update
 * - Commercial actions with automatic follow-up task generation
 * - Transactional 1-click lead to customer conversion
 * - Duplicate conversion prevention (409 Conflict)
 * - Lead deletion and dependency handling
 */
import server from '../server.js';
import { db, sqlClient } from '../db/index.js';
import { commercialActions } from '../db/schema.js';
import { eq } from 'drizzle-orm';
const results = [];
function record(name, passed, details = '') {
    results.push({ name, passed, details });
    const icon = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${icon}: ${name}${details ? ` -> ${details}` : ''}`);
}
async function runTests() {
    console.log('\n======================================================');
    console.log('🧪 RUNNING LEADS & SALES PIPELINE MODULE TEST SUITE');
    console.log('======================================================\n');
    await server.ready();
    function extractCookie(res) {
        const raw = res.headers['set-cookie'];
        if (!raw)
            return '';
        return Array.isArray(raw) ? raw[0] : raw;
    }
    // ---------------------------------------------------------
    // 0. AUTHENTICATION SETUP
    // ---------------------------------------------------------
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
    const customerLoginRes = await server.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'customer@vanuitambacht.nl', password: 'customer123' },
    });
    const customerCookie = extractCookie(customerLoginRes);
    let lead1Id = '';
    let lead1Number = '';
    let lead2Id = '';
    let scratchLeadId = '';
    let voiceNote1Id = '';
    // ---------------------------------------------------------
    // 1. AUTHENTICATION & RBAC GUARDS
    // ---------------------------------------------------------
    console.log('--- 1. Testing Authentication & RBAC Guards ---');
    // 1.1 Unauthenticated requests rejected
    const unauthRes = await server.inject({ method: 'GET', url: '/api/leads' });
    record('Unauthenticated GET /api/leads rejected with 401', unauthRes.statusCode === 401);
    // 1.2 Partner role rejected (Leads are Admin only)
    const partnerGetRes = await server.inject({
        method: 'GET',
        url: '/api/leads',
        headers: { cookie: partnerCookie },
    });
    record('Partner GET /api/leads rejected with 403 Forbidden', partnerGetRes.statusCode === 403);
    // 1.3 Customer role rejected
    const custGetRes = await server.inject({
        method: 'GET',
        url: '/api/leads',
        headers: { cookie: customerCookie },
    });
    record('Customer GET /api/leads rejected with 403 Forbidden', custGetRes.statusCode === 403);
    // 1.4 Partner cannot create lead
    const partnerCreateRes = await server.inject({
        method: 'POST',
        url: '/api/leads',
        headers: { cookie: partnerCookie },
        payload: { name: 'Unauthorized Lead', email: 'unauth@test.nl' },
    });
    record('Partner POST /api/leads rejected with 403 Forbidden', partnerCreateRes.statusCode === 403);
    // ---------------------------------------------------------
    // 2. LEAD INTAKE (CREATION) & AUTO-NUMBERING
    // ---------------------------------------------------------
    console.log('\n--- 2. Testing Lead Intake & Auto-numbering ---');
    // 2.1 Validation failure: missing name
    const invalidCreateRes = await server.inject({
        method: 'POST',
        url: '/api/leads',
        headers: { cookie: adminCookie },
        payload: { email: 'noname@domain.nl' },
    });
    record('POST /api/leads missing name returns 400 Bad Request', invalidCreateRes.statusCode === 400);
    // 2.2 Validation failure: invalid email format
    const invalidEmailRes = await server.inject({
        method: 'POST',
        url: '/api/leads',
        headers: { cookie: adminCookie },
        payload: { name: 'Bad Email Lead', email: 'not-an-email' },
    });
    record('POST /api/leads invalid email returns 400 Bad Request', invalidEmailRes.statusCode === 400);
    // 2.3 Successful lead creation with auto-numbering and initial note
    const createLead1Res = await server.inject({
        method: 'POST',
        url: '/api/leads',
        headers: { cookie: adminCookie },
        payload: {
            name: 'Bram van der Meer',
            email: 'bram.vandermeer@example.nl',
            phone: '+31 6 12349876',
            address: 'Keizersgracht 450',
            city: 'Amsterdam',
            productType: 'outdoor_kitchen',
            dimensionsInquiry: '280 x 100 x 76 cm, live-edge',
            notes: 'Customer contacted via website form. High interest in custom outdoor kitchen.',
        },
    });
    const createLead1Body = JSON.parse(createLead1Res.body);
    lead1Id = createLead1Body.data?.id;
    lead1Number = createLead1Body.data?.leadNumber;
    const validLeadNumber = /^LEAD-\d{4}-\d{3,}$/.test(lead1Number || '');
    record('POST /api/leads creates lead with status 201 & auto-number LEAD-YYYY-XXX', createLead1Res.statusCode === 201 && validLeadNumber && createLead1Body.data?.workflowStep === 1 && createLead1Body.data?.status === 'new', `Lead Number: ${lead1Number}, Step: ${createLead1Body.data?.workflowStep}, Status: ${createLead1Body.data?.status}`);
    // Verify initial note in commercial_actions table
    let initialActionFound = false;
    if (lead1Id) {
        const lead1Actions = await db
            .select()
            .from(commercialActions)
            .where(eq(commercialActions.leadId, lead1Id));
        initialActionFound = lead1Actions.length >= 1;
    }
    record('Initial intake note automatically logged in commercial_actions', initialActionFound, `Lead: ${lead1Number}`);
    // 2.4 Create second lead for filtering tests
    const createLead2Res = await server.inject({
        method: 'POST',
        url: '/api/leads',
        headers: { cookie: adminCookie },
        payload: {
            name: 'Sophie de Boer',
            email: 'sophie.deboer@designstudio.nl',
            phone: '+31 6 98761234',
            city: 'Utrecht',
            productType: 'garden_room',
            notes: 'Garden room project for Utrecht apartment.',
        },
    });
    const createLead2Body = JSON.parse(createLead2Res.body);
    lead2Id = createLead2Body.data?.id;
    record('POST /api/leads second lead created', createLead2Res.statusCode === 201, `Lead: ${createLead2Body.data?.leadNumber}`);
    // ---------------------------------------------------------
    // 3. SEARCH, FILTERS & PAGINATION
    // ---------------------------------------------------------
    console.log('\n--- 3. Testing Search, Filtering & Pagination ---');
    // 3.1 Search by customer name
    const searchNameRes = await server.inject({
        method: 'GET',
        url: '/api/leads?search=Bram',
        headers: { cookie: adminCookie },
    });
    const searchNameBody = JSON.parse(searchNameRes.body);
    record('GET /api/leads?search=Bram finds matching lead', searchNameRes.statusCode === 200 && searchNameBody.data.items.some((l) => l.name.includes('Bram')), `Found items: ${searchNameBody.data?.items?.length}`);
    // 3.2 Filter by productType
    const filterTypeRes = await server.inject({
        method: 'GET',
        url: '/api/leads?productType=garden_room',
        headers: { cookie: adminCookie },
    });
    const filterTypeBody = JSON.parse(filterTypeRes.body);
    record('GET /api/leads?productType=garden_room filters correctly', filterTypeRes.statusCode === 200 && filterTypeBody.data.items.every((l) => l.productType === 'garden_room'), `Garden room leads: ${filterTypeBody.data?.items?.length}`);
    // 3.3 Filter by workflowStep
    const filterStepRes = await server.inject({
        method: 'GET',
        url: '/api/leads?workflowStep=1',
        headers: { cookie: adminCookie },
    });
    const filterStepBody = JSON.parse(filterStepRes.body);
    record('GET /api/leads?workflowStep=1 returns step 1 leads', filterStepRes.statusCode === 200 && filterStepBody.data.items.every((l) => l.workflowStep === 1), `Step 1 leads: ${filterStepBody.data?.items?.length}`);
    // 3.4 Pagination
    const pageRes = await server.inject({
        method: 'GET',
        url: '/api/leads?page=1&limit=1',
        headers: { cookie: adminCookie },
    });
    const pageBody = JSON.parse(pageRes.body);
    record('GET /api/leads pagination limit=1 returns exactly 1 item and meta info', pageRes.statusCode === 200 && pageBody.data.items.length === 1 && pageBody.data.limit === 1, `Total: ${pageBody.data?.total}, TotalPages: ${pageBody.data?.totalPages}`);
    // ---------------------------------------------------------
    // 4. LEAD DOSSIER & RETRIEVAL
    // ---------------------------------------------------------
    console.log('\n--- 4. Testing Lead Dossier & Retrieval ---');
    // 4.1 Invalid UUID param
    const invalidIdRes = await server.inject({
        method: 'GET',
        url: '/api/leads/not-a-uuid',
        headers: { cookie: adminCookie },
    });
    record('GET /api/leads/invalid-uuid returns 400 Bad Request', invalidIdRes.statusCode === 400);
    // 4.2 Non-existent UUID
    const notFoundRes = await server.inject({
        method: 'GET',
        url: '/api/leads/00000000-0000-0000-0000-000000000000',
        headers: { cookie: adminCookie },
    });
    record('GET /api/leads/non-existent-uuid returns 404 Not Found', notFoundRes.statusCode === 404);
    // 4.3 Successful dossier retrieval with nested relations
    const dossierRes = await server.inject({
        method: 'GET',
        url: `/api/leads/${lead1Id}`,
        headers: { cookie: adminCookie },
    });
    const dossierBody = JSON.parse(dossierRes.body);
    record('GET /api/leads/:id returns full dossier (lead info, voiceNotes, commercialActions, customer)', dossierRes.statusCode === 200 &&
        dossierBody.data.id === lead1Id &&
        Array.isArray(dossierBody.data.voiceNotes) &&
        Array.isArray(dossierBody.data.commercialActions) &&
        dossierBody.data.customer === null, `Lead: ${dossierBody.data?.name}, Actions: ${dossierBody.data?.commercialActions?.length}`);
    // ---------------------------------------------------------
    // 5. LEAD FIELD UPDATES
    // ---------------------------------------------------------
    console.log('\n--- 5. Testing Lead Updates ---');
    const updateLeadRes = await server.inject({
        method: 'PATCH',
        url: `/api/leads/${lead1Id}`,
        headers: { cookie: adminCookie },
        payload: {
            dimensionsInquiry: '300 x 105 x 76 cm, steel spider frame',
            city: 'Amstelveen',
        },
    });
    const updateLeadBody = JSON.parse(updateLeadRes.body);
    record('PATCH /api/leads/:id updates dimensionsInquiry and city', updateLeadRes.statusCode === 200 &&
        updateLeadBody.data.dimensionsInquiry === '300 x 105 x 76 cm, steel spider frame' &&
        updateLeadBody.data.city === 'Amstelveen', `New Dimensions: ${updateLeadBody.data?.dimensionsInquiry}, City: ${updateLeadBody.data?.city}`);
    // ---------------------------------------------------------
    // 6. 8-STEP WORKFLOW ADVANCEMENT & STATUS SYNCHRONIZATION
    // ---------------------------------------------------------
    console.log('\n--- 6. Testing 8-Step Workflow & Status Synchronization ---');
    // 6.1 Out of range step rejected
    const badStepRes = await server.inject({
        method: 'PATCH',
        url: `/api/leads/${lead1Id}/step`,
        headers: { cookie: adminCookie },
        payload: { workflowStep: 9 },
    });
    record('PATCH /api/leads/:id/step with step 9 rejected (400 Bad Request)', badStepRes.statusCode === 400);
    // 6.2 Advance to Step 2 (Intake Completed) -> status becomes 'in_conversation'
    const step2Res = await server.inject({
        method: 'PATCH',
        url: `/api/leads/${lead1Id}/step`,
        headers: { cookie: adminCookie },
        payload: { workflowStep: 2 },
    });
    const step2Body = JSON.parse(step2Res.body);
    record('PATCH /api/leads/:id/step advances to step 2 and syncs status to in_conversation', step2Res.statusCode === 200 && step2Body.data.workflowStep === 2 && step2Body.data.status === 'in_conversation', `Step: ${step2Body.data?.workflowStep}, Status: ${step2Body.data?.status}`);
    // 6.3 Advance to Step 4 (Quote Sent)
    const step4Res = await server.inject({
        method: 'PATCH',
        url: `/api/leads/${lead1Id}/step`,
        headers: { cookie: adminCookie },
        payload: { workflowStep: 4 },
    });
    const step4Body = JSON.parse(step4Res.body);
    record('PATCH /api/leads/:id/step advances to step 4 (Quote Sent)', step4Res.statusCode === 200 && step4Body.data.workflowStep === 4 && step4Body.data.status === 'quote_sent', `Step: ${step4Body.data?.workflowStep}, Status: ${step4Body.data?.status}`);
    // ---------------------------------------------------------
    // 7. STATUS UPDATES (WON, LOST + LOST REASON)
    // ---------------------------------------------------------
    console.log('\n--- 7. Testing Status Updates ---');
    // 7.1 Mark as lost with reason
    const markLostRes = await server.inject({
        method: 'PATCH',
        url: `/api/leads/${lead2Id}/status`,
        headers: { cookie: adminCookie },
        payload: {
            status: 'lost',
            lostReason: 'Budget constraint: Client chose cheaper ready-made alternative',
        },
    });
    const markLostBody = JSON.parse(markLostRes.body);
    record('PATCH /api/leads/:id/status updates status to lost with lostReason', markLostRes.statusCode === 200 &&
        markLostBody.data.status === 'lost' &&
        markLostBody.data.lostReason?.includes('Budget constraint'), `Status: ${markLostBody.data?.status}, Reason: ${markLostBody.data?.lostReason}`);
    // 7.2 Reopen lead back to in_conversation
    const reopenRes = await server.inject({
        method: 'PATCH',
        url: `/api/leads/${lead2Id}/status`,
        headers: { cookie: adminCookie },
        payload: { status: 'in_conversation' },
    });
    const reopenBody = JSON.parse(reopenRes.body);
    record('PATCH /api/leads/:id/status reopens lead to in_conversation and clears lostReason', reopenRes.statusCode === 200 && reopenBody.data.status === 'in_conversation' && reopenBody.data.lostReason === null, `Status: ${reopenBody.data?.status}`);
    // ---------------------------------------------------------
    // 8. PLAUD AI VOICE NOTES
    // ---------------------------------------------------------
    console.log('\n--- 8. Testing Plaud AI Voice Notes ---');
    // 8.1 Add voice note
    const addVoiceRes = await server.inject({
        method: 'POST',
        url: `/api/leads/${lead1Id}/voice-notes`,
        headers: { cookie: adminCookie },
        payload: {
            fileName: 'plaud-consultation-001.m4a',
            fileUrl: 'https://storage.vanuitambacht.nl/audio/plaud-consultation-001.m4a',
            durationSeconds: 195,
            transcriptText: 'Customer wants a smoked oak dining table with embedded matte black epoxy river. Length 3 meters.',
            aiSummary: 'Dimensions: 300x105cm. Finish: Smoked Oak with matte black epoxy. Delivery requested before Christmas.',
        },
    });
    const addVoiceBody = JSON.parse(addVoiceRes.body);
    voiceNote1Id = addVoiceBody.data?.id;
    record('POST /api/leads/:id/voice-notes records voice note with transcript and AI summary', addVoiceRes.statusCode === 201 && Boolean(voiceNote1Id) && addVoiceBody.data.durationSeconds === 195, `Voice Note ID: ${voiceNote1Id}`);
    // 8.2 Update voice note transcript / summary
    const updateVoiceRes = await server.inject({
        method: 'PATCH',
        url: `/api/leads/${lead1Id}/voice-notes/${voiceNote1Id}`,
        headers: { cookie: adminCookie },
        payload: {
            aiSummary: 'Updated Summary: Client confirmed 300x105cm, includes matching walnut bench.',
        },
    });
    const updateVoiceBody = JSON.parse(updateVoiceRes.body);
    record('PATCH /api/leads/:id/voice-notes/:vnId updates voice note summary', updateVoiceRes.statusCode === 200 && updateVoiceBody.data.aiSummary?.includes('walnut bench'), `Summary: ${updateVoiceBody.data?.aiSummary}`);
    // ---------------------------------------------------------
    // 9. COMMERCIAL ACTIONS & TASK CREATION
    // ---------------------------------------------------------
    console.log('\n--- 9. Testing Commercial Actions & Follow-up Tasks ---');
    // 9.1 Commercial action without task
    const actionRes = await server.inject({
        method: 'POST',
        url: `/api/leads/${lead1Id}/commercial-actions`,
        headers: { cookie: adminCookie },
        payload: {
            actionType: 'consultation_call',
            note: 'Follow-up phone consultation: Reviewed 3D CAD sketch and epoxy tint options.',
        },
    });
    const actionBody = JSON.parse(actionRes.body);
    record('POST /api/leads/:id/commercial-actions records call log', actionRes.statusCode === 201 && actionBody.data?.actionType === 'consultation_call' && Boolean(actionBody.data?.id), `Action ID: ${actionBody.data?.id}`);
    // 9.2 Commercial action with automatic task creation
    const actionWithTaskRes = await server.inject({
        method: 'POST',
        url: `/api/leads/${lead1Id}/commercial-actions`,
        headers: { cookie: adminCookie },
        payload: {
            actionType: 'quote_sent',
            note: 'Sent formal quotation €5,200. Follow-up required in 3 days.',
            createTask: true,
            taskTitle: 'Follow up on sent quote with client',
            taskDueDate: '2026-10-10',
            taskPriority: 'high',
        },
    });
    const actionWithTaskBody = JSON.parse(actionWithTaskRes.body);
    record('POST /api/leads/:id/commercial-actions with createTask creates atomic task in tasks table', actionWithTaskRes.statusCode === 201 &&
        Boolean(actionWithTaskBody.data?.linkedTaskId) &&
        actionWithTaskBody.data?.linkedTask !== null &&
        actionWithTaskBody.data?.linkedTask?.title === 'Follow up on sent quote with client', `Task ID: ${actionWithTaskBody.data?.linkedTask?.id}, Title: ${actionWithTaskBody.data?.linkedTask?.title}`);
    // ---------------------------------------------------------
    // 10. TRANSACTIONAL CUSTOMER CONVERSION
    // ---------------------------------------------------------
    console.log('\n--- 10. Testing Lead-to-Customer Conversion ---');
    // 10.1 Convert lead to customer
    const convertRes = await server.inject({
        method: 'POST',
        url: `/api/leads/${lead1Id}/convert-customer`,
        headers: { cookie: adminCookie },
    });
    const convertBody = JSON.parse(convertRes.body);
    const convertedCustomer = convertBody.data?.customer;
    const convertedLead = convertBody.data?.lead;
    record('POST /api/leads/:id/convert-customer creates customer, links lead, and advances step to 6/won', convertRes.statusCode === 200 &&
        Boolean(convertedCustomer?.id) &&
        Boolean(convertedCustomer?.customerNumber?.startsWith('CUST-')) &&
        convertedLead?.customerId === convertedCustomer.id &&
        convertedLead?.workflowStep >= 6 &&
        convertedLead?.status === 'won', `Customer: ${convertedCustomer?.customerNumber} (${convertedCustomer?.firstName} ${convertedCustomer?.lastName}), Lead Step: ${convertedLead?.workflowStep}`);
    // 10.2 Prevent duplicate conversion (409 Conflict)
    const duplicateConvertRes = await server.inject({
        method: 'POST',
        url: `/api/leads/${lead1Id}/convert-customer`,
        headers: { cookie: adminCookie },
    });
    record('POST /api/leads/:id/convert-customer duplicate conversion returns 409 Conflict', duplicateConvertRes.statusCode === 409);
    // 10.3 Verify dossier now includes the linked customer details
    const dossierAfterConvertRes = await server.inject({
        method: 'GET',
        url: `/api/leads/${lead1Id}`,
        headers: { cookie: adminCookie },
    });
    const dossierAfterConvertBody = JSON.parse(dossierAfterConvertRes.body);
    record('GET /api/leads/:id dossier includes linked customer after conversion', dossierAfterConvertRes.statusCode === 200 &&
        dossierAfterConvertBody.data?.customer?.id === convertedCustomer.id &&
        dossierAfterConvertBody.data?.customer?.customerNumber === convertedCustomer.customerNumber, `Linked Customer: ${dossierAfterConvertBody.data?.customer?.customerNumber}`);
    // ---------------------------------------------------------
    // 11. LEAD DELETION
    // ---------------------------------------------------------
    console.log('\n--- 11. Testing Lead Deletion ---');
    // 11.1 Create scratch lead to delete
    const scratchRes = await server.inject({
        method: 'POST',
        url: '/api/leads',
        headers: { cookie: adminCookie },
        payload: {
            name: 'Temporary Scratch Lead',
            email: 'temp.scratch@example.nl',
            city: 'Haarlem',
            productType: 'canopy',
        },
    });
    scratchLeadId = JSON.parse(scratchRes.body).data?.id;
    // 11.2 Delete scratch lead
    const deleteRes = await server.inject({
        method: 'DELETE',
        url: `/api/leads/${scratchLeadId}`,
        headers: { cookie: adminCookie },
    });
    record('DELETE /api/leads/:id deletes lead successfully (200 OK)', deleteRes.statusCode === 200);
    // 11.3 Verify lead no longer retrievable
    const verifyDeleteRes = await server.inject({
        method: 'GET',
        url: `/api/leads/${scratchLeadId}`,
        headers: { cookie: adminCookie },
    });
    record('Deleted lead no longer retrievable (404 Not Found)', verifyDeleteRes.statusCode === 404);
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
