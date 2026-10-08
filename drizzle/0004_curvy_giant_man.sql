ALTER TABLE "quotes" DROP CONSTRAINT "quotes_customer_id_customers_id_fk";
--> statement-breakpoint
ALTER TABLE "quotes" ALTER COLUMN "customer_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_versions" ADD COLUMN "cost_price" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "quote_versions" ADD COLUMN "margin_percent" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "quote_versions" ADD COLUMN "margin_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "quote_versions" ADD COLUMN "letter_config" jsonb;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;