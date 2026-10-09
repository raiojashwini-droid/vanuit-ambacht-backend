import { pgTable, uuid, varchar, text, boolean, timestamp, smallint, integer, numeric, date, jsonb, pgEnum, uniqueIndex, index, check, bigint } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
// ==========================================
// 1. ENUMS
// ==========================================
export const userRoleEnum = pgEnum('user_role', ['admin', 'partner', 'customer']);
export const partnerWorkloadEnum = pgEnum('partner_workload', ['available', 'busy', 'fully_booked', 'inactive']);
export const productTypeEnum = pgEnum('product_type', ['outdoor_kitchen', 'garden_room', 'canopy', 'bin_storage']);
export const leadStatusEnum = pgEnum('lead_status', ['new', 'in_conversation', 'price_requested', 'price_received', 'quote_sent', 'won', 'lost']);
export const taskPriorityEnum = pgEnum('task_priority', ['low', 'medium', 'high', 'urgent']);
export const taskStatusEnum = pgEnum('task_status', ['pending', 'in_progress', 'completed', 'cancelled']);
export const pprStatusEnum = pgEnum('ppr_status', ['requested', 'offers_received', 'selected', 'declined', 'cancelled']);
export const partnerOfferStatusEnum = pgEnum('partner_offer_status', ['submitted', 'under_review', 'accepted', 'rejected', 'superseded']);
export const quoteStatusEnum = pgEnum('quote_status', ['draft', 'sent', 'approved', 'declined', 'expired']);
export const quoteVersionStatusEnum = pgEnum('quote_version_status', ['draft', 'sent', 'approved', 'superseded']);
export const projectTypeEnum = pgEnum('project_type_category', ['outdoor_kitchen', 'garden_room']);
export const projectStatusEnum = pgEnum('project_status', ['pending', 'in_progress', 'completed', 'on_hold', 'cancelled']);
export const milestoneStatusEnum = pgEnum('milestone_status', ['pending', 'in_progress', 'completed']);
export const planningEventTypeEnum = pgEnum('planning_event_type', ['single_day_delivery', 'multi_day_bouw', 'workshop_production', 'site_survey', 'service_aftercare']);
export const planningCalendarLaneEnum = pgEnum('planning_calendar_lane', ['delivery_lane', 'bouw_lane', 'workshop_lane']);
export const planningEventStatusEnum = pgEnum('planning_event_status', ['scheduled', 'confirmed', 'in_progress', 'completed', 'rescheduled', 'cancelled']);
export const invoiceTypeEnum = pgEnum('invoice_type', ['down_payment_upfront', 'final_completion', 'interim_progress', 'full_amount', 'credit_note']);
export const invoiceStatusEnum = pgEnum('invoice_status', ['draft', 'sent', 'paid', 'partially_paid', 'overdue', 'credited']);
export const paymentMethodEnum = pgEnum('payment_method', ['ideal_mollie', 'bank_transfer_abn', 'credit_card', 'cash']);
export const paymentStatusEnum = pgEnum('payment_status', ['pending', 'succeeded', 'failed', 'refunded']);
export const paymentWebhookStatusEnum = pgEnum('payment_webhook_status', ['pending', 'processed', 'failed', 'ignored']);
export const accountTypeEnum = pgEnum('account_type', ['Asset', 'Liability', 'Equity', 'Revenue', 'Expense']);
export const bankTxDirectionEnum = pgEnum('bank_tx_direction', ['credit', 'debit']);
export const bankTxReconciliationStatusEnum = pgEnum('bank_tx_reconciliation_status', ['unmatched', 'matched_invoice', 'matched_expense', 'manual_reconciled']);
export const journalEntryStatusEnum = pgEnum('journal_entry_status', ['draft', 'posted', 'reversed']);
export const journalEntryTypeEnum = pgEnum('journal_entry_type', ['sales_invoice', 'bank_receipt', 'bol_reconciliation', 'purchase_invoice', 'general_journal', 'opening_balance']);
export const documentTypeEnum = pgEnum('document_type', ['cad_blueprint', 'werkorder_pdf', 'offerte_pdf', 'factuur_pdf', 'opleverrapport_pdf', 'bank_statement']);
export const conversationRoleEnum = pgEnum('conversation_role', ['admin', 'partner', 'customer']);
// ==========================================
// 2. CORE USERS & PROFILES
// ==========================================
export const users = pgTable('users', {
    id: uuid('id').defaultRandom().primaryKey(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    role: userRoleEnum('role').notNull(),
    fullName: varchar('full_name', { length: 150 }).notNull(),
    phone: varchar('phone', { length: 50 }),
    avatarUrl: varchar('avatar_url', { length: 500 }),
    language: varchar('language', { length: 10 }).default('nl').notNull(),
    timezone: varchar('timezone', { length: 50 }).default('Europe/Amsterdam').notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index('idx_users_role').on(table.role),
]);
export const customers = pgTable('customers', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    customerNumber: varchar('customer_number', { length: 50 }).notNull().unique(),
    companyName: varchar('company_name', { length: 150 }),
    firstName: varchar('first_name', { length: 100 }).notNull(),
    lastName: varchar('last_name', { length: 100 }).notNull(),
    email: varchar('email', { length: 255 }).notNull(),
    phone: varchar('phone', { length: 50 }).notNull(),
    streetAddress: varchar('street_address', { length: 255 }),
    postalCode: varchar('postal_code', { length: 20 }),
    city: varchar('city', { length: 100 }).notNull(),
    country: varchar('country', { length: 50 }).default('NL').notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index('idx_customers_email').on(table.email),
    index('idx_customers_city').on(table.city),
]);
export const partners = pgTable('partners', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    partnerCode: varchar('partner_code', { length: 50 }).notNull().unique(),
    companyName: varchar('company_name', { length: 150 }).notNull(),
    contactPerson: varchar('contact_person', { length: 150 }).notNull(),
    email: varchar('email', { length: 255 }).notNull(),
    phone: varchar('phone', { length: 50 }).notNull(),
    kvkNumber: varchar('kvk_number', { length: 50 }),
    btwNumber: varchar('btw_number', { length: 50 }),
    region: varchar('region', { length: 100 }),
    workloadStatus: partnerWorkloadEnum('workload_status').default('available').notNull(),
    availableWeeks: integer('available_weeks').array(),
    rating: numeric('rating', { precision: 3, scale: 2 }).default('5.00').notNull(),
    specialties: text('specialties').array(),
    productTypes: text('product_types').array(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index('idx_partners_workload').on(table.workloadStatus),
]);
// ==========================================
// 3. LEADS & INTAKE
// ==========================================
export const leads = pgTable('leads', {
    id: uuid('id').defaultRandom().primaryKey(),
    leadNumber: varchar('lead_number', { length: 50 }).notNull().unique(),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    name: varchar('name', { length: 150 }).notNull(),
    email: varchar('email', { length: 255 }),
    phone: varchar('phone', { length: 50 }),
    address: varchar('address', { length: 255 }),
    city: varchar('city', { length: 100 }),
    productType: productTypeEnum('product_type').notNull(),
    dimensionsInquiry: varchar('dimensions_inquiry', { length: 100 }),
    source: varchar('source', { length: 100 }),
    status: leadStatusEnum('status').default('new').notNull(),
    workflowStep: smallint('workflow_step').default(1).notNull(),
    assignedToUserId: uuid('assigned_to_user_id').references(() => users.id).notNull(),
    lostReason: text('lost_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index('idx_leads_status_step').on(table.status, table.workflowStep),
    index('idx_leads_assigned').on(table.assignedToUserId),
    check('lead_workflow_step_range', sql `${table.workflowStep} >= 1 AND ${table.workflowStep} <= 8`),
]);
export const leadVoiceNotes = pgTable('lead_voice_notes', {
    id: uuid('id').defaultRandom().primaryKey(),
    leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'cascade' }).notNull(),
    uploadedByUserId: uuid('uploaded_by_user_id').references(() => users.id).notNull(),
    fileName: varchar('file_name', { length: 255 }).notNull(),
    fileUrl: text('file_url').notNull(),
    durationSeconds: integer('duration_seconds'),
    recordingDate: timestamp('recording_date', { withTimezone: true }).notNull(),
    transcriptText: text('transcript_text'),
    aiSummary: text('ai_summary'),
    extractedSpecs: jsonb('extracted_specs'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index('idx_voice_notes_lead').on(table.leadId),
]);
// ==========================================
// 4. PARTNER PRICE REQUESTS & BIDS
// ==========================================
export const partnerPriceRequests = pgTable('partner_price_requests', {
    id: uuid('id').defaultRandom().primaryKey(),
    requestNumber: varchar('request_number', { length: 50 }).notNull().unique(),
    leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'restrict' }).notNull(),
    partnerId: uuid('partner_id').references(() => partners.id, { onDelete: 'restrict' }).notNull(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id).notNull(),
    category: varchar('category', { length: 100 }),
    productInfo: text('product_info'),
    dimensions: jsonb('dimensions'),
    materials: jsonb('materials'),
    locationAccess: jsonb('location_access'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
    expectedResponseDate: date('expected_response_date').notNull(),
    status: pprStatusEnum('status').default('requested').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index('idx_ppr_lead').on(table.leadId),
    index('idx_ppr_partner').on(table.partnerId),
    index('idx_ppr_status').on(table.status),
]);
export const partnerOffers = pgTable('partner_offers', {
    id: uuid('id').defaultRandom().primaryKey(),
    offerNumber: varchar('offer_number', { length: 50 }).notNull().unique(),
    requestId: uuid('request_id').references(() => partnerPriceRequests.id, { onDelete: 'cascade' }).notNull(),
    partnerId: uuid('partner_id').references(() => partners.id, { onDelete: 'restrict' }).notNull(),
    revisionNumber: integer('revision_number').default(1).notNull(),
    costPrice: numeric('cost_price', { precision: 12, scale: 2 }).notNull(),
    laborHours: numeric('labor_hours', { precision: 8, scale: 2 }),
    materialsCost: numeric('materials_cost', { precision: 12, scale: 2 }),
    laborCost: numeric('labor_cost', { precision: 12, scale: 2 }),
    estimatedLeadTimeWeeks: integer('estimated_lead_time_weeks'),
    partnerNotes: text('partner_notes'),
    breakdown: jsonb('breakdown'),
    status: partnerOfferStatusEnum('status').default('submitted').notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    uniqueIndex('uq_partner_offer_revision').on(table.requestId, table.revisionNumber),
    index('idx_partner_offers_request').on(table.requestId),
    index('idx_partner_offers_status').on(table.status),
]);
// ==========================================
// 5. QUOTES, REVISIONS & LINE ITEMS
// ==========================================
export const quotes = pgTable('quotes', {
    id: uuid('id').defaultRandom().primaryKey(),
    quoteNumber: varchar('quote_number', { length: 50 }).notNull().unique(),
    publicToken: varchar('public_token', { length: 64 }).notNull().unique(),
    leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    acceptedPartnerOfferId: uuid('accepted_partner_offer_id').references(() => partnerOffers.id, { onDelete: 'set null' }),
    status: quoteStatusEnum('status').default('draft').notNull(),
    productType: varchar('product_type', { length: 100 }).notNull(),
    issueDate: date('issue_date').notNull(),
    validUntil: date('valid_until').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index('idx_quotes_customer').on(table.customerId),
    index('idx_quotes_status').on(table.status),
]);
export const quoteVersions = pgTable('quote_versions', {
    id: uuid('id').defaultRandom().primaryKey(),
    quoteId: uuid('quote_id').references(() => quotes.id, { onDelete: 'cascade' }).notNull(),
    versionNumber: integer('version_number').default(1).notNull(),
    isCurrent: boolean('is_current').default(true).notNull(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id).notNull(),
    coverTitleLine1: varchar('cover_title_line1', { length: 150 }),
    coverTitleLine2: varchar('cover_title_line2', { length: 150 }),
    customSubtitle: text('custom_subtitle'),
    coverPhotos: text('cover_photos').array(),
    dimensionsText: varchar('dimensions_text', { length: 100 }),
    woodType: varchar('wood_type', { length: 100 }),
    woodLifespan: varchar('wood_lifespan', { length: 100 }),
    optionsTitle: varchar('options_title', { length: 150 }),
    optionsSubtext: varchar('options_subtext', { length: 150 }),
    deliveryTimeText: varchar('delivery_time_text', { length: 100 }),
    deliverySubtext: varchar('delivery_subtext', { length: 150 }),
    costPrice: numeric('cost_price', { precision: 12, scale: 2 }),
    marginPercent: numeric('margin_percent', { precision: 5, scale: 2 }),
    marginAmount: numeric('margin_amount', { precision: 12, scale: 2 }),
    subtotalExclVat: numeric('subtotal_excl_vat', { precision: 12, scale: 2 }).notNull(),
    vatAmount: numeric('vat_amount', { precision: 12, scale: 2 }).notNull(),
    totalInclVat: numeric('total_incl_vat', { precision: 12, scale: 2 }).notNull(),
    finishTreatment: varchar('finish_treatment', { length: 255 }),
    stelpostDisclaimer: text('stelpost_disclaimer'),
    vatDisclaimer: text('vat_disclaimer'),
    validityText: text('validity_text'),
    instalmentsConfig: jsonb('instalments_config'),
    diagramConfig: jsonb('diagram_config'),
    specificationsOverview: jsonb('specifications_overview'),
    letterConfig: jsonb('letter_config'),
    status: quoteVersionStatusEnum('status').default('draft').notNull(),
    digitalSignature: jsonb('digital_signature'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    uniqueIndex('uq_quote_version_num').on(table.quoteId, table.versionNumber),
    uniqueIndex('idx_current_quote_version').on(table.quoteId).where(sql `${table.isCurrent} = true`),
    index('idx_quote_versions_quote').on(table.quoteId),
]);
export const quoteItems = pgTable('quote_items', {
    id: uuid('id').defaultRandom().primaryKey(),
    quoteVersionId: uuid('quote_version_id').references(() => quoteVersions.id, { onDelete: 'cascade' }).notNull(),
    position: integer('position').default(1).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    quantity: numeric('quantity', { precision: 10, scale: 2 }).default('1').notNull(),
    unitPriceInclVat: numeric('unit_price_incl_vat', { precision: 12, scale: 2 }).notNull(),
    vatRate: numeric('vat_rate', { precision: 5, scale: 2 }).default('21.00').notNull(),
    lineTotalInclVat: numeric('line_total_incl_vat', { precision: 12, scale: 2 }).notNull(),
    isIncluded: boolean('is_included').default(false).notNull(),
    isStelpost: boolean('is_stelpost').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index('idx_quote_items_version').on(table.quoteVersionId),
]);
// ==========================================
// 6. PROJECTS, MILESTONES & PHOTOS
// ==========================================
export const projects = pgTable('projects', {
    id: uuid('id').defaultRandom().primaryKey(),
    projectNumber: varchar('project_number', { length: 50 }).notNull().unique(),
    quoteId: uuid('quote_id').references(() => quotes.id, { onDelete: 'restrict' }),
    quoteVersionId: uuid('quote_version_id').references(() => quoteVersions.id, { onDelete: 'restrict' }),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'restrict' }).notNull(),
    partnerId: uuid('partner_id').references(() => partners.id, { onDelete: 'restrict' }),
    projectType: projectTypeEnum('project_type').notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    status: projectStatusEnum('status').default('pending').notNull(),
    orderStatus: varchar('order_status', { length: 100 }),
    agreedBuildPrice: numeric('agreed_build_price', { precision: 12, scale: 2 }),
    contractValue: numeric('contract_value', { precision: 12, scale: 2 }),
    progressPercentage: integer('progress_percentage').default(0).notNull(),
    deliveryAddress: varchar('delivery_address', { length: 255 }).notNull(),
    postalCode: varchar('postal_code', { length: 20 }),
    city: varchar('city', { length: 100 }).notNull(),
    deliverySlot: jsonb('delivery_slot'),
    technicalSpecs: jsonb('technical_specs'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index('idx_projects_customer').on(table.customerId),
    index('idx_projects_partner').on(table.partnerId),
    index('idx_projects_type_status').on(table.projectType, table.status),
    check('project_progress_range', sql `${table.progressPercentage} >= 0 AND ${table.progressPercentage} <= 100`),
]);
// ==========================================
// 6B. TASKS & COMMERCIAL ACTIONS
// ==========================================
export const tasks = pgTable('tasks', {
    id: uuid('id').defaultRandom().primaryKey(),
    taskNumber: varchar('task_number', { length: 50 }).notNull().unique(),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    assignedToUserId: uuid('assigned_to_user_id').references(() => users.id).notNull(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id).notNull(),
    priority: taskPriorityEnum('priority').default('medium').notNull(),
    status: taskStatusEnum('status').default('pending').notNull(),
    dueDate: date('due_date').notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index('idx_tasks_assigned').on(table.assignedToUserId),
    index('idx_tasks_status').on(table.status),
    index('idx_tasks_due_date').on(table.dueDate),
    index('idx_tasks_lead').on(table.leadId),
    index('idx_tasks_project').on(table.projectId),
]);
export const commercialActions = pgTable('commercial_actions', {
    id: uuid('id').defaultRandom().primaryKey(),
    leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id).notNull(),
    actionType: varchar('action_type', { length: 50 }).default('consultation_note').notNull(),
    note: text('note').notNull(),
    actionDate: timestamp('action_date', { withTimezone: true }).defaultNow().notNull(),
    linkedTaskId: uuid('linked_task_id').references(() => tasks.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index('idx_comm_actions_lead').on(table.leadId),
    index('idx_comm_actions_project').on(table.projectId),
    check('chk_commercial_actions_target', sql `(${table.leadId} IS NOT NULL AND ${table.projectId} IS NULL) OR (${table.leadId} IS NULL AND ${table.projectId} IS NOT NULL)`),
]);
export const projectMilestones = pgTable('project_milestones', {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
    milestoneCode: varchar('milestone_code', { length: 50 }).notNull(),
    title: varchar('title', { length: 150 }).notNull(),
    description: text('description'),
    sequenceOrder: integer('sequence_order').notNull(),
    status: milestoneStatusEnum('status').default('pending').notNull(),
    scheduledStartDate: date('scheduled_start_date'),
    scheduledEndDate: date('scheduled_end_date'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    verifiedByUserId: uuid('verified_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index('idx_milestones_project').on(table.projectId),
]);
export const projectPhotos = pgTable('project_photos', {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
    uploadedByUserId: uuid('uploaded_by_user_id').references(() => users.id).notNull(),
    photoUrl: text('photo_url').notNull(),
    title: varchar('title', { length: 255 }),
    phase: varchar('phase', { length: 100 }),
    craftsman: varchar('craftsman', { length: 100 }),
    caption: varchar('caption', { length: 255 }),
    tag: varchar('tag', { length: 50 }),
    visibleToCustomer: boolean('visible_to_customer').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index('idx_project_photos_project').on(table.projectId),
]);
export const planningEvents = pgTable('planning_events', {
    id: uuid('id').defaultRandom().primaryKey(),
    eventNumber: varchar('event_number', { length: 50 }).notNull().unique(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    milestoneId: uuid('milestone_id').references(() => projectMilestones.id, { onDelete: 'set null' }),
    partnerId: uuid('partner_id').references(() => partners.id, { onDelete: 'set null' }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id).notNull(),
    eventType: planningEventTypeEnum('event_type').notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    startTime: timestamp('start_time', { withTimezone: true }).notNull(),
    endTime: timestamp('end_time', { withTimezone: true }).notNull(),
    isAllDay: boolean('is_all_day').default(false).notNull(),
    calendarLane: planningCalendarLaneEnum('calendar_lane').notNull(),
    status: planningEventStatusEnum('status').default('scheduled').notNull(),
    location: varchar('location', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index('idx_planning_calendar').on(table.calendarLane, table.startTime, table.endTime),
    index('idx_planning_project').on(table.projectId),
    index('idx_planning_partner').on(table.partnerId),
]);
// ==========================================
// 7. INVOICES, ITEMS, PAYMENTS & SETTLEMENTS
// ==========================================
export const invoices = pgTable('invoices', {
    id: uuid('id').defaultRandom().primaryKey(),
    invoiceNumber: varchar('invoice_number', { length: 50 }).notNull().unique(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'restrict' }).notNull(),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'restrict' }).notNull(),
    quoteId: uuid('quote_id').references(() => quotes.id, { onDelete: 'set null' }),
    milestoneId: uuid('milestone_id').references(() => projectMilestones.id, { onDelete: 'set null' }),
    originalInvoiceId: uuid('original_invoice_id').references(() => invoices.id, { onDelete: 'set null' }),
    creditReason: text('credit_reason'),
    invoiceType: invoiceTypeEnum('invoice_type').notNull(),
    status: invoiceStatusEnum('status').default('draft').notNull(),
    subtotalExclVat: numeric('subtotal_excl_vat', { precision: 12, scale: 2 }).notNull(),
    totalVatAmount: numeric('total_vat_amount', { precision: 12, scale: 2 }).notNull(),
    totalInclVat: numeric('total_incl_vat', { precision: 12, scale: 2 }).notNull(),
    issueDate: date('issue_date').notNull(),
    dueDate: date('due_date').notNull(),
    paidDate: date('paid_date'),
    paymentTermsDays: integer('payment_terms_days').default(14).notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index('idx_invoices_project').on(table.projectId),
    index('idx_invoices_customer').on(table.customerId),
    index('idx_invoices_status_duedate').on(table.status, table.dueDate),
]);
export const invoiceItems = pgTable('invoice_items', {
    id: uuid('id').defaultRandom().primaryKey(),
    invoiceId: uuid('invoice_id').references(() => invoices.id, { onDelete: 'cascade' }).notNull(),
    position: integer('position').default(1).notNull(),
    description: text('description').notNull(),
    subtext: text('subtext'),
    quantity: numeric('quantity', { precision: 10, scale: 2 }).default('1').notNull(),
    unitPriceExclVat: numeric('unit_price_excl_vat', { precision: 12, scale: 2 }).notNull(),
    vatRate: numeric('vat_rate', { precision: 5, scale: 2 }).default('21.00').notNull(),
    lineTotalExclVat: numeric('line_total_excl_vat', { precision: 12, scale: 2 }).notNull(),
    lineTotalInclVat: numeric('line_total_incl_vat', { precision: 12, scale: 2 }).notNull(),
    isIncluded: boolean('is_included').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index('idx_invoice_items_inv').on(table.invoiceId),
]);
export const payments = pgTable('payments', {
    id: uuid('id').defaultRandom().primaryKey(),
    paymentNumber: varchar('payment_number', { length: 50 }).notNull().unique(),
    invoiceId: uuid('invoice_id').references(() => invoices.id, { onDelete: 'restrict' }).notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    paymentMethod: paymentMethodEnum('payment_method').notNull(),
    paymentReference: varchar('payment_reference', { length: 150 }),
    status: paymentStatusEnum('status').default('succeeded').notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }).defaultNow().notNull(),
    molliePaymentId: varchar('mollie_payment_id', { length: 100 }),
    gatewayResponse: jsonb('gateway_response'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index('idx_payments_invoice').on(table.invoiceId),
    index('idx_payments_mollie_id').on(table.molliePaymentId),
]);
export const paymentAllocations = pgTable('payment_allocations', {
    id: uuid('id').defaultRandom().primaryKey(),
    paymentId: uuid('payment_id').references(() => payments.id, { onDelete: 'cascade' }).notNull(),
    bankTransactionId: uuid('bank_transaction_id').references(() => bankTransactions.id, { onDelete: 'cascade' }).notNull(),
    allocatedAmount: numeric('allocated_amount', { precision: 12, scale: 2 }).notNull(),
    allocatedAt: timestamp('allocated_at', { withTimezone: true }).defaultNow().notNull(),
    notes: text('notes'),
}, (table) => [
    uniqueIndex('uq_payment_bank_alloc').on(table.paymentId, table.bankTransactionId),
    index('idx_pay_alloc_payment').on(table.paymentId),
    index('idx_pay_alloc_tx').on(table.bankTransactionId),
    check('chk_allocated_amount_positive', sql `${table.allocatedAmount} > 0`),
]);
// ==========================================
// 8. DOUBLE-ENTRY LEDGER & BANKING
// ==========================================
export const chartOfAccounts = pgTable('chart_of_accounts', {
    id: uuid('id').defaultRandom().primaryKey(),
    accountCode: varchar('account_code', { length: 10 }).notNull().unique(),
    accountName: varchar('account_name', { length: 150 }).notNull(),
    accountType: accountTypeEnum('account_type').notNull(),
    standardVatRule: varchar('standard_vat_rule', { length: 50 }),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
export const bankStatements = pgTable('bank_statements', {
    id: uuid('id').defaultRandom().primaryKey(),
    statementIdentifier: varchar('statement_identifier', { length: 100 }).notNull(),
    fileFormat: varchar('file_format', { length: 20 }).notNull(), // 'mt940' | 'camt053' | 'abn_text'
    fileName: varchar('file_name', { length: 255 }).notNull(),
    fileHash: varchar('file_hash', { length: 64 }).notNull().unique(),
    accountIban: varchar('account_iban', { length: 34 }).notNull(),
    openingBalance: numeric('opening_balance', { precision: 12, scale: 2 }).notNull(),
    closingBalance: numeric('closing_balance', { precision: 12, scale: 2 }).notNull(),
    totalCredits: numeric('total_credits', { precision: 12, scale: 2 }).default('0.00').notNull(),
    totalDebits: numeric('total_debits', { precision: 12, scale: 2 }).default('0.00').notNull(),
    transactionCount: integer('transaction_count').default(0).notNull(),
    uploadedByUserId: uuid('uploaded_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index('idx_bank_statements_account').on(table.accountIban),
    index('idx_bank_statements_created').on(table.createdAt),
    uniqueIndex('uq_bank_statement_hash').on(table.fileHash),
]);
export const bankTransactions = pgTable('bank_transactions', {
    id: uuid('id').defaultRandom().primaryKey(),
    statementId: uuid('statement_id').references(() => bankStatements.id, { onDelete: 'cascade' }),
    bankTxId: varchar('bank_tx_id', { length: 100 }).notNull().unique(),
    accountIban: varchar('account_iban', { length: 34 }).notNull(),
    transactionDate: date('transaction_date').notNull(),
    valueDate: date('value_date'),
    counterIban: varchar('counter_iban', { length: 34 }),
    counterName: varchar('counter_name', { length: 255 }),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    direction: bankTxDirectionEnum('direction').notNull(),
    description: text('description'),
    remittanceInfo: text('remittance_info'),
    category: varchar('category', { length: 100 }),
    matchReason: text('match_reason'),
    reviewReason: text('review_reason'),
    isInternalTransfer: boolean('is_internal_transfer').default(false).notNull(),
    bolSpecification: jsonb('bol_specification'),
    reconciliationStatus: bankTxReconciliationStatusEnum('reconciliation_status').default('unmatched').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index('idx_bank_tx_date').on(table.transactionDate),
    index('idx_bank_tx_reconciliation').on(table.reconciliationStatus),
    index('idx_bank_tx_statement').on(table.statementId),
    index('idx_bank_tx_category').on(table.category),
]);
export const paymentWebhooks = pgTable('payment_webhooks', {
    id: uuid('id').defaultRandom().primaryKey(),
    gateway: varchar('gateway', { length: 50 }).default('mollie').notNull(),
    eventId: varchar('event_id', { length: 255 }).notNull().unique(),
    payload: jsonb('payload'),
    status: paymentWebhookStatusEnum('status').default('pending').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    uniqueIndex('uq_payment_webhook_event').on(table.eventId),
    index('idx_payment_webhooks_status').on(table.status),
]);
export const journalEntries = pgTable('journal_entries', {
    id: uuid('id').defaultRandom().primaryKey(),
    entryNumber: varchar('entry_number', { length: 50 }).notNull().unique(),
    status: journalEntryStatusEnum('status').default('posted').notNull(),
    bankTransactionId: uuid('bank_transaction_id').references(() => bankTransactions.id, { onDelete: 'set null' }),
    invoiceId: uuid('invoice_id').references(() => invoices.id, { onDelete: 'set null' }),
    paymentId: uuid('payment_id').references(() => payments.id, { onDelete: 'set null' }),
    entryDate: date('entry_date').notNull(),
    entryType: journalEntryTypeEnum('entry_type').notNull(),
    description: text('description').notNull(),
    isReversal: boolean('is_reversal').default(false).notNull(),
    reversedByEntryId: uuid('reversed_by_entry_id').references(() => journalEntries.id, { onDelete: 'set null' }),
    originalEntryId: uuid('original_entry_id').references(() => journalEntries.id, { onDelete: 'set null' }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    postedAt: timestamp('posted_at', { withTimezone: true }),
}, (table) => [
    index('idx_journal_entries_date').on(table.entryDate),
    index('idx_journal_entries_type').on(table.entryType),
    index('idx_journal_entries_status').on(table.status),
    index('idx_journal_entries_invoice').on(table.invoiceId),
    index('idx_journal_entries_payment').on(table.paymentId),
    index('idx_journal_entries_bank_tx').on(table.bankTransactionId),
]);
export const journalEntryLines = pgTable('journal_entry_lines', {
    id: uuid('id').defaultRandom().primaryKey(),
    journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id, { onDelete: 'cascade' }).notNull(),
    accountId: uuid('account_id').references(() => chartOfAccounts.id, { onDelete: 'restrict' }).notNull(),
    debit: numeric('debit', { precision: 12, scale: 2 }).default('0.00').notNull(),
    credit: numeric('credit', { precision: 12, scale: 2 }).default('0.00').notNull(),
    vatRule: varchar('vat_rule', { length: 50 }),
    lineDescription: text('line_description'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index('idx_jel_entry').on(table.journalEntryId),
    index('idx_jel_account').on(table.accountId),
    check('chk_jel_non_negative', sql `${table.debit} >= 0 AND ${table.credit} >= 0 AND (${table.debit} > 0 OR ${table.credit} > 0)`),
]);
// ==========================================
// 9. STRONG-FK DOCUMENTS & CONVERSATIONS
// ==========================================
export const documents = pgTable('documents', {
    id: uuid('id').defaultRandom().primaryKey(),
    documentNumber: varchar('document_number', { length: 50 }).notNull().unique(),
    documentType: documentTypeEnum('document_type').notNull(),
    category: varchar('category', { length: 50 }).default('General').notNull(),
    description: text('description'),
    fileName: varchar('file_name', { length: 255 }).notNull(),
    fileUrl: text('file_url').notNull(),
    fileSizeBytes: bigint('file_size_bytes', { mode: 'number' }),
    mimeType: varchar('mime_type', { length: 100 }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    quoteId: uuid('quote_id').references(() => quotes.id, { onDelete: 'cascade' }),
    partnerId: uuid('partner_id').references(() => partners.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'cascade' }),
    invoiceId: uuid('invoice_id').references(() => invoices.id, { onDelete: 'cascade' }),
    isPublicForCustomer: boolean('is_public_for_customer').default(false).notNull(),
    isPublicForPartner: boolean('is_public_for_partner').default(true).notNull(),
    uploadedByUserId: uuid('uploaded_by_user_id').references(() => users.id).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index('idx_docs_project').on(table.projectId),
    index('idx_docs_quote').on(table.quoteId),
    index('idx_docs_invoice').on(table.invoiceId),
    check('chk_documents_single_target', sql `num_nonnulls(${table.projectId}, ${table.quoteId}, ${table.partnerId}, ${table.leadId}, ${table.invoiceId}) <= 1`),
]);
export const conversations = pgTable('conversations', {
    id: uuid('id').defaultRandom().primaryKey(),
    conversationNumber: varchar('conversation_number', { length: 50 }).notNull().unique(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 255 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index('idx_conversations_project').on(table.projectId),
    index('idx_conversations_lead').on(table.leadId),
    check('chk_conversations_target', sql `(${table.projectId} IS NOT NULL AND ${table.leadId} IS NULL) OR (${table.projectId} IS NULL AND ${table.leadId} IS NOT NULL) OR (${table.projectId} IS NULL AND ${table.leadId} IS NULL)`),
]);
export const conversationParticipants = pgTable('conversation_participants', {
    id: uuid('id').defaultRandom().primaryKey(),
    conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'cascade' }).notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    roleInConversation: conversationRoleEnum('role_in_conversation').notNull(),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    uniqueIndex('uq_conv_participant').on(table.conversationId, table.userId),
]);
export const messages = pgTable('messages', {
    id: uuid('id').defaultRandom().primaryKey(),
    conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'cascade' }).notNull(),
    senderUserId: uuid('sender_user_id').references(() => users.id).notNull(),
    content: text('content').notNull(),
    attachmentDocumentId: uuid('attachment_document_id').references(() => documents.id, { onDelete: 'set null' }),
    isRead: boolean('is_read').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index('idx_messages_conversation').on(table.conversationId),
]);
// ==========================================
// 10. SYSTEM & COMPANY SETTINGS
// ==========================================
export const companySettings = pgTable('company_settings', {
    id: uuid('id').defaultRandom().primaryKey(),
    companyName: varchar('company_name', { length: 150 }).default('Vanuit Ambacht B.V.').notNull(),
    website: varchar('website', { length: 255 }),
    kvkNumber: varchar('kvk_number', { length: 50 }),
    btwNumber: varchar('btw_number', { length: 50 }),
    iban: varchar('iban', { length: 50 }),
    bankName: varchar('bank_name', { length: 100 }),
    email: varchar('email', { length: 255 }),
    phone: varchar('phone', { length: 50 }),
    address: varchar('address', { length: 255 }),
    postalCode: varchar('postal_code', { length: 20 }),
    city: varchar('city', { length: 100 }),
    country: varchar('country', { length: 50 }).default('NL').notNull(),
    standardVatRate: numeric('standard_vat_rate', { precision: 5, scale: 2 }).default('21.00').notNull(),
    lowVatRate: numeric('low_vat_rate', { precision: 5, scale: 2 }).default('9.00').notNull(),
    quotePrefix: varchar('quote_prefix', { length: 50 }).default('#Q-2004').notNull(),
    invoicePrefix: varchar('invoice_prefix', { length: 50 }).default('#INV-902').notNull(),
    defaultMarginPercentage: numeric('default_margin_percentage', { precision: 5, scale: 2 }).default('35.00').notNull(),
    quoteTermsText: text('quote_terms_text'),
    fiscalLockDate: date('fiscal_lock_date'),
    brandingColors: jsonb('branding_colors'),
    categoriesConfig: jsonb('categories_config'),
    fieldsetsConfig: jsonb('fieldsets_config'),
    partnerBreakdownConfig: jsonb('partner_breakdown_config'),
    plConfig: jsonb('pl_config'),
    messageTemplates: jsonb('message_templates'),
    quoteTemplateConfig: jsonb('quote_template_config'),
    integrationsConfig: jsonb('integrations_config'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
// ==========================================
// 11. VAT FILINGS
// ==========================================
export const vatFilings = pgTable('vat_filings', {
    id: uuid('id').defaultRandom().primaryKey(),
    filingNumber: varchar('filing_number', { length: 50 }).notNull().unique(),
    year: integer('year').notNull(),
    quarter: varchar('quarter', { length: 10 }).notNull(),
    revenueExclVat: numeric('revenue_excl_vat', { precision: 12, scale: 2 }).notNull(),
    vatCollected21: numeric('vat_collected_21', { precision: 12, scale: 2 }).notNull(),
    vatDeductible5b: numeric('vat_deductible_5b', { precision: 12, scale: 2 }).notNull(),
    netVatPayable: numeric('net_vat_payable', { precision: 12, scale: 2 }).notNull(),
    status: varchar('status', { length: 20 }).default('submitted').notNull(),
    filedByUserId: uuid('filed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    filedAt: timestamp('filed_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index('idx_vat_filings_year_quarter').on(table.year, table.quarter),
]);
