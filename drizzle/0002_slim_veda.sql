CREATE TABLE "company_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_name" varchar(150) DEFAULT 'Vanuit Ambacht B.V.' NOT NULL,
	"kvk_number" varchar(50),
	"btw_number" varchar(50),
	"iban" varchar(50),
	"bank_name" varchar(100),
	"email" varchar(255),
	"phone" varchar(50),
	"address" varchar(255),
	"postal_code" varchar(20),
	"city" varchar(100),
	"country" varchar(50) DEFAULT 'NL' NOT NULL,
	"default_margin_percentage" numeric(5, 2) DEFAULT '35.00' NOT NULL,
	"quote_terms_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
