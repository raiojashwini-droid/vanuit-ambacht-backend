/**
 * Comprehensive Automated Test Suite for Module 10: Conversations & Project Chat
 *
 * Verifies:
 * - Authentication & RBAC protection (401 unauthenticated, 403 non-participants)
 * - Auto-provisioning of 2-channel separation per project (Customer Channel vs Partner Channel)
 * - Strict isolation: Customer NEVER sees partner channel (403 on read/write)
 * - Strict isolation: Partner NEVER sees customer channel (403 on read/write)
 * - Admin dual-channel access (accesses both customer and partner threads)
 * - Message sending & chronological ordering
 * - Read receipts & unread counters (/unread-count & /:id/read)
 * - File attachments via storage service & documents table
 * - Manual conversation creation (Admin only)
 * - Inbox listing with channelType and unreadOnly filters
 */
import server from '../server.js';
import { db } from '../db/index.js';
import { projects, customers, partners } from '../db/schema.js';
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
    console.log('🧪 RUNNING MODULE 10: CONVERSATIONS & CHAT TEST SUITE');
    console.log('======================================================\n');
    await server.ready();
    // 1. Authenticate users (Admin, Partner, Customer)
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
    // Get user profiles
    const adminMe = adminLoginRes.json().data.user;
    const partnerMe = partnerLoginRes.json().data.user;
    const customerMe = customerLoginRes.json().data.user;
    // Retrieve or create a project linked to the seeded customer and partner
    let [testProject] = await db
        .select({
        id: projects.id,
        name: projects.name,
        projectNumber: projects.projectNumber,
        customerId: projects.customerId,
        partnerId: projects.partnerId,
    })
        .from(projects)
        .limit(1);
    if (!testProject) {
        // Fallback: fetch customer and partner records
        const [cRow] = await db.select().from(customers).where(eq(customers.userId, customerMe.id)).limit(1);
        const [pRow] = await db.select().from(partners).where(eq(partners.userId, partnerMe.id)).limit(1);
        const [createdProj] = await db
            .insert(projects)
            .values({
            projectNumber: `PRJ-TEST-${Date.now().toString().slice(-4)}`,
            name: 'Buitenkeuken Thermo Fraké 240',
            projectType: 'outdoor_kitchen',
            customerId: cRow.id,
            partnerId: pRow.id,
            deliveryAddress: 'Herengracht 101',
            city: 'Amsterdam',
        })
            .returning();
        testProject = createdProj;
    }
    // Ensure testProject has customer and partner pointing to seeded users
    const [cRow] = await db.select().from(customers).where(eq(customers.userId, customerMe.id)).limit(1);
    const [pRow] = await db.select().from(partners).where(eq(partners.userId, partnerMe.id)).limit(1);
    if (cRow && pRow) {
        await db
            .update(projects)
            .set({ customerId: cRow.id, partnerId: pRow.id })
            .where(eq(projects.id, testProject.id));
    }
    // --- SECTION 1: AUTHENTICATION & ACCESS GUARDS ---
    console.log('\n--- 1. Authentication & Access Guards ---');
    const unauthRes = await server.inject({
        method: 'GET',
        url: '/api/conversations',
    });
    record('GET /api/conversations without auth returns 401', unauthRes.statusCode === 401);
    const fakeIdRes = await server.inject({
        method: 'GET',
        url: '/api/conversations/00000000-0000-0000-0000-000000000000',
        headers: { cookie: adminCookie },
    });
    record('GET /api/conversations/:id with non-existent ID returns 404', fakeIdRes.statusCode === 404);
    // --- SECTION 2: AUTO-PROVISIONING & 2-CHANNEL SEPARATION ---
    console.log('\n--- 2. Auto-Provisioning & 2-Channel Separation ---');
    // Admin provisions project channels
    const adminProvisionRes = await server.inject({
        method: 'GET',
        url: `/api/conversations/project/${testProject.id}`,
        headers: { cookie: adminCookie },
    });
    const adminChannels = adminProvisionRes.json().data;
    record('Admin access returns BOTH customerChannel and partnerChannel (200)', adminProvisionRes.statusCode === 200 &&
        adminChannels.customerChannel !== null &&
        adminChannels.partnerChannel !== null &&
        adminChannels.customerChannel.channelType === 'customer' &&
        adminChannels.partnerChannel.channelType === 'partner');
    const customerChannelId = adminChannels.customerChannel.id;
    const partnerChannelId = adminChannels.partnerChannel.id;
    // Customer accesses project channels
    const customerProvisionRes = await server.inject({
        method: 'GET',
        url: `/api/conversations/project/${testProject.id}`,
        headers: { cookie: customerCookie },
    });
    const customerChannels = customerProvisionRes.json().data;
    record('Customer receives customerChannel, partnerChannel is strictly NULL', customerProvisionRes.statusCode === 200 &&
        customerChannels.customerChannel !== null &&
        customerChannels.partnerChannel === null);
    // Partner accesses project channels
    const partnerProvisionRes = await server.inject({
        method: 'GET',
        url: `/api/conversations/project/${testProject.id}`,
        headers: { cookie: partnerCookie },
    });
    const partnerChannels = partnerProvisionRes.json().data;
    record('Partner receives partnerChannel, customerChannel is strictly NULL', partnerProvisionRes.statusCode === 200 &&
        partnerChannels.partnerChannel !== null &&
        partnerChannels.customerChannel === null);
    // --- SECTION 3: STRICT ANTI-LEAKAGE ISOLATION ---
    console.log('\n--- 3. Strict Channel Anti-Leakage Protection ---');
    // Customer tries to view Partner Channel
    const custTriesPartnerRes = await server.inject({
        method: 'GET',
        url: `/api/conversations/${partnerChannelId}`,
        headers: { cookie: customerCookie },
    });
    record('Customer cannot access Partner Channel (403 Forbidden)', custTriesPartnerRes.statusCode === 403);
    // Customer tries to send message to Partner Channel
    const custSendPartnerRes = await server.inject({
        method: 'POST',
        url: `/api/conversations/${partnerChannelId}/messages`,
        headers: { cookie: customerCookie },
        payload: { content: 'Sneaky message into partner channel' },
    });
    record('Customer cannot send message to Partner Channel (403 Forbidden)', custSendPartnerRes.statusCode === 403);
    // Partner tries to view Customer Channel
    const partTriesCustomerRes = await server.inject({
        method: 'GET',
        url: `/api/conversations/${customerChannelId}`,
        headers: { cookie: partnerCookie },
    });
    record('Partner cannot access Customer Channel (403 Forbidden)', partTriesCustomerRes.statusCode === 403);
    // Partner tries to send message to Customer Channel
    const partSendCustomerRes = await server.inject({
        method: 'POST',
        url: `/api/conversations/${customerChannelId}/messages`,
        headers: { cookie: partnerCookie },
        payload: { content: 'Sneaky message into customer channel' },
    });
    record('Partner cannot send message to Customer Channel (403 Forbidden)', partSendCustomerRes.statusCode === 403);
    // --- SECTION 4: MESSAGING FLOW & CHRONOLOGICAL ORDERING ---
    console.log('\n--- 4. Messaging Flow & Chronological Ordering ---');
    // Customer sends message
    const msg1Res = await server.inject({
        method: 'POST',
        url: `/api/conversations/${customerChannelId}/messages`,
        headers: { cookie: customerCookie },
        payload: { content: 'Kan de wasbak 15 cm naar links?' },
    });
    const msg1 = msg1Res.json().data;
    record('Customer sends message in Customer Channel (201)', msg1Res.statusCode === 201 &&
        msg1.content === 'Kan de wasbak 15 cm naar links?' &&
        msg1.senderRole === 'customer');
    // Admin replies to Customer
    const msg2Res = await server.inject({
        method: 'POST',
        url: `/api/conversations/${customerChannelId}/messages`,
        headers: { cookie: adminCookie },
        payload: { content: 'Zeker Sander! Het blad is nog niet gezaagd. Ik pas het aan.' },
    });
    const msg2 = msg2Res.json().data;
    record('Admin sends reply in Customer Channel (201)', msg2Res.statusCode === 201 &&
        msg2.senderRole === 'admin');
    // Partner sends message in Partner Channel
    const msg3Res = await server.inject({
        method: 'POST',
        url: `/api/conversations/${partnerChannelId}/messages`,
        headers: { cookie: partnerCookie },
        payload: { content: 'Blad ligt klaar voor het uitzagen. Wacht op definitieve maat.' },
    });
    const msg3 = msg3Res.json().data;
    record('Partner sends message in Partner Channel (201)', msg3Res.statusCode === 201 &&
        msg3.senderRole === 'partner');
    // Admin replies to Partner
    const msg4Res = await server.inject({
        method: 'POST',
        url: `/api/conversations/${partnerChannelId}/messages`,
        headers: { cookie: adminCookie },
        payload: { content: 'Sven, wasbak 15cm naar links zagen conform klantverzoek.' },
    });
    record('Admin sends reply in Partner Channel (201)', msg4Res.statusCode === 201);
    // Verify chronological ordering of customer channel
    const listCustMsgsRes = await server.inject({
        method: 'GET',
        url: `/api/conversations/${customerChannelId}/messages`,
        headers: { cookie: customerCookie },
    });
    const custMsgs = listCustMsgsRes.json().data;
    record('Customer messages returned in chronological order', listCustMsgsRes.statusCode === 200 &&
        custMsgs.length >= 2 &&
        new Date(custMsgs[0].createdAt).getTime() <= new Date(custMsgs[1].createdAt).getTime());
    // --- SECTION 5: READ RECEIPTS & UNREAD COUNTS ---
    console.log('\n--- 5. Read Receipts & Unread Counters ---');
    // Customer checks unread count (should have unread from Admin reply)
    const custUnreadRes = await server.inject({
        method: 'GET',
        url: '/api/conversations/unread-count',
        headers: { cookie: customerCookie },
    });
    const custUnread = custUnreadRes.json().data;
    record('Customer has unread messages after Admin reply', custUnreadRes.statusCode === 200 && custUnread.totalUnread >= 1);
    // Customer marks conversation as read
    const markReadRes = await server.inject({
        method: 'PATCH',
        url: `/api/conversations/${customerChannelId}/read`,
        headers: { cookie: customerCookie },
    });
    record('PATCH /api/conversations/:id/read marks channel read (200)', markReadRes.statusCode === 200);
    // Verify unread count is reset to 0
    const custUnreadAfterRes = await server.inject({
        method: 'GET',
        url: '/api/conversations/unread-count',
        headers: { cookie: customerCookie },
    });
    record('Customer unread count becomes 0 after marking read', custUnreadAfterRes.json().data.totalUnread === 0);
    // --- SECTION 6: FILE ATTACHMENTS ---
    console.log('\n--- 6. File Attachments ---');
    const attachRes = await server.inject({
        method: 'POST',
        url: `/api/conversations/${partnerChannelId}/attachment`,
        headers: { cookie: partnerCookie },
        payload: {
            content: 'Hierbij de foto van de uitsparing markering',
            fileName: 'werkblad_aftekening.jpg',
            fileData: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP...',
            mimeType: 'image/jpeg',
        },
    });
    const attachData = attachRes.json().data;
    record('POST /api/conversations/:id/attachment creates message with document (201)', attachRes.statusCode === 201 &&
        attachData.attachment !== null &&
        attachData.attachment.fileName.includes('werkblad_aftekening') &&
        attachData.attachment.mimeType === 'image/jpeg');
    // --- SECTION 7: INBOX LISTING & FILTERING ---
    console.log('\n--- 7. Inbox Listing & Filters ---');
    // Admin lists all conversations
    const adminListRes = await server.inject({
        method: 'GET',
        url: '/api/conversations',
        headers: { cookie: adminCookie },
    });
    const adminConvs = adminListRes.json().data;
    record('Admin lists all conversations with last message and counterparty (200)', adminListRes.statusCode === 200 &&
        Array.isArray(adminConvs) &&
        adminConvs.length >= 2 &&
        adminConvs.some((c) => c.lastMessage !== null));
    // Filter by channelType
    const filterCustRes = await server.inject({
        method: 'GET',
        url: '/api/conversations?channelType=customer',
        headers: { cookie: adminCookie },
    });
    record('Filter by channelType=customer returns only customer channels', filterCustRes.statusCode === 200 &&
        filterCustRes.json().data.every((c) => c.channelType === 'customer'));
    const filterPartRes = await server.inject({
        method: 'GET',
        url: '/api/conversations?channelType=partner',
        headers: { cookie: adminCookie },
    });
    record('Filter by channelType=partner returns only partner channels', filterPartRes.statusCode === 200 &&
        filterPartRes.json().data.every((c) => c.channelType === 'partner'));
    // Customer lists conversations (only sees customer channel)
    const custListRes = await server.inject({
        method: 'GET',
        url: '/api/conversations',
        headers: { cookie: customerCookie },
    });
    const custConvs = custListRes.json().data;
    record('Customer only sees conversations they participate in', custListRes.statusCode === 200 &&
        custConvs.every((c) => c.channelType === 'customer'));
    // --- SECTION 8: MANUAL CONVERSATION CREATION (ADMIN ONLY) ---
    console.log('\n--- 8. Manual Conversation Creation ---');
    const manualCreateRes = await server.inject({
        method: 'POST',
        url: '/api/conversations',
        headers: { cookie: adminCookie },
        payload: {
            projectId: testProject.id,
            title: 'Internal Admin Discussion Thread',
            channelType: 'internal',
        },
    });
    const manualConv = manualCreateRes.json().data;
    record('Admin creates manual conversation thread (201)', manualCreateRes.statusCode === 201 &&
        manualConv.conversationNumber.startsWith('CNV-'));
    // Non-admin attempting to create conversation
    const nonAdminCreateRes = await server.inject({
        method: 'POST',
        url: '/api/conversations',
        headers: { cookie: customerCookie },
        payload: {
            projectId: testProject.id,
            title: 'Hacked conversation',
            channelType: 'customer',
        },
    });
    record('Non-admin cannot create conversation manually (403 Forbidden)', nonAdminCreateRes.statusCode === 403);
    // --- SUMMARY ---
    console.log('\n======================================================');
    const allPassed = results.every((r) => r.passed);
    const passedCount = results.filter((r) => r.passed).length;
    console.log(`TOTAL TESTS: ${results.length}`);
    console.log(`PASSED: ${passedCount}`);
    console.log(`FAILED: ${results.length - passedCount}`);
    if (allPassed) {
        console.log('🎉 ALL MODULE 10 TESTS PASSED (100% SUCCESS)');
        console.log('======================================================\n');
        process.exit(0);
    }
    else {
        console.error('❌ SOME TESTS FAILED');
        console.log('======================================================\n');
        process.exit(1);
    }
}
runTests().catch((err) => {
    console.error('Fatal test error:', err);
    process.exit(1);
});
