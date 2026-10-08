/**
 * Comprehensive Automated Test Suite for Module 13:
 * Documents Vault, Project Photos & File Storage Engine
 */

import server from '../server.js';
import { db } from '../db/index.js';
import { projects, customers, partners, users, documents, projectPhotos } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import fs from 'node:fs';

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
  console.log('🧪 RUNNING MODULE 13: DOCUMENTS VAULT & PHOTOS TEST SUITE');
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

  record('Auth: Logged in admin, partner, and customer', Boolean(adminCookie && partnerCookie && customerCookie));

  // Retrieve test project, customer, partner records
  const [testProject] = await db.select().from(projects).limit(1);
  const [testCustomerUser] = await db.select().from(users).where(eq(users.role, 'customer')).limit(1);
  const [testCustomer] = await db.select().from(customers).where(eq(customers.userId, testCustomerUser.id)).limit(1);
  const [testPartnerUser] = await db.select().from(users).where(eq(users.role, 'partner')).limit(1);
  const [testPartner] = await db.select().from(partners).where(eq(partners.userId, testPartnerUser.id)).limit(1);

  // Ensure project is linked to testCustomer and testPartner for scoping tests
  await db
    .update(projects)
    .set({ customerId: testCustomer.id, partnerId: testPartner.id })
    .where(eq(projects.id, testProject.id));

  // ==========================================
  // SECTION 1: AUTHENTICATION & RBAC CHECKS
  // ==========================================
  console.log('\n--- 1. Authentication & RBAC Checks ---');

  const unauthDocs = await server.inject({
    method: 'GET',
    url: '/api/documents',
  });
  record('GET /api/documents returns 401 when unauthenticated', unauthDocs.statusCode === 401);

  const unauthPhotos = await server.inject({
    method: 'GET',
    url: '/api/photos',
  });
  record('GET /api/photos returns 401 when unauthenticated', unauthPhotos.statusCode === 401);

  const custGlobalPhotos = await server.inject({
    method: 'GET',
    url: '/api/photos',
    headers: { cookie: customerCookie },
  });
  record('GET /api/photos rejects customer access with 403', custGlobalPhotos.statusCode === 403);

  // ==========================================
  // SECTION 2: DOCUMENT VAULT & XOR CONSTRAINT
  // ==========================================
  console.log('\n--- 2. Document Vault & XOR Constraint ---');

  // Test company-wide document upload with ZERO target foreign keys (verifying <= 1 check)
  const generalDocRes = await server.inject({
    method: 'POST',
    url: '/api/documents',
    headers: { cookie: adminCookie },
    payload: {
      fileName: 'Algemene_Voorwaarden_2026.pdf',
      fileData: 'data:application/pdf;base64,JVBERi0xLjQKJVRlc3QgZG9jCg==',
      mimeType: 'application/pdf',
      category: 'Contracts',
      documentType: 'cad_blueprint',
      description: 'Algemene bedrijfsvoorwaarden voor maatwerk buitenkeukens',
      isPublicForCustomer: true,
      isPublicForPartner: true,
    },
  });
  const generalDoc = generalDocRes.json()?.data;
  record(
    'POST /api/documents creates company-level document with 0 target FKs (XOR <= 1 check)',
    generalDocRes.statusCode === 201 && generalDoc?.category === 'Contracts' && !generalDoc?.projectId
  );

  // Test multiple targets rejection (> 1 target FK)
  const multiTargetRes = await server.inject({
    method: 'POST',
    url: '/api/documents',
    headers: { cookie: adminCookie },
    payload: {
      fileName: 'Conflict_Doc.pdf',
      fileData: 'data:application/pdf;base64,JVBERi0xLjQK',
      projectId: testProject.id,
      partnerId: testPartner.id, // violates XOR check
    },
  });
  record('POST /api/documents rejects multiple target foreign keys (400 MULTIPLE_TARGETS)', multiTargetRes.statusCode === 400);

  // Test project-linked document upload
  const projectDocRes = await server.inject({
    method: 'POST',
    url: '/api/documents',
    headers: { cookie: adminCookie },
    payload: {
      fileName: 'BLU-P2001-CAD-SPEC.pdf',
      fileData: 'data:application/pdf;base64,JVBERi0xLjQKJVRlc3QgYmx1ZXByaW50Cg==',
      mimeType: 'application/pdf',
      category: 'Designs',
      documentType: 'cad_blueprint',
      description: 'AutoCAD technische werktekening',
      projectId: testProject.id,
      isPublicForCustomer: true,
      isPublicForPartner: true,
    },
  });
  const projectDoc = projectDocRes.json()?.data;
  record(
    'POST /api/documents creates project-linked document',
    projectDocRes.statusCode === 201 && projectDoc?.projectId === testProject.id
  );

  // Test private document (internal only, not visible to customer)
  const privateDocRes = await server.inject({
    method: 'POST',
    url: '/api/documents',
    headers: { cookie: adminCookie },
    payload: {
      fileName: 'Internal_Cost_Calculation.xlsx',
      fileData: 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,UEsDBBQAAAAIAAA=',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      category: 'Finance',
      documentType: 'cad_blueprint',
      description: 'Interne marge en inkoopkosten calculatie',
      projectId: testProject.id,
      isPublicForCustomer: false,
      isPublicForPartner: false,
    },
  });
  const privateDoc = privateDocRes.json()?.data;
  record('POST /api/documents creates internal document (isPublicForCustomer = false)', privateDocRes.statusCode === 201);

  // ==========================================
  // SECTION 3: LISTING, FILTERING & SEARCH
  // ==========================================
  console.log('\n--- 3. Listing, Filtering & Search ---');

  const listAllDocs = await server.inject({
    method: 'GET',
    url: '/api/documents',
    headers: { cookie: adminCookie },
  });
  record('GET /api/documents lists documents for admin', listAllDocs.statusCode === 200 && listAllDocs.json().total >= 3);

  const filterCategory = await server.inject({
    method: 'GET',
    url: '/api/documents?category=Designs',
    headers: { cookie: adminCookie },
  });
  record(
    'GET /api/documents?category=Designs filters documents by category',
    filterCategory.statusCode === 200 && filterCategory.json().data.every((d: any) => d.category === 'Designs')
  );

  const searchDocs = await server.inject({
    method: 'GET',
    url: '/api/documents?search=AutoCAD',
    headers: { cookie: adminCookie },
  });
  record(
    'GET /api/documents?search=AutoCAD finds matching documents',
    searchDocs.statusCode === 200 && searchDocs.json().data.length > 0
  );

  const singleDocRes = await server.inject({
    method: 'GET',
    url: `/api/documents/${projectDoc.id}`,
    headers: { cookie: adminCookie },
  });
  record('GET /api/documents/:id returns document metadata', singleDocRes.statusCode === 200 && singleDocRes.json().data.id === projectDoc.id);

  // ==========================================
  // SECTION 4: SECURITY & VALIDATIONS
  // ==========================================
  console.log('\n--- 4. Security & Validations ---');

  // Executable rejection
  const badExtRes = await server.inject({
    method: 'POST',
    url: '/api/documents',
    headers: { cookie: adminCookie },
    payload: {
      fileName: 'malicious_script.sh',
      fileData: 'data:text/plain;base64,ZWNobyAiSGFja2VkIg==',
      category: 'General',
    },
  });
  record('Security: Executable/script file upload is rejected (400)', badExtRes.statusCode === 400);

  // Customer private document download rejection
  const custPrivateDl = await server.inject({
    method: 'GET',
    url: `/api/documents/${privateDoc.id}/download`,
    headers: { cookie: customerCookie },
  });
  record('Security: Customer is forbidden from downloading private document (403)', custPrivateDl.statusCode === 403);

  // Customer public document download allowed
  const custPublicDl = await server.inject({
    method: 'GET',
    url: `/api/documents/${projectDoc.id}/download`,
    headers: { cookie: customerCookie },
  });
  record(
    'Security: Customer can download authorized public document with correct headers',
    custPublicDl.statusCode === 200 &&
      Boolean(custPublicDl.headers['content-disposition']?.includes('BLU-P2001-CAD-SPEC.pdf'))
  );

  // PDF Fallback streaming test for non-existent disk file
  const fallbackDocRes = await server.inject({
    method: 'POST',
    url: '/api/documents',
    headers: { cookie: adminCookie },
    payload: {
      fileName: 'Mock_Blueprint_Fallback.pdf',
      fileData: 'data:application/pdf;base64,JVBERi0xLjQK',
      category: 'Designs',
      projectId: testProject.id,
      isPublicForCustomer: true,
    },
  });
  const fallbackDoc = fallbackDocRes.json()?.data;
  // Intentionally remove file from disk to test fallback
  if (fs.existsSync(fallbackDoc.fileUrl)) {
    fs.unlinkSync(fallbackDoc.fileUrl);
  }
  const fallbackDl = await server.inject({
    method: 'GET',
    url: `/api/documents/${fallbackDoc.id}/download`,
    headers: { cookie: adminCookie },
  });
  record(
    'PDF Fallback: Streams synthesized PDF buffer when disk file is absent',
    fallbackDl.statusCode === 200 && fallbackDl.rawPayload.toString().startsWith('%PDF-1.4')
  );

  // ==========================================
  // SECTION 5: METADATA UPDATE & DELETE
  // ==========================================
  console.log('\n--- 5. Document Metadata Update & Delete ---');

  const patchDocRes = await server.inject({
    method: 'PATCH',
    url: `/api/documents/${projectDoc.id}`,
    headers: { cookie: adminCookie },
    payload: {
      category: 'Materials',
      description: 'Bijgewerkte materiaalspecificatie',
      isPublicForCustomer: true,
    },
  });
  record('PATCH /api/documents/:id updates document metadata', patchDocRes.statusCode === 200 && patchDocRes.json().data.category === 'Materials');

  const deleteDocRes = await server.inject({
    method: 'DELETE',
    url: `/api/documents/${fallbackDoc.id}`,
    headers: { cookie: adminCookie },
  });
  record('DELETE /api/documents/:id deletes document and storage file', deleteDocRes.statusCode === 200 && deleteDocRes.json().success);

  // Verify document is deleted
  const getDeleted = await server.inject({
    method: 'GET',
    url: `/api/documents/${fallbackDoc.id}`,
    headers: { cookie: adminCookie },
  });
  record('GET /api/documents/:id returns 404 for deleted document', getDeleted.statusCode === 404);

  // ==========================================
  // SECTION 6: PROJECT PHOTOS & MEDIA
  // ==========================================
  console.log('\n--- 6. Project Photos & Media ---');

  // Admin uploads photo for project
  const uploadPhotoRes = await server.inject({
    method: 'POST',
    url: `/api/projects/${testProject.id}/photos`,
    headers: { cookie: adminCookie },
    payload: {
      photoUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      title: 'Teakhouten Frame Constructie',
      phase: 'Werkplaats Fasedatum: 18 Okt 2026',
      craftsman: 'Sven Hoek',
      caption: 'Massief frame gemonteerd en geschuurd',
      tag: 'workshop',
      visibleToCustomer: true,
    },
  });
  const photo1 = uploadPhotoRes.json()?.data;
  record(
    'POST /api/projects/:id/photos creates photo with title, phase, craftsman, and storage persistence',
    (uploadPhotoRes.statusCode === 200 || uploadPhotoRes.statusCode === 201) && photo1?.title === 'Teakhouten Frame Constructie' && photo1?.craftsman === 'Sven Hoek'
  );

  // Create second photo (internal only, not visible to customer)
  const privatePhotoRes = await server.inject({
    method: 'POST',
    url: `/api/projects/${testProject.id}/photos`,
    headers: { cookie: adminCookie },
    payload: {
      photoUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      title: 'Interne Kwaliteitscontrole Teak',
      phase: 'Interne Keuring',
      craftsman: 'Tim & Bram (Admin)',
      caption: 'Niet delen met klant voor finale keuring',
      visibleToCustomer: false,
    },
  });
  const privatePhoto = privatePhotoRes.json()?.data;
  record('POST /api/projects/:id/photos creates internal photo (visibleToCustomer = false)', privatePhotoRes.statusCode === 200 || privatePhotoRes.statusCode === 201);

  // Global photos gallery for admin
  const globalPhotosRes = await server.inject({
    method: 'GET',
    url: '/api/photos',
    headers: { cookie: adminCookie },
  });
  record(
    'GET /api/photos returns global photo gallery with project and customer metadata for admin',
    globalPhotosRes.statusCode === 200 && globalPhotosRes.json().total >= 2 && Boolean(globalPhotosRes.json().data[0].customer)
  );

  // Filter global photos by search
  const searchPhotosRes = await server.inject({
    method: 'GET',
    url: '/api/photos?search=Constructie',
    headers: { cookie: adminCookie },
  });
  record(
    'GET /api/photos?search=Constructie filters global gallery by search keyword',
    searchPhotosRes.statusCode === 200 && searchPhotosRes.json().data.length > 0
  );

  // Photo details update via PATCH /api/photos/:photoId
  const patchPhotoRes = await server.inject({
    method: 'PATCH',
    url: `/api/photos/${photo1.id}`,
    headers: { cookie: adminCookie },
    payload: {
      title: 'Bijgewerkte Teakhouten Constructie',
      phase: 'Fasedatum: 20 Okt 2026',
    },
  });
  record('PATCH /api/photos/:photoId updates photo metadata', patchPhotoRes.statusCode === 200 && patchPhotoRes.json().data.title === 'Bijgewerkte Teakhouten Constructie');

  // Toggle visibility via PATCH /api/photos/:photoId/visibility
  const toggleVisRes = await server.inject({
    method: 'PATCH',
    url: `/api/photos/${privatePhoto.id}/visibility`,
    headers: { cookie: adminCookie },
    payload: { visibleToCustomer: true },
  });
  record(
    'PATCH /api/photos/:photoId/visibility fast toggles customer visibility on',
    toggleVisRes.statusCode === 200 && toggleVisRes.json().data.visibleToCustomer === true
  );

  // Delete photo via DELETE /api/photos/:photoId
  const deletePhotoRes = await server.inject({
    method: 'DELETE',
    url: `/api/photos/${privatePhoto.id}`,
    headers: { cookie: adminCookie },
  });
  record('DELETE /api/photos/:photoId deletes photo record and file', deletePhotoRes.statusCode === 200 && deletePhotoRes.json().success);

  // ==========================================
  // SECTION 7: CUSTOMER PORTAL SCOPED ENDPOINTS
  // ==========================================
  console.log('\n--- 7. Customer Portal Scoped Endpoints ---');

  const customerDocsRes = await server.inject({
    method: 'GET',
    url: `/api/customer/projects/${testProject.id}/documents`,
    headers: { cookie: customerCookie },
  });
  record(
    'GET /api/customer/projects/:id/documents returns scoped customer documents (isPublicForCustomer = true)',
    customerDocsRes.statusCode === 200 && customerDocsRes.json().documents.length > 0
  );

  const customerPhotosRes = await server.inject({
    method: 'GET',
    url: `/api/customer/projects/${testProject.id}/photos`,
    headers: { cookie: customerCookie },
  });
  record(
    'GET /api/customer/projects/:id/photos returns scoped customer photos (visibleToCustomer = true)',
    customerPhotosRes.statusCode === 200 && customerPhotosRes.json().photos.length > 0
  );

  // Partner scoping: partner cannot view unassigned project photos
  const [unassignedProject] = await db.insert(projects).values({
    projectNumber: `PRJ-TEST-${Date.now()}`,
    customerId: testCustomer.id,
    projectType: 'outdoor_kitchen',
    name: 'Unassigned Test Kitchen',
    status: 'pending',
    deliveryAddress: 'Teststraat 1',
    city: 'Amsterdam',
  }).returning();

  const partnerUnassignedRes = await server.inject({
    method: 'GET',
    url: `/api/projects/${unassignedProject.id}/photos`,
    headers: { cookie: partnerCookie },
  });
  record('Partner Scoping: Partner is rejected from viewing unassigned project photos (403)', partnerUnassignedRes.statusCode === 403);

  // Clean up test unassigned project
  await db.delete(projects).where(eq(projects.id, unassignedProject.id));

  // ==========================================
  // TEST SUMMARY
  // ==========================================
  console.log('\n======================================================');
  console.log('📊 MODULE 13 TEST SUMMARY');
  console.log('======================================================');

  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log(`Total Tests : ${total}`);
  console.log(`Passed      : ${passed}`);
  console.log(`Failed      : ${failed}`);

  if (failed > 0) {
    console.error('\n❌ SOME TESTS FAILED:');
    results.filter((r) => !r.passed).forEach((r) => console.error(`  - ${r.name}`));
    process.exit(1);
  } else {
    console.log('\n🎉 ALL MODULE 13 TESTS PASSED PERFECTLY!\n');
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Unhandled test suite error:', err);
  process.exit(1);
});
