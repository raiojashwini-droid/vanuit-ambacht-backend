DO $$ BEGIN
  CREATE TYPE "public"."payment_webhook_status" AS ENUM('pending', 'processed', 'failed', 'ignored');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TYPE "public"."invoice_type" ADD VALUE IF NOT EXISTS 'credit_note';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"statement_identifier" varchar(100) NOT NULL,
	"file_format" varchar(20) NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"file_hash" varchar(64) NOT NULL,
	"account_iban" varchar(34) NOT NULL,
	"opening_balance" numeric(12, 2) NOT NULL,
	"closing_balance" numeric(12, 2) NOT NULL,
	"total_credits" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"total_debits" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"transaction_count" integer DEFAULT 0 NOT NULL,
	"uploaded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_statements_file_hash_unique" UNIQUE("file_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gateway" varchar(50) DEFAULT 'mollie' NOT NULL,
	"event_id" varchar(255) NOT NULL,
	"payload" jsonb,
	"status" "payment_webhook_status" DEFAULT 'pending' NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_webhooks_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN IF NOT EXISTS "statement_id" uuid;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN IF NOT EXISTS "category" varchar(100);--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN IF NOT EXISTS "match_reason" text;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN IF NOT EXISTS "review_reason" text;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN IF NOT EXISTS "is_internal_transfer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN IF NOT EXISTS "bol_specification" jsonb;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN IF NOT EXISTS "subtext" text;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN IF NOT EXISTS "is_included" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "milestone_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "original_invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "credit_reason" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "mollie_payment_id" varchar(100);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bank_statements_account" ON "bank_statements" USING btree ("account_iban");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bank_statements_created" ON "bank_statements" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_bank_statement_hash" ON "bank_statements" USING btree ("file_hash");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_payment_webhook_event" ON "payment_webhooks" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_payment_webhooks_status" ON "payment_webhooks" USING btree ("status");--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_statement_id_bank_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."bank_statements"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "invoices" ADD CONSTRAINT "invoices_milestone_id_project_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."project_milestones"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "invoices" ADD CONSTRAINT "invoices_original_invoice_id_invoices_id_fk" FOREIGN KEY ("original_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_bank_transaction_id_bank_transactions_id_fk" FOREIGN KEY ("bank_transaction_id") REFERENCES "public"."bank_transactions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bank_tx_statement" ON "bank_transactions" USING btree ("statement_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bank_tx_category" ON "bank_transactions" USING btree ("category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_payments_mollie_id" ON "payments" USING btree ("mollie_payment_id");