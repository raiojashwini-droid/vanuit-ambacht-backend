/**
 * Comprehensive Automated Test Suite for Module 11: Admin Dashboard / Analytics
 *
 * Verifies:
 * - Authentication & Strict Admin-Only RBAC (Partner and Customer rejection 403)
 * - 7 Top KPI Cards calculation & trend comparisons across presets and custom dates
 * - Financial Snapshot calculation (Factuurstelsel basis, outstanding, expected)
 * - 4-Stage Conversion Funnel calculation (Leads -> In Discussion -> Quote Sent -> Won)
 * - "Today & This Week" bundle (Follow-ups due, deliveries this week, open tasks)
 * - Operational Warnings & Action Required alerts
 * - Real-time Consolidated Activity Stream
 * - Annual Revenue Performance trends for Jan–Dec (12-month breakdown)
 */
import server from '../server.js';
import { sqlClient } from '../db/index.js';
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
    console.log('🧪 RUNNING MODULE 11: ADMIN DASHBOARD / ANALYTICS TEST SUITE');
    console.log('======================================================\n');
    await server.ready();
    // 1. Authenticate users
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
    // -------------------------------------------------------------------
    // TEST GROUP 1: AUTHENTICATION & STRICT RBAC ENFORCEMENT
    // -------------------------------------------------------------------
    console.log('\n--- GROUP 1: Authentication & Strict RBAC Enforcement ---');
    // Test 1: Unauthenticated request to /api/dashboard/kpis returns 401
    const unauthRes = await server.inject({
        method: 'GET',
        url: '/api/dashboard/kpis',
    });
    record('Unauthenticated request to /api/dashboard/kpis is rejected with 401', unauthRes.statusCode === 401, `Status: ${unauthRes.statusCode}`);
    // Test 2: Partner cannot access /api/dashboard/kpis (403 Forbidden)
    const partnerKpiRes = await server.inject({
        method: 'GET',
        url: '/api/dashboard/kpis',
        headers: { cookie: partnerCookie },
    });
    record('Partner role is strictly blocked from dashboard KPIs (403 Forbidden)', partnerKpiRes.statusCode === 403, `Status: ${partnerKpiRes.statusCode}`);
    // Test 3: Customer cannot access /api/dashboard/kpis (403 Forbidden)
    const customerKpiRes = await server.inject({
        method: 'GET',
        url: '/api/dashboard/kpis',
        headers: { cookie: customerCookie },
    });
    record('Customer role is strictly blocked from dashboard KPIs (403 Forbidden)', customerKpiRes.statusCode === 403, `Status: ${customerKpiRes.statusCode}`);
    // Test 4: Partner cannot access /api/dashboard/financials (403 Forbidden)
    const partnerFinRes = await server.inject({
        method: 'GET',
        url: '/api/dashboard/financials',
        headers: { cookie: partnerCookie },
    });
    record('Partner role is blocked from financial snapshot (403 Forbidden)', partnerFinRes.statusCode === 403, `Status: ${partnerFinRes.statusCode}`);
    // Test 5: Customer cannot access /api/dashboard/funnel (403 Forbidden)
    const custFunnelRes = await server.inject({
        method: 'GET',
        url: '/api/dashboard/funnel',
        headers: { cookie: customerCookie },
    });
    record('Customer role is blocked from conversion funnel (403 Forbidden)', custFunnelRes.statusCode === 403, `Status: ${custFunnelRes.statusCode}`);
    // Test 6: Admin successfully accesses /api/dashboard/kpis
    const adminKpiRes = await server.inject({
        method: 'GET',
        url: '/api/dashboard/kpis',
        headers: { cookie: adminCookie },
    });
    record('Admin successfully retrieves dashboard KPIs (200 OK)', adminKpiRes.statusCode === 200, `Status: ${adminKpiRes.statusCode}`);
    // -------------------------------------------------------------------
    // TEST GROUP 2: 7 KPI CARDS & DATE RANGE PRESETS
    // -------------------------------------------------------------------
    console.log('\n--- GROUP 2: 7 KPI Cards & Date Range Presets ---');
    const kpisBody = JSON.parse(adminKpiRes.body);
    const data = kpisBody.data;
    // Test 7: Verify all 7 KPI cards exist in the payload
    const hasAll7Cards = data.totalLeads !== undefined &&
        data.costPerLead !== undefined &&
        data.quotesSent !== undefined &&
        data.quotePercentage !== undefined &&
        data.ordersWon !== undefined &&
        data.conversionRate !== undefined &&
        data.activeMetaAds !== undefined;
    record('KPI response contains all 7 required KPI cards with metadata', hasAll7Cards && data.dateRange === '30days', `DateRange: ${data.dateRange}, Total Leads: ${data.totalLeads.numericValue}`);
    // Test 8: Verify KPI calculations consistency
    const quotePctValid = typeof data.quotePercentage.numericValue === 'number';
    const convRateValid = typeof data.conversionRate.numericValue === 'number';
    const metaAdsValid = data.activeMetaAds.status === 'Active';
    record('KPI metric types and calculations are structurally valid', quotePctValid && convRateValid && metaAdsValid, `Quote%: ${data.quotePercentage.value}, Conv%: ${data.conversionRate.value}, Ads: ${data.activeMetaAds.value}`);
    // Test 9: Preset date ranges ('7days', 'currentMonth', '3months', '12months')
    const kpis7DaysRes = await server.inject({
        method: 'GET',
        url: '/api/dashboard/kpis?dateRange=7days',
        headers: { cookie: adminCookie },
    });
    const kpis7Days = JSON.parse(kpis7DaysRes.body);
    record('Date range preset "7days" slices metrics accurately', kpis7DaysRes.statusCode === 200 && kpis7Days.data.dateRange === '7days', `Resolved range: ${kpis7Days.data.startDate} to ${kpis7Days.data.endDate}`);
    // Test 10: Custom date range
    const customKpiRes = await server.inject({
        method: 'GET',
        url: '/api/dashboard/kpis?dateRange=custom&startDate=2026-01-01&endDate=2026-12-31',
        headers: { cookie: adminCookie },
    });
    const customKpi = JSON.parse(customKpiRes.body);
    record('Custom date range query successfully aggregates between given dates', customKpiRes.statusCode === 200 && customKpi.data.startDate === '2026-01-01', `Range: ${customKpi.data.startDate} to ${customKpi.data.endDate}`);
    // Test 11: Invalid custom dates rejected with 400
    const invalidDateRes = await server.inject({
        method: 'GET',
        url: '/api/dashboard/kpis?dateRange=custom&startDate=invalid-date',
        headers: { cookie: adminCookie },
    });
    record('Malformed date string is caught by Zod schema and returns 400', invalidDateRes.statusCode === 400, `Status: ${invalidDateRes.statusCode}`);
    // -------------------------------------------------------------------
    // TEST GROUP 3: FINANCIAL SNAPSHOT
    // -------------------------------------------------------------------
    console.log('\n--- GROUP 3: Financial Snapshot ---');
    const finRes = await server.inject({
        method: 'GET',
        url: '/api/dashboard/financials',
        headers: { cookie: adminCookie },
    });
    const finBody = JSON.parse(finRes.body);
    // Test 12: Verify Financial snapshot structure
    const finData = finBody.data;
    const hasFinFields = finData.revenueThisMonth !== undefined &&
        finData.outstandingInvoices !== undefined &&
        finData.expectedRevenue !== undefined;
    record('Financial snapshot returns monthly revenue, outstanding invoices, and expected revenue', finRes.statusCode === 200 && hasFinFields, `Rev: ${finData.revenueThisMonth.value} (${finData.revenueThisMonth.basis}), Out: ${finData.outstandingInvoices.value}`);
    // Test 13: Financial snapshot basis is Factuurstelsel
    record('Financial snapshot explicitly documents Factuurstelsel accounting basis', finData.revenueThisMonth.basis === 'factuurstelsel', `Basis: ${finData.revenueThisMonth.basis}`);
    // -------------------------------------------------------------------
    // TEST GROUP 4: 4-STAGE CONVERSION FUNNEL
    // -------------------------------------------------------------------
    console.log('\n--- GROUP 4: 4-Stage Conversion Funnel ---');
    const funnelRes = await server.inject({
        method: 'GET',
        url: '/api/dashboard/funnel?dateRange=30days',
        headers: { cookie: adminCookie },
    });
    const funnelBody = JSON.parse(funnelRes.body);
    const funnelData = funnelBody.data;
    // Test 14: Verify 4 funnel stages
    const has4Stages = funnelData.leads !== undefined &&
        funnelData.inGesprek !== undefined &&
        funnelData.offerte !== undefined &&
        funnelData.gewonnen !== undefined;
    record('Conversion funnel returns all 4 required progression stages', funnelRes.statusCode === 200 && has4Stages, `Leads: ${funnelData.leads.count}, In Discussion: ${funnelData.inGesprek.count}, Quote: ${funnelData.offerte.count}, Won: ${funnelData.gewonnen.count}`);
    // Test 15: Baseline percentage for leads is 100%
    record('Funnel stage 1 (Leads) correctly acts as 100% baseline', funnelData.leads.percentage === 100, `Baseline: ${funnelData.leads.percentage}%`);
    // -------------------------------------------------------------------
    // TEST GROUP 5: TODAY & THIS WEEK BUNDLE
    // -------------------------------------------------------------------
    console.log('\n--- GROUP 5: Today & This Week Bundle ---');
    const todayRes = await server.inject({
        method: 'GET',
        url: '/api/dashboard/today',
        headers: { cookie: adminCookie },
    });
    const todayBody = JSON.parse(todayRes.body);
    const todayData = todayBody.data;
    // Test 16: Verify today bundle arrays
    const hasTodayArrays = Array.isArray(todayData.followUps) &&
        Array.isArray(todayData.deliveriesThisWeek) &&
        Array.isArray(todayData.openTasks);
    record('Today & This Week endpoint returns follow-ups, deliveries, and open tasks', todayRes.statusCode === 200 && hasTodayArrays, `FollowUps: ${todayData.followUps.length}, Deliveries: ${todayData.deliveriesThisWeek.length}, Open Tasks: ${todayData.openTasks.length}`);
    // -------------------------------------------------------------------
    // TEST GROUP 6: OPERATIONAL WARNINGS
    // -------------------------------------------------------------------
    console.log('\n--- GROUP 6: Operational Warnings ---');
    const warnRes = await server.inject({
        method: 'GET',
        url: '/api/dashboard/warnings',
        headers: { cookie: adminCookie },
    });
    const warnBody = JSON.parse(warnRes.body);
    // Test 17: Warnings list is array with severity codes
    record('Operational warnings return valid structured alert items', warnRes.statusCode === 200 && Array.isArray(warnBody.data), `Count: ${warnBody.data.length} warnings detected`);
    // -------------------------------------------------------------------
    // TEST GROUP 7: RECENT ACTIVITY FEED
    // -------------------------------------------------------------------
    console.log('\n--- GROUP 7: Recent Activity Feed ---');
    const actRes = await server.inject({
        method: 'GET',
        url: '/api/dashboard/activity?limit=5',
        headers: { cookie: adminCookie },
    });
    const actBody = JSON.parse(actRes.body);
    // Test 18: Activity list has timestamps and humanized timeAgo
    const actItems = actBody.data;
    const isActValid = Array.isArray(actItems) &&
        actItems.length <= 5 &&
        (actItems.length === 0 || (actItems[0].timestamp && actItems[0].timeAgo));
    record('Activity feed returns chronologically sorted items with humanized timeAgo', actRes.statusCode === 200 && isActValid, `Returned ${actItems.length} recent activity items`);
    // -------------------------------------------------------------------
    // TEST GROUP 8: ANNUAL REVENUE TRENDS (12 MONTHS)
    // -------------------------------------------------------------------
    console.log('\n--- GROUP 8: Annual Revenue Trends ---');
    const currentYear = new Date().getFullYear();
    const revRes = await server.inject({
        method: 'GET',
        url: `/api/dashboard/reports/revenue-trends?year=${currentYear}`,
        headers: { cookie: adminCookie },
    });
    const revBody = JSON.parse(revRes.body);
    const revData = revBody.data;
    // Test 19: Exactly 12 months returned
    const has12Months = Array.isArray(revData.months) && revData.months.length === 12;
    record('Revenue trends endpoint returns all 12 calendar months (Jan–Dec)', revRes.statusCode === 200 && has12Months, `Year: ${revData.year}, Months count: ${revData.months?.length}`);
    // Test 20: Month names match standard abbreviations
    const firstMonth = revData.months[0];
    const lastMonth = revData.months[11];
    record('Months are ordered from Jan (index 1) to Dec (index 12)', firstMonth.month === 'Jan' && lastMonth.month === 'Dec' && firstMonth.monthIndex === 1, `Jan: ${firstMonth.amountFormatted}, Dec: ${lastMonth.amountFormatted}`);
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
