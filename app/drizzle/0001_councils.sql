CREATE TABLE "councils" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"members" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"threshold" integer DEFAULT 1 NOT NULL,
	"safe_address" text
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "council" text;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "signatures" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "councils" ADD CONSTRAINT "councils_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "councils_tenant_name" ON "councils" USING btree ("tenant_id","name");