ALTER TABLE "documents" DROP CONSTRAINT "chk_documents_single_target";--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "category" varchar(50) DEFAULT 'General' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "project_photos" ADD COLUMN "title" varchar(255);--> statement-breakpoint
ALTER TABLE "project_photos" ADD COLUMN "phase" varchar(100);--> statement-breakpoint
ALTER TABLE "project_photos" ADD COLUMN "craftsman" varchar(100);--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "chk_documents_single_target" CHECK (num_nonnulls("documents"."project_id", "documents"."quote_id", "documents"."partner_id", "documents"."lead_id", "documents"."invoice_id") <= 1);