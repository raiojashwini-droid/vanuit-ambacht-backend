ALTER TABLE "company_settings" ADD COLUMN "website" varchar(255);--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "standard_vat_rate" numeric(5, 2) DEFAULT '21.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "low_vat_rate" numeric(5, 2) DEFAULT '9.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "quote_prefix" varchar(50) DEFAULT '#Q-2004' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "invoice_prefix" varchar(50) DEFAULT '#INV-902' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "branding_colors" jsonb;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "categories_config" jsonb;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "fieldsets_config" jsonb;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "partner_breakdown_config" jsonb;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "pl_config" jsonb;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "message_templates" jsonb;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "quote_template_config" jsonb;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "integrations_config" jsonb;