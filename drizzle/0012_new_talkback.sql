DO $$ BEGIN
    CREATE TYPE "public"."partner_candidate_stage" AS ENUM('interested', 'in_discussion', 'trial_project', 'active', 'rejected');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "partner_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_number" varchar(50) NOT NULL,
	"name" varchar(150) NOT NULL,
	"company_name" varchar(150),
	"email" varchar(255) NOT NULL,
	"phone" varchar(50) NOT NULL,
	"region" varchar(100) DEFAULT 'Nederland',
	"stage" "partner_candidate_stage" DEFAULT 'interested' NOT NULL,
	"notes" text,
	"specialties" text[],
	"product_types" text[],
	"kvk_number" varchar(50),
	"btw_number" varchar(50),
	"converted_partner_id" uuid,
	"converted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_candidates_candidate_number_unique" UNIQUE("candidate_number")
);
--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "partners" ADD COLUMN "available_weeks" integer[];
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "partner_candidates" ADD CONSTRAINT "partner_candidates_converted_partner_id_partners_id_fk" FOREIGN KEY ("converted_partner_id") REFERENCES "public"."partners"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_partner_candidates_stage" ON "partner_candidates" USING btree ("stage");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_partner_candidates_email" ON "partner_candidates" USING btree ("email");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_partner_candidates_converted_partner" ON "partner_candidates" USING btree ("converted_partner_id");
