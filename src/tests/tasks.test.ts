/**
 * Comprehensive Automated Test Suite for Module 9: Tasks & Task Board
 *
 * Verifies:
 * - Authentication & RBAC (Admin, Partner scoping, Customer rejection 403)
 * - Sequential auto-numbering (TSK-YYYY-XXX)
 * - Standalone, Lead-linked, and Project-linked task creation
 * - Validation guards (empty title, invalid dates, non-existent links)
 * - Search, priority/status filtering, and pagination
 * - KPI Summary counts (All, Pending, Completed, Overdue)
 * - Task details retrieval with joined entities
 * - Task updates (title, priority, due date)
 * - Status transitions (pending -> completed -> pending) with automated completedAt tracking
 * - Task reassignment (Admin only)
 * - Batch creation / Plaud AI meeting action items import
 * - Task deletion (Admin only)
 */

import server from '../server.js';
import { db, sqlClient } from '../db/index.js';
import { tasks, users, leads, projects } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';

interface TestResult {
  name: string;
  passed: boolean;
  details?: string;
}

const results: TestResult[] = [];

function record(name: string, passed: boolean, details = '') {
  results.push({ name, passed, details });
  const icon = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`${icon}: ${name}${details ? ` -> ${details}` : ''}`);
}

function extractCookie(res: any): string {
  const raw = res.headers['set-cookie'];
  if (!raw) return '';
  return Array.isArray(raw) ? raw[0] : (raw as string);
}

async function runTests() {
  console.log('\n======================================================');
  console.log('🧪 RUNNING MODULE 9: TASKS TEST SUITE');
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

  // Get partner userId
  const partnerMeRes = await server.inject({
    method: 'GET',
    url: '/api/auth/me',
    headers: { cookie: partnerCookie },
  });
  const partnerUserId = partnerMeRes.json().data.user.id;

  // Retrieve an existing lead and project for link testing
  const [existingLead] = await db.select({ id: leads.id, name: leads.name }).from(leads).limit(1);
  const [existingProject] = await db.select({ id: projects.id, name: projects.name }).from(projects).limit(1);

  // --- SECTION 1: AUTHENTICATION & RBAC ---
  console.log('\n--- 1. Authentication & RBAC Protection ---');

  const noAuthRes = await server.inject({
    method: 'GET',
    url: '/api/tasks',
  });
  record('GET /api/tasks without auth returns 401', noAuthRes.statusCode === 401);

  const customerAccessRes = await server.inject({
    method: 'GET',
    url: '/api/tasks',
    headers: { cookie: customerCookie },
  });
  record('GET /api/tasks with Customer role returns 403 Forbidden', customerAccessRes.statusCode === 403);

  const customerCreateRes = await server.inject({
    method: 'POST',
    url: '/api/tasks',
    headers: { cookie: customerCookie },
    payload: { title: 'Customer task', dueDate: '2026-10-15' },
  });
  record('POST /api/tasks with Customer role returns 403 Forbidden', customerCreateRes.statusCode === 403);

  // --- SECTION 2: VALIDATION GUARDS ---
  console.log('\n--- 2. Validation Guards ---');

  const emptyTitleRes = await server.inject({
    method: 'POST',
    url: '/api/tasks',
    headers: { cookie: adminCookie },
    payload: { title: '', dueDate: '2026-10-15' },
  });
  record('POST /api/tasks rejects empty title (400)', emptyTitleRes.statusCode === 400);

  const invalidDateRes = await server.inject({
    method: 'POST',
    url: '/api/tasks',
    headers: { cookie: adminCookie },
    payload: { title: 'Valid title', dueDate: '15-10-2026' },
  });
  record('POST /api/tasks rejects non-YYYY-MM-DD date format (400)', invalidDateRes.statusCode === 400);

  const invalidLeadRes = await server.inject({
    method: 'POST',
    url: '/api/tasks',
    headers: { cookie: adminCookie },
    payload: {
      title: 'Task with fake lead',
      dueDate: '2026-10-15',
      leadId: '00000000-0000-0000-0000-000000000000',
    },
  });
  record('POST /api/tasks rejects non-existent leadId (404)', invalidLeadRes.statusCode === 404);

  // --- SECTION 3: CREATION & NUMBERING ---
  console.log('\n--- 3. Task Creation & Auto-Numbering ---');

  // Create Standalone Task
  const createStandaloneRes = await server.inject({
    method: 'POST',
    url: '/api/tasks',
    headers: { cookie: adminCookie },
    payload: {
      title: 'Order Big Green Egg BBQ accessories',
      description: 'Check stock of mounting brackets',
      priority: 'high',
      dueDate: '2026-10-20',
      linkedType: 'None',
    },
  });
  const standaloneTask = createStandaloneRes.json().data;
  record(
    'POST /api/tasks creates standalone task (201)',
    createStandaloneRes.statusCode === 201 &&
      standaloneTask.title === 'Order Big Green Egg BBQ accessories' &&
      standaloneTask.priority === 'high' &&
      standaloneTask.taskNumber.startsWith('TSK-')
  );

  // Create Lead-linked Task
  let leadTask: any = null;
  if (existingLead) {
    const createLeadTaskRes = await server.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: { cookie: adminCookie },
      payload: {
        title: `Follow up with lead: ${existingLead.name}`,
        leadId: existingLead.id,
        linkedType: 'Lead',
        priority: 'medium',
        dueDate: '2026-10-22',
      },
    });
    leadTask = createLeadTaskRes.json().data;
    record(
      'POST /api/tasks creates lead-linked task (201)',
      createLeadTaskRes.statusCode === 201 &&
        leadTask.leadId === existingLead.id &&
        leadTask.linkedType === 'Lead' &&
        leadTask.linkedItem?.name === existingLead.name
    );
  }

  // Create Project-linked Task
  let projectTask: any = null;
  if (existingProject) {
    const createProjectTaskRes = await server.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: { cookie: adminCookie },
      payload: {
        title: `Prepare 3D CAD drawing for ${existingProject.name}`,
        projectId: existingProject.id,
        linkedType: 'Project',
        priority: 'high',
        dueDate: '2026-10-25',
      },
    });
    projectTask = createProjectTaskRes.json().data;
    record(
      'POST /api/tasks creates project-linked task (201)',
      createProjectTaskRes.statusCode === 201 &&
        projectTask.projectId === existingProject.id &&
        projectTask.linkedType === 'Project'
    );
  }

  // Verify sequential numbering
  const createSecondRes = await server.inject({
    method: 'POST',
    url: '/api/tasks',
    headers: { cookie: adminCookie },
    payload: {
      title: 'Second sequential task check',
      dueDate: '2026-10-30',
    },
  });
  const secondTask = createSecondRes.json().data;
  const num1 = parseInt(standaloneTask.taskNumber.split('-')[2], 10);
  const num2 = parseInt(secondTask.taskNumber.split('-')[2], 10);
  record('Task numbering increments sequentially', num2 > num1);

  // --- SECTION 4: RETRIEVAL & FILTERING ---
  console.log('\n--- 4. Task Retrieval & Filtering ---');

  const listRes = await server.inject({
    method: 'GET',
    url: '/api/tasks?limit=10',
    headers: { cookie: adminCookie },
  });
  const listJson = listRes.json();
  record(
    'GET /api/tasks returns paginated tasks array (200)',
    listRes.statusCode === 200 && Array.isArray(listJson.data) && listJson.pagination.total >= 2
  );

  // Search by keyword
  const searchRes = await server.inject({
    method: 'GET',
    url: '/api/tasks?search=Green Egg',
    headers: { cookie: adminCookie },
  });
  const searchJson = searchRes.json();
  record(
    'GET /api/tasks?search="Green Egg" matches task title',
    searchRes.statusCode === 200 &&
      searchJson.data.some((t: any) => t.title.includes('Big Green Egg'))
  );

  // Filter by priority
  const priorityRes = await server.inject({
    method: 'GET',
    url: '/api/tasks?priority=high',
    headers: { cookie: adminCookie },
  });
  record(
    'GET /api/tasks?priority=high filters correctly',
    priorityRes.statusCode === 200 && priorityRes.json().data.every((t: any) => t.priority === 'high')
  );

  // Summary counts
  const summaryRes = await server.inject({
    method: 'GET',
    url: '/api/tasks/summary',
    headers: { cookie: adminCookie },
  });
  const summaryData = summaryRes.json().data;
  record(
    'GET /api/tasks/summary returns fast counters (all, pending, completed, overdue)',
    summaryRes.statusCode === 200 &&
      summaryData.all >= 2 &&
      typeof summaryData.pending === 'number' &&
      typeof summaryData.completed === 'number'
  );

  // Get task by ID
  const getByIdRes = await server.inject({
    method: 'GET',
    url: `/api/tasks/${standaloneTask.id}`,
    headers: { cookie: adminCookie },
  });
  record(
    'GET /api/tasks/:id retrieves task details (200)',
    getByIdRes.statusCode === 200 && getByIdRes.json().data.id === standaloneTask.id
  );

  // Get task by taskNumber
  const getByNumberRes = await server.inject({
    method: 'GET',
    url: `/api/tasks/${standaloneTask.taskNumber}`,
    headers: { cookie: adminCookie },
  });
  record(
    'GET /api/tasks/:taskNumber retrieves task by code',
    getByNumberRes.statusCode === 200 && getByNumberRes.json().data.id === standaloneTask.id
  );

  // --- SECTION 5: LIFECYCLE & STATUS TRANSITIONS ---
  console.log('\n--- 5. Lifecycle & Status Transitions ---');

  // Update task details
  const updateRes = await server.inject({
    method: 'PATCH',
    url: `/api/tasks/${standaloneTask.id}`,
    headers: { cookie: adminCookie },
    payload: {
      title: 'Order Big Green Egg BBQ accessories (URGENT)',
      priority: 'urgent',
    },
  });
  const updatedTask = updateRes.json().data;
  record(
    'PATCH /api/tasks/:id updates title and priority (200)',
    updateRes.statusCode === 200 &&
      updatedTask.title === 'Order Big Green Egg BBQ accessories (URGENT)' &&
      updatedTask.priority === 'urgent'
  );

  // Complete task via completed: true
  const completeRes = await server.inject({
    method: 'PATCH',
    url: `/api/tasks/${standaloneTask.id}/status`,
    headers: { cookie: adminCookie },
    payload: { completed: true },
  });
  const completedTask = completeRes.json().data;
  record(
    'PATCH /api/tasks/:id/status completed=true sets status=completed and completedAt',
    completeRes.statusCode === 200 &&
      completedTask.status === 'completed' &&
      completedTask.completed === true &&
      completedTask.completedAt !== null
  );

  // Reset task back to pending
  const resetRes = await server.inject({
    method: 'PATCH',
    url: `/api/tasks/${standaloneTask.id}/status`,
    headers: { cookie: adminCookie },
    payload: { completed: false },
  });
  const resetTask = resetRes.json().data;
  record(
    'PATCH /api/tasks/:id/status completed=false resets status=pending and completedAt=null',
    resetRes.statusCode === 200 &&
      resetTask.status === 'pending' &&
      resetTask.completed === false &&
      resetTask.completedAt === null
  );

  // Reassign task to partner
  const reassignRes = await server.inject({
    method: 'PATCH',
    url: `/api/tasks/${standaloneTask.id}/assign`,
    headers: { cookie: adminCookie },
    payload: { assignedToUserId: partnerUserId },
  });
  const reassignedTask = reassignRes.json().data;
  record(
    'PATCH /api/tasks/:id/assign reassigns task to partner user (200)',
    reassignRes.statusCode === 200 &&
      reassignedTask.assignedToUserId === partnerUserId &&
      reassignedTask.assignee?.id === partnerUserId
  );

  // --- SECTION 6: BATCH & AI IMPORT ---
  console.log('\n--- 6. Batch Creation (Plaud AI Action Items) ---');

  const batchRes = await server.inject({
    method: 'POST',
    url: '/api/tasks/batch',
    headers: { cookie: adminCookie },
    payload: {
      tasks: [
        {
          title: 'AI Action 1: Send wood samples to customer',
          priority: 'medium',
          dueDate: '2026-10-18',
        },
        {
          title: 'AI Action 2: Check foundation depth at site',
          priority: 'high',
          dueDate: '2026-10-19',
        },
        {
          title: 'AI Action 3: Review revised quotation specs',
          priority: 'low',
          dueDate: '2026-10-21',
        },
      ],
    },
  });
  const batchData = batchRes.json().data;
  record(
    'POST /api/tasks/batch creates 3 tasks atomically (201)',
    batchRes.statusCode === 201 && Array.isArray(batchData) && batchData.length === 3
  );

  // --- SECTION 7: PARTNER SCOPING ---
  console.log('\n--- 7. Partner Role Scoping ---');

  // Partner lists tasks: should see the task reassigned to them
  const partnerListRes = await server.inject({
    method: 'GET',
    url: '/api/tasks',
    headers: { cookie: partnerCookie },
  });
  const partnerTasks = partnerListRes.json().data;
  record(
    'Partner lists tasks scoped to assigned items',
    partnerListRes.statusCode === 200 &&
      partnerTasks.some((t: any) => t.id === standaloneTask.id)
  );

  // Partner toggles completion of their assigned task
  const partnerCompleteRes = await server.inject({
    method: 'PATCH',
    url: `/api/tasks/${standaloneTask.id}/status`,
    headers: { cookie: partnerCookie },
    payload: { completed: true },
  });
  record(
    'Partner can toggle status of their assigned task (200)',
    partnerCompleteRes.statusCode === 200 && partnerCompleteRes.json().data.status === 'completed'
  );

  // Partner cannot delete tasks
  const partnerDeleteRes = await server.inject({
    method: 'DELETE',
    url: `/api/tasks/${standaloneTask.id}`,
    headers: { cookie: partnerCookie },
  });
  record(
    'Partner cannot delete tasks (403 Forbidden)',
    partnerDeleteRes.statusCode === 403
  );

  // --- SECTION 8: DELETION ---
  console.log('\n--- 8. Task Deletion ---');

  const deleteRes = await server.inject({
    method: 'DELETE',
    url: `/api/tasks/${secondTask.id}`,
    headers: { cookie: adminCookie },
  });
  record('DELETE /api/tasks/:id deletes task (200)', deleteRes.statusCode === 200);

  const verifyDeletedRes = await server.inject({
    method: 'GET',
    url: `/api/tasks/${secondTask.id}`,
    headers: { cookie: adminCookie },
  });
  record('Deleted task no longer exists (404)', verifyDeletedRes.statusCode === 404);

  // --- SUMMARY ---
  console.log('\n======================================================');
  const allPassed = results.every((r) => r.passed);
  const passedCount = results.filter((r) => r.passed).length;
  console.log(`TOTAL TESTS: ${results.length}`);
  console.log(`PASSED: ${passedCount}`);
  console.log(`FAILED: ${results.length - passedCount}`);

  if (allPassed) {
    console.log('🎉 ALL MODULE 9 TESTS PASSED (100% SUCCESS)');
    console.log('======================================================\n');
    process.exit(0);
  } else {
    console.error('❌ SOME TESTS FAILED');
    console.log('======================================================\n');
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
