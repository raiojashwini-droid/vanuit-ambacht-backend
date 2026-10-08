CREATE TYPE "public"."account_type" AS ENUM('Asset', 'Liability', 'Equity', 'Revenue', 'Expense');--> statement-breakpoint
CREATE TYPE "public"."bank_tx_direction" AS ENUM('credit', 'debit');--> statement-breakpoint
CREATE TYPE "public"."bank_tx_reconciliation_status" AS ENUM('unmatched', 'matched_invoice', 'matched_expense', 'manual_reconciled');--> statement-breakpoint
CREATE TYPE "public"."conversation_role" AS ENUM('admin', 'partner', 'customer');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('cad_blueprint', 'werkorder_pdf', 'offerte_pdf', 'factuur_pdf', 'opleverrapport_pdf', 'bank_statement');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'sent', 'paid', 'partially_paid', 'overdue', 'credited');--> statement-breakpoint
CREATE TYPE "public"."invoice_type" AS ENUM('down_payment_upfront', 'final_completion', 'interim_progress', 'full_amount');--> statement-breakpoint
CREATE TYPE "public"."journal_entry_type" AS ENUM('sales_invoice', 'bank_receipt', 'bol_reconciliation', 'purchase_invoice', 'general_journal');--> statement-breakpoint
CREATE TYPE "public"."lead_status" AS ENUM('new', 'in_conversation', 'price_requested', 'price_received', 'quote_sent', 'won', 'lost');--> statement-breakpoint
CREATE TYPE "public"."milestone_status" AS ENUM('pending', 'in_progress', 'completed');--> statement-breakpoint
CREATE TYPE "public"."partner_offer_status" AS ENUM('submitted', 'under_review', 'accepted', 'rejected', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."partner_workload" AS ENUM('available', 'busy', 'fully_booked', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('ideal_mollie', 'bank_transfer_abn', 'credit_card', 'cash');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'succeeded', 'failed', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."planning_calendar_lane" AS ENUM('delivery_lane', 'bouw_lane', 'workshop_lane');--> statement-breakpoint
CREATE TYPE "public"."planning_event_status" AS ENUM('scheduled', 'confirmed', 'in_progress', 'completed', 'rescheduled', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."planning_event_type" AS ENUM('single_day_delivery', 'multi_day_bouw', 'workshop_production', 'site_survey', 'service_aftercare');--> statement-breakpoint
CREATE TYPE "public"."ppr_status" AS ENUM('requested', 'offers_received', 'selected', 'declined', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."product_type" AS ENUM('outdoor_kitchen', 'garden_room', 'canopy', 'bin_storage');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('pending', 'in_progress', 'completed', 'on_hold', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."project_type_category" AS ENUM('outdoor_kitchen', 'garden_room');--> statement-breakpoint
CREATE TYPE "public"."quote_status" AS ENUM('draft', 'sent', 'approved', 'declined', 'expired');--> statement-breakpoint
CREATE TYPE "public"."quote_version_status" AS ENUM('draft', 'sent', 'approved', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('low', 'medium', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('pending', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'partner', 'customer');--> statement-breakpoint
CREATE TABLE "bank_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_tx_id" varchar(100) NOT NULL,
	"account_iban" varchar(34) NOT NULL,
	"transaction_date" date NOT NULL,
	"value_date" date,
	"counter_iban" varchar(34),
	"counter_name" varchar(255),
	"amount" numeric(12, 2) NOT NULL,
	"direction" "bank_tx_direction" NOT NULL,
	"description" text,
	"remittance_info" text,
	"reconciliation_status" "bank_tx_reconciliation_status" DEFAULT 'unmatched' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_transactions_bank_tx_id_unique" UNIQUE("bank_tx_id")
);
--> statement-breakpoint
CREATE TABLE "chart_of_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_code" varchar(10) NOT NULL,
	"account_name" varchar(150) NOT NULL,
	"account_type" "account_type" NOT NULL,
	"standard_vat_rule" varchar(50),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chart_of_accounts_account_code_unique" UNIQUE("account_code")
);
--> statement-breakpoint
CREATE TABLE "commercial_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid,
	"project_id" uuid,
	"created_by_user_id" uuid NOT NULL,
	"action_type" varchar(50) DEFAULT 'consultation_note' NOT NULL,
	"note" text NOT NULL,
	"action_date" timestamp with time zone DEFAULT now() NOT NULL,
	"linked_task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_commercial_actions_target" CHECK (("commercial_actions"."lead_id" IS NOT NULL AND "commercial_actions"."project_id" IS NULL) OR ("commercial_actions"."lead_id" IS NULL AND "commercial_actions"."project_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "conversation_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_in_conversation" "conversation_role" NOT NULL,
	"last_read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_number" varchar(50) NOT NULL,
	"project_id" uuid,
	"lead_id" uuid,
	"title" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_conversation_number_unique" UNIQUE("conversation_number"),
	CONSTRAINT "chk_conversations_target" CHECK (("conversations"."project_id" IS NOT NULL AND "conversations"."lead_id" IS NULL) OR ("conversations"."project_id" IS NULL AND "conversations"."lead_id" IS NOT NULL) OR ("conversations"."project_id" IS NULL AND "conversations"."lead_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"customer_number" varchar(50) NOT NULL,
	"company_name" varchar(150),
	"first_name" varchar(100) NOT NULL,
	"last_name" varchar(100) NOT NULL,
	"email" varchar(255) NOT NULL,
	"phone" varchar(50) NOT NULL,
	"street_address" varchar(255),
	"postal_code" varchar(20),
	"city" varchar(100) NOT NULL,
	"country" varchar(50) DEFAULT 'NL' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_customer_number_unique" UNIQUE("customer_number")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_number" varchar(50) NOT NULL,
	"document_type" "document_type" NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"file_url" text NOT NULL,
	"file_size_bytes" bigint,
	"mime_type" varchar(100),
	"project_id" uuid,
	"quote_id" uuid,
	"partner_id" uuid,
	"lead_id" uuid,
	"invoice_id" uuid,
	"is_public_for_customer" boolean DEFAULT false NOT NULL,
	"is_public_for_partner" boolean DEFAULT true NOT NULL,
	"uploaded_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_document_number_unique" UNIQUE("document_number"),
	CONSTRAINT "chk_documents_target_presence" CHECK ("documents"."project_id" IS NOT NULL OR "documents"."quote_id" IS NOT NULL OR "documents"."partner_id" IS NOT NULL OR "documents"."lead_id" IS NOT NULL OR "documents"."invoice_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "invoice_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"position" integer DEFAULT 1 NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(10, 2) DEFAULT '1' NOT NULL,
	"unit_price_excl_vat" numeric(12, 2) NOT NULL,
	"vat_rate" numeric(5, 2) DEFAULT '21.00' NOT NULL,
	"line_total_excl_vat" numeric(12, 2) NOT NULL,
	"line_total_incl_vat" numeric(12, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_number" varchar(50) NOT NULL,
	"project_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"quote_id" uuid,
	"invoice_type" "invoice_type" NOT NULL,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"subtotal_excl_vat" numeric(12, 2) NOT NULL,
	"total_vat_amount" numeric(12, 2) NOT NULL,
	"total_incl_vat" numeric(12, 2) NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date NOT NULL,
	"paid_date" date,
	"payment_terms_days" integer DEFAULT 14 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_invoice_number_unique" UNIQUE("invoice_number")
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_number" varchar(50) NOT NULL,
	"bank_transaction_id" uuid,
	"invoice_id" uuid,
	"payment_id" uuid,
	"entry_date" date NOT NULL,
	"entry_type" "journal_entry_type" NOT NULL,
	"description" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_entries_entry_number_unique" UNIQUE("entry_number")
);
--> statement-breakpoint
CREATE TABLE "journal_entry_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journal_entry_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"debit" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"credit" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"vat_rule" varchar(50),
	"line_description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_jel_non_negative" CHECK ("journal_entry_lines"."debit" >= 0 AND "journal_entry_lines"."credit" >= 0 AND ("journal_entry_lines"."debit" > 0 OR "journal_entry_lines"."credit" > 0))
);
--> statement-breakpoint
CREATE TABLE "lead_voice_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"uploaded_by_user_id" uuid NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"file_url" text NOT NULL,
	"duration_seconds" integer,
	"recording_date" timestamp with time zone NOT NULL,
	"transcript_text" text,
	"ai_summary" text,
	"extracted_specs" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_number" varchar(50) NOT NULL,
	"customer_id" uuid,
	"name" varchar(150) NOT NULL,
	"email" varchar(255),
	"phone" varchar(50),
	"address" varchar(255),
	"city" varchar(100),
	"product_type" "product_type" NOT NULL,
	"dimensions_inquiry" varchar(100),
	"source" varchar(100),
	"status" "lead_status" DEFAULT 'new' NOT NULL,
	"workflow_step" smallint DEFAULT 1 NOT NULL,
	"assigned_to_user_id" uuid NOT NULL,
	"lost_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leads_lead_number_unique" UNIQUE("lead_number"),
	CONSTRAINT "lead_workflow_step_range" CHECK ("leads"."workflow_step" >= 1 AND "leads"."workflow_step" <= 8)
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender_user_id" uuid NOT NULL,
	"content" text NOT NULL,
	"attachment_document_id" uuid,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_number" varchar(50) NOT NULL,
	"request_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"revision_number" integer DEFAULT 1 NOT NULL,
	"cost_price" numeric(12, 2) NOT NULL,
	"labor_hours" numeric(8, 2),
	"materials_cost" numeric(12, 2),
	"labor_cost" numeric(12, 2),
	"estimated_lead_time_weeks" integer,
	"partner_notes" text,
	"status" "partner_offer_status" DEFAULT 'submitted' NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_offers_offer_number_unique" UNIQUE("offer_number")
);
--> statement-breakpoint
CREATE TABLE "partner_price_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_number" varchar(50) NOT NULL,
	"lead_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"category" varchar(100),
	"product_info" text,
	"dimensions" jsonb,
	"materials" jsonb,
	"location_access" jsonb,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expected_response_date" date NOT NULL,
	"status" "ppr_status" DEFAULT 'requested' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_price_requests_request_number_unique" UNIQUE("request_number")
);
--> statement-breakpoint
CREATE TABLE "partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"partner_code" varchar(50) NOT NULL,
	"company_name" varchar(150) NOT NULL,
	"contact_person" varchar(150) NOT NULL,
	"email" varchar(255) NOT NULL,
	"phone" varchar(50) NOT NULL,
	"kvk_number" varchar(50),
	"btw_number" varchar(50),
	"region" varchar(100),
	"workload_status" "partner_workload" DEFAULT 'available' NOT NULL,
	"rating" numeric(3, 2) DEFAULT '5.00' NOT NULL,
	"specialties" text[],
	"product_types" text[],
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partners_partner_code_unique" UNIQUE("partner_code")
);
--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"bank_transaction_id" uuid NOT NULL,
	"allocated_amount" numeric(12, 2) NOT NULL,
	"allocated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	CONSTRAINT "chk_allocated_amount_positive" CHECK ("payment_allocations"."allocated_amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_number" varchar(50) NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"payment_method" "payment_method" NOT NULL,
	"payment_reference" varchar(150),
	"status" "payment_status" DEFAULT 'succeeded' NOT NULL,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	"gateway_response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_payment_number_unique" UNIQUE("payment_number")
);
--> statement-breakpoint
CREATE TABLE "planning_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_number" varchar(50) NOT NULL,
	"project_id" uuid,
	"milestone_id" uuid,
	"partner_id" uuid,
	"created_by_user_id" uuid NOT NULL,
	"event_type" "planning_event_type" NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"start_time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone NOT NULL,
	"is_all_day" boolean DEFAULT false NOT NULL,
	"calendar_lane" "planning_calendar_lane" NOT NULL,
	"status" "planning_event_status" DEFAULT 'scheduled' NOT NULL,
	"location" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "planning_events_event_number_unique" UNIQUE("event_number")
);
--> statement-breakpoint
CREATE TABLE "project_milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"milestone_code" varchar(50) NOT NULL,
	"title" varchar(150) NOT NULL,
	"description" text,
	"sequence_order" integer NOT NULL,
	"status" "milestone_status" DEFAULT 'pending' NOT NULL,
	"scheduled_start_date" date,
	"scheduled_end_date" date,
	"completed_at" timestamp with time zone,
	"verified_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"uploaded_by_user_id" uuid NOT NULL,
	"photo_url" text NOT NULL,
	"caption" varchar(255),
	"tag" varchar(50),
	"visible_to_customer" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_number" varchar(50) NOT NULL,
	"quote_id" uuid,
	"quote_version_id" uuid,
	"customer_id" uuid NOT NULL,
	"partner_id" uuid,
	"project_type" "project_type_category" NOT NULL,
	"name" varchar(255) NOT NULL,
	"status" "project_status" DEFAULT 'pending' NOT NULL,
	"order_status" varchar(100),
	"agreed_build_price" numeric(12, 2),
	"contract_value" numeric(12, 2),
	"progress_percentage" integer DEFAULT 0 NOT NULL,
	"delivery_address" varchar(255) NOT NULL,
	"postal_code" varchar(20),
	"city" varchar(100) NOT NULL,
	"delivery_slot" jsonb,
	"technical_specs" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_project_number_unique" UNIQUE("project_number"),
	CONSTRAINT "project_progress_range" CHECK ("projects"."progress_percentage" >= 0 AND "projects"."progress_percentage" <= 100)
);
--> statement-breakpoint
CREATE TABLE "quote_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_version_id" uuid NOT NULL,
	"position" integer DEFAULT 1 NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"quantity" numeric(10, 2) DEFAULT '1' NOT NULL,
	"unit_price_incl_vat" numeric(12, 2) NOT NULL,
	"vat_rate" numeric(5, 2) DEFAULT '21.00' NOT NULL,
	"line_total_incl_vat" numeric(12, 2) NOT NULL,
	"is_included" boolean DEFAULT false NOT NULL,
	"is_stelpost" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"version_number" integer DEFAULT 1 NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"cover_title_line1" varchar(150),
	"cover_title_line2" varchar(150),
	"custom_subtitle" text,
	"cover_photos" text[],
	"dimensions_text" varchar(100),
	"wood_type" varchar(100),
	"wood_lifespan" varchar(100),
	"options_title" varchar(150),
	"options_subtext" varchar(150),
	"delivery_time_text" varchar(100),
	"delivery_subtext" varchar(150),
	"subtotal_excl_vat" numeric(12, 2) NOT NULL,
	"vat_amount" numeric(12, 2) NOT NULL,
	"total_incl_vat" numeric(12, 2) NOT NULL,
	"finish_treatment" varchar(255),
	"stelpost_disclaimer" text,
	"vat_disclaimer" text,
	"validity_text" text,
	"instalments_config" jsonb,
	"diagram_config" jsonb,
	"specifications_overview" jsonb,
	"status" "quote_version_status" DEFAULT 'draft' NOT NULL,
	"digital_signature" jsonb,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_number" varchar(50) NOT NULL,
	"public_token" varchar(64) NOT NULL,
	"lead_id" uuid,
	"customer_id" uuid NOT NULL,
	"accepted_partner_offer_id" uuid,
	"status" "quote_status" DEFAULT 'draft' NOT NULL,
	"product_type" varchar(100) NOT NULL,
	"issue_date" date NOT NULL,
	"valid_until" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotes_quote_number_unique" UNIQUE("quote_number"),
	CONSTRAINT "quotes_public_token_unique" UNIQUE("public_token")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_number" varchar(50) NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"lead_id" uuid,
	"project_id" uuid,
	"assigned_to_user_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"priority" "task_priority" DEFAULT 'medium' NOT NULL,
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"due_date" date NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_task_number_unique" UNIQUE("task_number")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"role" "user_role" NOT NULL,
	"full_name" varchar(150) NOT NULL,
	"phone" varchar(50),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "commercial_actions" ADD CONSTRAINT "commercial_actions_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_actions" ADD CONSTRAINT "commercial_actions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_actions" ADD CONSTRAINT "commercial_actions_linked_task_id_tasks_id_fk" FOREIGN KEY ("linked_task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_bank_transaction_id_bank_transactions_id_fk" FOREIGN KEY ("bank_transaction_id") REFERENCES "public"."bank_transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_account_id_chart_of_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_voice_notes" ADD CONSTRAINT "lead_voice_notes_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_voice_notes" ADD CONSTRAINT "lead_voice_notes_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_attachment_document_id_documents_id_fk" FOREIGN KEY ("attachment_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_offers" ADD CONSTRAINT "partner_offers_request_id_partner_price_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."partner_price_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_offers" ADD CONSTRAINT "partner_offers_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_price_requests" ADD CONSTRAINT "partner_price_requests_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_price_requests" ADD CONSTRAINT "partner_price_requests_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_price_requests" ADD CONSTRAINT "partner_price_requests_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_events" ADD CONSTRAINT "planning_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_events" ADD CONSTRAINT "planning_events_milestone_id_project_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."project_milestones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_events" ADD CONSTRAINT "planning_events_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_events" ADD CONSTRAINT "planning_events_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_verified_by_user_id_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_photos" ADD CONSTRAINT "project_photos_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_photos" ADD CONSTRAINT "project_photos_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_quote_version_id_quote_versions_id_fk" FOREIGN KEY ("quote_version_id") REFERENCES "public"."quote_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_quote_version_id_quote_versions_id_fk" FOREIGN KEY ("quote_version_id") REFERENCES "public"."quote_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_accepted_partner_offer_id_partner_offers_id_fk" FOREIGN KEY ("accepted_partner_offer_id") REFERENCES "public"."partner_offers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_bank_tx_date" ON "bank_transactions" USING btree ("transaction_date");--> statement-breakpoint
CREATE INDEX "idx_bank_tx_reconciliation" ON "bank_transactions" USING btree ("reconciliation_status");--> statement-breakpoint
CREATE INDEX "idx_comm_actions_lead" ON "commercial_actions" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "idx_comm_actions_project" ON "commercial_actions" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_conv_participant" ON "conversation_participants" USING btree ("conversation_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_conversations_project" ON "conversations" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_conversations_lead" ON "conversations" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "idx_customers_email" ON "customers" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_customers_city" ON "customers" USING btree ("city");--> statement-breakpoint
CREATE INDEX "idx_docs_project" ON "documents" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_docs_quote" ON "documents" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "idx_docs_invoice" ON "documents" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "idx_invoice_items_inv" ON "invoice_items" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "idx_invoices_project" ON "invoices" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_invoices_customer" ON "invoices" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_invoices_status_duedate" ON "invoices" USING btree ("status","due_date");--> statement-breakpoint
CREATE INDEX "idx_journal_entries_date" ON "journal_entries" USING btree ("entry_date");--> statement-breakpoint
CREATE INDEX "idx_journal_entries_type" ON "journal_entries" USING btree ("entry_type");--> statement-breakpoint
CREATE INDEX "idx_jel_entry" ON "journal_entry_lines" USING btree ("journal_entry_id");--> statement-breakpoint
CREATE INDEX "idx_jel_account" ON "journal_entry_lines" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_voice_notes_lead" ON "lead_voice_notes" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "idx_leads_status_step" ON "leads" USING btree ("status","workflow_step");--> statement-breakpoint
CREATE INDEX "idx_leads_assigned" ON "leads" USING btree ("assigned_to_user_id");--> statement-breakpoint
CREATE INDEX "idx_messages_conversation" ON "messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_partner_offer_revision" ON "partner_offers" USING btree ("request_id","revision_number");--> statement-breakpoint
CREATE INDEX "idx_partner_offers_request" ON "partner_offers" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "idx_partner_offers_status" ON "partner_offers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_ppr_lead" ON "partner_price_requests" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "idx_ppr_partner" ON "partner_price_requests" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "idx_ppr_status" ON "partner_price_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_partners_workload" ON "partners" USING btree ("workload_status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payment_bank_alloc" ON "payment_allocations" USING btree ("payment_id","bank_transaction_id");--> statement-breakpoint
CREATE INDEX "idx_pay_alloc_payment" ON "payment_allocations" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "idx_pay_alloc_tx" ON "payment_allocations" USING btree ("bank_transaction_id");--> statement-breakpoint
CREATE INDEX "idx_payments_invoice" ON "payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "idx_planning_calendar" ON "planning_events" USING btree ("calendar_lane","start_time","end_time");--> statement-breakpoint
CREATE INDEX "idx_planning_project" ON "planning_events" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_planning_partner" ON "planning_events" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "idx_milestones_project" ON "project_milestones" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_project_photos_project" ON "project_photos" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_projects_customer" ON "projects" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_projects_partner" ON "projects" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "idx_projects_type_status" ON "projects" USING btree ("project_type","status");--> statement-breakpoint
CREATE INDEX "idx_quote_items_version" ON "quote_items" USING btree ("quote_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_quote_version_num" ON "quote_versions" USING btree ("quote_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_current_quote_version" ON "quote_versions" USING btree ("quote_id") WHERE "quote_versions"."is_current" = true;--> statement-breakpoint
CREATE INDEX "idx_quote_versions_quote" ON "quote_versions" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "idx_quotes_customer" ON "quotes" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_quotes_status" ON "quotes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_tasks_assigned" ON "tasks" USING btree ("assigned_to_user_id");--> statement-breakpoint
CREATE INDEX "idx_tasks_status" ON "tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_tasks_due_date" ON "tasks" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "idx_users_role" ON "users" USING btree ("role");