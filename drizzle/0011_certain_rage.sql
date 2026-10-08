CREATE TABLE "vat_filings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filing_number" varchar(50) NOT NULL,
	"year" integer NOT NULL,
	"quarter" varchar(10) NOT NULL,
	"revenue_excl_vat" numeric(12, 2) NOT NULL,
	"vat_collected_21" numeric(12, 2) NOT NULL,
	"vat_deductible_5b" numeric(12, 2) NOT NULL,
	"net_vat_payable" numeric(12, 2) NOT NULL,
	"status" varchar(20) DEFAULT 'submitted' NOT NULL,
	"filed_by_user_id" uuid,
	"filed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vat_filings_filing_number_unique" UNIQUE("filing_number")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_url" varchar(500);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "language" varchar(10) DEFAULT 'nl' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "timezone" varchar(50) DEFAULT 'Europe/Amsterdam' NOT NULL;--> statement-breakpoint
ALTER TABLE "vat_filings" ADD CONSTRAINT "vat_filings_filed_by_user_id_users_id_fk" FOREIGN KEY ("filed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_vat_filings_year_quarter" ON "vat_filings" USING btree ("year","quarter");