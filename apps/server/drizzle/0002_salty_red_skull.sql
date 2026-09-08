ALTER TABLE "email_credentials" ADD COLUMN "email_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone_hash" text;--> statement-breakpoint
CREATE INDEX "email_credentials_hash_idx" ON "email_credentials" USING btree ("email_hash");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_phone_unique" UNIQUE("phone");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_phone_hash_unique" UNIQUE("phone_hash");