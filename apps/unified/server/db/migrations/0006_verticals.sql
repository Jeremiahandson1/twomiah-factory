CREATE TABLE IF NOT EXISTS "activity_log" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"user_id" text,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"description" text,
	"metadata" json,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_photo" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"job_id" text NOT NULL,
	"uploaded_by_id" text,
	"url" text NOT NULL,
	"thumbnail_url" text,
	"caption" text,
	"taken_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portal_session" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"contact_id" text NOT NULL,
	"company_id" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "portal_session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "site" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"city" text,
	"state" text,
	"zip" text,
	"access_notes" text,
	"lawn_sqft" integer,
	"bed_sqft" integer,
	"hardscape_sqft" integer,
	"lot_sqft" integer,
	"driveway_sqft" integer,
	"measured_at" timestamp,
	"measurement_source" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL,
	"contact_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vehicle_trip" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"start_time" timestamp DEFAULT now() NOT NULL,
	"end_time" timestamp,
	"start_lat" real,
	"start_lng" real,
	"end_lat" real,
	"end_lng" real,
	"distance_miles" real,
	"purpose" text,
	"vehicle_id" text NOT NULL,
	"user_id" text,
	"company_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recurring_route" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"day_of_week" integer NOT NULL,
	"assigned_to_id" text,
	"estimated_hours" numeric(5, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recurring_route_stop" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"recurring_route_id" text NOT NULL,
	"site_id" text NOT NULL,
	"contact_id" text,
	"service_type" text DEFAULT 'mowing' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"estimated_minutes" integer DEFAULT 30 NOT NULL,
	"price_per_visit" numeric(12, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_rate" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"service_type" text NOT NULL,
	"area_field" text DEFAULT 'lawnSqft' NOT NULL,
	"rate_per_1000_sqft" numeric(12, 2) NOT NULL,
	"min_charge" numeric(12, 2) DEFAULT '0' NOT NULL,
	"unit_label" text DEFAULT 'per visit',
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "snow_contract" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"site_id" text NOT NULL,
	"contact_id" text,
	"billing_mode" text DEFAULT 'per_push' NOT NULL,
	"per_push_rate" numeric(12, 2) DEFAULT '0' NOT NULL,
	"per_event_rate" numeric(12, 2) DEFAULT '0' NOT NULL,
	"per_inch_rate" numeric(12, 2) DEFAULT '0' NOT NULL,
	"seasonal_rate" numeric(12, 2) DEFAULT '0' NOT NULL,
	"trigger_depth_inches" numeric(5, 2) DEFAULT '2' NOT NULL,
	"salt_rate" numeric(12, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "snow_event" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"snow_contract_id" text NOT NULL,
	"site_id" text NOT NULL,
	"serviced_at" timestamp DEFAULT now() NOT NULL,
	"pushes" integer DEFAULT 1 NOT NULL,
	"snowfall_inches" numeric(5, 2) DEFAULT '0' NOT NULL,
	"salt_applied" boolean DEFAULT false NOT NULL,
	"bill_below_trigger" boolean DEFAULT false NOT NULL,
	"billable_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"billing_mode" text NOT NULL,
	"invoice_id" text,
	"assigned_to_id" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "appointment" (
	"id" text PRIMARY KEY NOT NULL,
	"contact_id" text,
	"stylist_id" text,
	"stylist_member_id" text,
	"service_id" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"station" text,
	"start_time" timestamp NOT NULL,
	"end_time" timestamp,
	"checked_in_at" timestamp,
	"reminder_sent_at" timestamp,
	"reminder_notes" text,
	"quoted_price" numeric(10, 2),
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL,
	"patient_id" text,
	"owner_id" text,
	"provider_id" text,
	"type" text DEFAULT 'wellness' NOT NULL,
	"room" text,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_account_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"source" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"invoice_id" text,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_profile" (
	"id" text PRIMARY KEY NOT NULL,
	"contact_id" text NOT NULL,
	"preferred_stylist_id" text,
	"hair_type" text,
	"scalp_notes" text,
	"allergies" text,
	"patch_test_at" date,
	"preferences" text,
	"pronouns" text,
	"birthday" date,
	"notes" text,
	"formulas" json DEFAULT '[]'::json NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "membership_enrollment" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"credits_remaining" integer,
	"start_date" date,
	"renews_at" date,
	"last_billed_for" date,
	"last_invoice_id" text,
	"cancelled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "membership_plan" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price" numeric(10, 2),
	"billing_cycle" text DEFAULT 'monthly' NOT NULL,
	"credits_total" integer,
	"included_services" json DEFAULT '[]'::json NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_menu" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT 'hair' NOT NULL,
	"description" text,
	"duration_min" integer DEFAULT 60 NOT NULL,
	"price" numeric(10, 2),
	"price_is_from" boolean DEFAULT false NOT NULL,
	"rebook_interval_days" integer,
	"requires_patch_test" boolean DEFAULT false NOT NULL,
	"bookable_online" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_record" (
	"id" text PRIMARY KEY NOT NULL,
	"contact_id" text NOT NULL,
	"appointment_id" text,
	"stylist_id" text,
	"stylist_member_id" text,
	"service_id" text,
	"invoice_id" text,
	"performed_at" timestamp DEFAULT now() NOT NULL,
	"formula" json DEFAULT '[]'::json NOT NULL,
	"developer_volume" text,
	"processing_min" integer,
	"products_used" text,
	"result" text,
	"photo_before" text,
	"photo_after" text,
	"price_charged" numeric(10, 2),
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lab_result" (
	"id" text PRIMARY KEY NOT NULL,
	"patient_id" text NOT NULL,
	"visit_id" text,
	"test_name" text NOT NULL,
	"category" text,
	"result_date" date,
	"status" text DEFAULT 'final' NOT NULL,
	"results" json DEFAULT '{}'::json NOT NULL,
	"summary" text,
	"file_url" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "patient" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"species" text DEFAULT 'dog' NOT NULL,
	"breed" text,
	"sex" text,
	"spayed_neutered" boolean DEFAULT false NOT NULL,
	"dob" date,
	"weight_lb" numeric(6, 2),
	"color" text,
	"microchip" text,
	"blood_type" text,
	"insurance_provider" text,
	"insurance_policy" text,
	"allergies" text,
	"alerts" text,
	"rabies_tag" text,
	"photo" text,
	"deceased" boolean DEFAULT false NOT NULL,
	"deceased_date" date,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prescription" (
	"id" text PRIMARY KEY NOT NULL,
	"patient_id" text NOT NULL,
	"visit_id" text,
	"prescriber_id" text,
	"drug" text NOT NULL,
	"strength" text,
	"form" text,
	"sig" text,
	"quantity" text,
	"refills" integer DEFAULT 0 NOT NULL,
	"is_controlled" boolean DEFAULT false NOT NULL,
	"prescribed_date" timestamp DEFAULT now() NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vaccination" (
	"id" text PRIMARY KEY NOT NULL,
	"patient_id" text NOT NULL,
	"visit_id" text,
	"provider_id" text,
	"vaccine" text NOT NULL,
	"manufacturer" text,
	"lot_number" text,
	"serial_number" text,
	"site" text,
	"route" text,
	"given_date" date NOT NULL,
	"due_date" date,
	"is_rabies" boolean DEFAULT false NOT NULL,
	"rabies_tag" text,
	"notes" text,
	"last_reminded_at" timestamp,
	"reminder_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "visit" (
	"id" text PRIMARY KEY NOT NULL,
	"patient_id" text NOT NULL,
	"appointment_id" text,
	"provider_id" text,
	"visit_date" timestamp DEFAULT now() NOT NULL,
	"reason" text,
	"weight_lb" numeric(6, 2),
	"temperature_f" numeric(5, 2),
	"heart_rate" integer,
	"resp_rate" integer,
	"subjective" text,
	"objective" text,
	"assessment" text,
	"plan" text,
	"diagnoses" json DEFAULT '[]'::json NOT NULL,
	"treatments" text,
	"notes" text,
	"total" numeric(10, 2),
	"invoice_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wellness_enrollment" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"patient_id" text NOT NULL,
	"owner_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"billing_cycle" text DEFAULT 'monthly' NOT NULL,
	"start_date" date,
	"renews_at" date,
	"last_billed_for" date,
	"last_invoice_id" text,
	"cancelled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wellness_plan" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"species" text,
	"monthly_price" numeric(8, 2),
	"annual_price" numeric(8, 2),
	"benefits" json DEFAULT '[]'::json NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "catalog_part" (
	"id" text PRIMARY KEY NOT NULL,
	"part_number" text NOT NULL,
	"name" text NOT NULL,
	"oem" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'Parts' NOT NULL,
	"price" numeric(10, 2) DEFAULT '0' NOT NULL,
	"cost" numeric(10, 2),
	"msrp" numeric(10, 2),
	"availability" text DEFAULT 'Order from OEM' NOT NULL,
	"superseded_by" text,
	"fitment" text,
	"diagram" text,
	"source" text DEFAULT 'import' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rental_reservation" (
	"id" text PRIMARY KEY NOT NULL,
	"unit_label" text NOT NULL,
	"customer_name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"days" integer NOT NULL,
	"daily_rate" numeric(10, 2) NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"unit_id" text,
	"contact_id" text,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "repair_order" (
	"id" text PRIMARY KEY NOT NULL,
	"ro_number" text,
	"write_up_date" timestamp DEFAULT now() NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"customer_unit_info" json,
	"services" json DEFAULT '[]'::json NOT NULL,
	"advisor_name" text,
	"estimated_total" numeric(10, 2),
	"actual_total" numeric(10, 2),
	"notes" text,
	"completed_at" timestamp,
	"invoice_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"customer_id" text NOT NULL,
	"unit_id" text,
	"technician_id" text,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_lead" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text,
	"stage" text DEFAULT 'new' NOT NULL,
	"notes" text,
	"trade_in_info" json,
	"deal" json,
	"follow_up_date" timestamp,
	"closed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"contact_id" text NOT NULL,
	"unit_id" text,
	"assigned_to" text,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_sales_alert" (
	"id" text PRIMARY KEY NOT NULL,
	"alert_message" text,
	"alerted_at" timestamp DEFAULT now() NOT NULL,
	"dismissed_at" timestamp,
	"converted_to_lead" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"repair_order_id" text NOT NULL,
	"sales_lead_id" text,
	"salesperson_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "unit" (
	"id" text PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"condition" text DEFAULT 'new' NOT NULL,
	"stock_number" text,
	"vin" text,
	"year" integer,
	"make" text,
	"model_name" text,
	"trim" text,
	"status" text DEFAULT 'available' NOT NULL,
	"msrp" numeric(10, 2),
	"listed_price" numeric(10, 2),
	"internet_price" numeric(10, 2),
	"cost" numeric(10, 2),
	"photos" json DEFAULT '[]'::json NOT NULL,
	"floorplan_img" text,
	"description" text,
	"features" json DEFAULT '[]'::json NOT NULL,
	"exterior_color" text,
	"interior_color" text,
	"rv_class" text,
	"towable_type" text,
	"length_ft" numeric(5, 1),
	"sleeps" integer,
	"slide_outs" integer,
	"gvwr" integer,
	"dry_weight" integer,
	"hitch_weight" integer,
	"chassis" text,
	"fresh_tank_gal" integer,
	"grey_tank_gal" integer,
	"black_tank_gal" integer,
	"generator_hours" integer,
	"awnings" integer,
	"fuel_type" text,
	"engine" text,
	"engine_cc" integer,
	"mileage" integer,
	"hours" integer,
	"transmission" text,
	"drivetrain" text,
	"hin" text,
	"beam_ft" numeric(5, 1),
	"draft_ft" numeric(5, 1),
	"hull_material" text,
	"engine_type" text,
	"engine_count" integer,
	"engine_hp" integer,
	"fuel_capacity_gal" integer,
	"max_persons" integer,
	"trailer_included" boolean,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "event" (
	"id" text PRIMARY KEY NOT NULL,
	"contact_id" text,
	"space_id" text,
	"coordinator_id" text,
	"name" text NOT NULL,
	"event_type" text DEFAULT 'private_dining' NOT NULL,
	"status" text DEFAULT 'enquiry' NOT NULL,
	"event_date" date NOT NULL,
	"start_time" text,
	"end_time" text,
	"guest_count" integer,
	"guest_count_final" integer,
	"quoted_total" numeric(10, 2),
	"deposit_required" numeric(10, 2),
	"source" text,
	"lost_reason" text,
	"dietary_requirements" text,
	"setup_notes" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "event_menu_item" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"package_id" text,
	"name" text NOT NULL,
	"per_person" boolean DEFAULT true NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price" numeric(10, 2),
	"notes" text,
	"space_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "event_payment" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"label" text NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"due_date" date,
	"paid_at" timestamp,
	"method" text,
	"reference" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "event_space" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"seated_capacity" integer,
	"standing_capacity" integer,
	"minimum_spend" numeric(10, 2),
	"hire_fee" numeric(10, 2),
	"amenities" json DEFAULT '[]'::json NOT NULL,
	"photo" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "event_timeline" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"time" text NOT NULL,
	"title" text NOT NULL,
	"department" text DEFAULT 'floor' NOT NULL,
	"details" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "menu_package" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text DEFAULT 'dinner' NOT NULL,
	"price_per_person" numeric(10, 2),
	"min_guests" integer,
	"courses" json DEFAULT '[]'::json NOT NULL,
	"dietary_notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_check" (
	"id" text PRIMARY KEY NOT NULL,
	"number" integer NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"spot" text,
	"note" text,
	"contact_id" text,
	"status" text DEFAULT 'open' NOT NULL,
	"void_reason" text,
	"split_from_id" text,
	"subtotal_cents" integer,
	"tax_cents" integer,
	"total_cents" integer,
	"tip_cents" integer,
	"tax_rate_bps" integer,
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"opened_by_id" text,
	"opened_by_name" text,
	"closed_at" timestamp,
	"closed_by_id" text,
	"closed_by_name" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_check_item" (
	"id" text PRIMARY KEY NOT NULL,
	"check_id" text NOT NULL,
	"menu_item_id" text,
	"tap_id" text,
	"stock_item_id" text,
	"stock_qty" numeric(10, 3),
	"name" text NOT NULL,
	"size" text,
	"qty" integer DEFAULT 1 NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"note" text,
	"seat" integer,
	"to_kitchen" boolean DEFAULT true NOT NULL,
	"kind" text DEFAULT 'item' NOT NULL,
	"state" text DEFAULT 'held' NOT NULL,
	"ticket_id" text,
	"gift_card_id" text,
	"void_reason" text,
	"voided_by_name" text,
	"added_by_id" text,
	"added_by_name" text,
	"added_at" timestamp DEFAULT now() NOT NULL,
	"sent_at" timestamp,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_check_payment" (
	"id" text PRIMARY KEY NOT NULL,
	"check_id" text NOT NULL,
	"tender" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"tip_cents" integer DEFAULT 0 NOT NULL,
	"cash_tendered_cents" integer,
	"change_cents" integer,
	"provider_payment_id" text,
	"gift_card_id" text,
	"taken_by_id" text,
	"taken_by_name" text,
	"taken_at" timestamp DEFAULT now() NOT NULL,
	"voided_at" timestamp,
	"void_reason" text,
	"voided_by_name" text,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_closeout" (
	"id" text PRIMARY KEY NOT NULL,
	"business_day" text NOT NULL,
	"cash_expected_cents" integer NOT NULL,
	"cash_counted_cents" integer,
	"float_cents" integer DEFAULT 0 NOT NULL,
	"over_short_cents" integer,
	"note" text,
	"summary" json NOT NULL,
	"closed_by_id" text,
	"closed_by_name" text,
	"closed_at" timestamp DEFAULT now() NOT NULL,
	"emailed_at" timestamp,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_event" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"starts_at" timestamp NOT NULL,
	"ends_at" timestamp,
	"image_url" text,
	"is_recurring" boolean DEFAULT false NOT NULL,
	"recurrence_days" text,
	"is_published" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_game" (
	"id" text PRIMARY KEY NOT NULL,
	"league" text NOT NULL,
	"home" text NOT NULL,
	"away" text NOT NULL,
	"starts_at" timestamp NOT NULL,
	"is_featured" boolean DEFAULT false NOT NULL,
	"note" text,
	"bar_hours" json,
	"kitchen_hours" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_gift_card" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"initial_cents" integer NOT NULL,
	"balance_cents" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"sold_via" text NOT NULL,
	"sold_by_name" text,
	"check_id" text,
	"purchaser_name" text,
	"purchaser_email" text,
	"recipient_name" text,
	"recipient_email" text,
	"message" text,
	"provider_payment_id" text,
	"idempotency_key" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"voided_at" timestamp,
	"void_reason" text,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_gift_card_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"card_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"kind" text NOT NULL,
	"check_id" text,
	"payment_id" text,
	"by_name" text,
	"note" text,
	"at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_kitchen_ticket" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"source" text NOT NULL,
	"note" text,
	"check_id" text,
	"fired_at" timestamp DEFAULT now() NOT NULL,
	"fired_by_name" text,
	"bumped_at" timestamp,
	"bumped_by_name" text,
	"recalled_at" timestamp,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_kitchen_ticket_item" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"menu_item_id" text,
	"name" text NOT NULL,
	"variation" text,
	"qty" integer DEFAULT 1 NOT NULL,
	"note" text,
	"seat" integer,
	"prep_seconds" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_menu_item" (
	"id" text PRIMARY KEY NOT NULL,
	"section_id" text,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_cents" integer,
	"price_label" text,
	"dietary" json DEFAULT '[]'::json NOT NULL,
	"image_url" text,
	"hero_image_url" text,
	"story" text,
	"is_signature" boolean DEFAULT false NOT NULL,
	"is_86ed" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"variations" json DEFAULT '[]'::json NOT NULL,
	"to_kitchen" boolean,
	"prep_seconds" integer,
	"learned_prep_seconds" integer,
	"learned_samples" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_menu_section" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"kind" text DEFAULT 'food' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_purchase_order" (
	"id" text PRIMARY KEY NOT NULL,
	"number" integer NOT NULL,
	"vendor_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by_name" text,
	"sent_at" timestamp,
	"received_at" timestamp,
	"received_by_name" text,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_purchase_order_line" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"stock_item_id" text NOT NULL,
	"packs" numeric(10, 2) NOT NULL,
	"pack_cost_cents" integer,
	"received_packs" numeric(10, 2),
	"received_cost_cents" integer,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_recipe_line" (
	"id" text PRIMARY KEY NOT NULL,
	"menu_item_id" text NOT NULL,
	"size_id" text,
	"stock_item_id" text NOT NULL,
	"qty" numeric(10, 3) NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_schedule_shift" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"day" text NOT NULL,
	"start" text NOT NULL,
	"end" text NOT NULL,
	"position" text,
	"note" text,
	"created_by_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_schedule_week" (
	"id" text PRIMARY KEY NOT NULL,
	"week_start" text NOT NULL,
	"published_at" timestamp,
	"published_by_name" text,
	"snapshot" json,
	"changed_at" timestamp,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"hours" json DEFAULT '{}'::json NOT NULL,
	"speakeasy_password_hash" text,
	"speakeasy_note" text,
	"check_seq" integer DEFAULT 0 NOT NULL,
	"ticket_warn_seconds" integer DEFAULT 600 NOT NULL,
	"ticket_late_seconds" integer DEFAULT 900 NOT NULL,
	"default_prep_seconds" integer DEFAULT 480 NOT NULL,
	"gift_card_prefix" text,
	"po_seq" integer DEFAULT 0 NOT NULL,
	"floor" json,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_special" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"price_cents" integer,
	"starts_at" timestamp NOT NULL,
	"ends_at" timestamp,
	"is_recurring" boolean DEFAULT false NOT NULL,
	"recurrence_days" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_status" (
	"id" text PRIMARY KEY NOT NULL,
	"kitchen_open" boolean,
	"kitchen_closes_at" timestamp,
	"bar_open" boolean,
	"bar_closes_at" timestamp,
	"override_until" timestamp,
	"room_status" text DEFAULT 'quiet' NOT NULL,
	"note" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by_id" text,
	"updated_by_name" text,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_stock_count" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"started_by_name" text,
	"finished_at" timestamp,
	"finished_by_name" text,
	"note" text,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_stock_count_line" (
	"id" text PRIMARY KEY NOT NULL,
	"count_id" text NOT NULL,
	"stock_item_id" text NOT NULL,
	"qty" numeric(12, 3) NOT NULL,
	"counted_by_name" text,
	"counted_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_stock_item" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT 'food' NOT NULL,
	"unit" text DEFAULT 'each' NOT NULL,
	"pack_name" text DEFAULT 'each' NOT NULL,
	"pack_size" numeric(12, 3) DEFAULT '1' NOT NULL,
	"pack_cost_cents" integer,
	"vendor_id" text,
	"par_packs" numeric(10, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_tap" (
	"id" text PRIMARY KEY NOT NULL,
	"line_number" integer NOT NULL,
	"beer_name" text NOT NULL,
	"brewery" text,
	"style" text,
	"abv" numeric(4, 1),
	"origin_country" text,
	"description" text,
	"badge" text,
	"price_cents" integer,
	"status" text DEFAULT 'pouring' NOT NULL,
	"stock_item_id" text,
	"pour_oz" numeric(6, 2) DEFAULT '16' NOT NULL,
	"sizes" json DEFAULT '[]'::json NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"tapped_at" timestamp,
	"blown_at" timestamp,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_time_off" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"day" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by_name" text,
	"decided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_vendor" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"contact_name" text,
	"phone" text,
	"email" text,
	"order_days" text,
	"note" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "loyalty_members" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"points_balance" integer DEFAULT 0 NOT NULL,
	"lifetime_points" integer DEFAULT 0 NOT NULL,
	"qualifying_visits" integer DEFAULT 0 NOT NULL,
	"punch_rewards_earned" integer DEFAULT 0 NOT NULL,
	"joined_at" timestamp DEFAULT now(),
	"last_activity_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "loyalty_rewards" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"points_cost" integer DEFAULT 0 NOT NULL,
	"type" text DEFAULT 'fixed' NOT NULL,
	"value_cents" integer DEFAULT 0 NOT NULL,
	"menu_item_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"service_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "loyalty_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"member_id" text NOT NULL,
	"type" text NOT NULL,
	"points" integer NOT NULL,
	"balance_after" integer,
	"description" text,
	"check_id" text,
	"earn_check_id" text,
	"reward_id" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"appointment_id" text,
	"invoice_id" text
);
--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "feed_token" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "last_reminded_at" timestamp;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "patient_id" text;--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "location_id" text;--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "site_id" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "job_id" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "event_id" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "appointment_id" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "patient_id" text;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "job_type" text DEFAULT 'service' NOT NULL;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "equipment_id" text;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "site_id" text;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "service_agreement_id" text;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "tip_amount" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "customer_message" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "declined_at" timestamp;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "site_id" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "equipment_id" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "converted_to_job_id" text;--> statement-breakpoint
ALTER TABLE "service_agreement" ADD COLUMN "recurrence_rule" json;--> statement-breakpoint
ALTER TABLE "service_agreement" ADD COLUMN "next_service_date" timestamp;--> statement-breakpoint
ALTER TABLE "service_agreement" ADD COLUMN "auto_schedule" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "service_agreement" ADD COLUMN "reminder_days_before" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "service_agreement" ADD COLUMN "last_generated_job_id" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "pin_hash" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_photo" ADD CONSTRAINT "job_photo_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_photo" ADD CONSTRAINT "job_photo_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_photo" ADD CONSTRAINT "job_photo_uploaded_by_id_user_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "portal_session" ADD CONSTRAINT "portal_session_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "portal_session" ADD CONSTRAINT "portal_session_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "site" ADD CONSTRAINT "site_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "site" ADD CONSTRAINT "site_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vehicle_trip" ADD CONSTRAINT "vehicle_trip_vehicle_id_vehicle_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicle"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vehicle_trip" ADD CONSTRAINT "vehicle_trip_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vehicle_trip" ADD CONSTRAINT "vehicle_trip_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recurring_route" ADD CONSTRAINT "recurring_route_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recurring_route" ADD CONSTRAINT "recurring_route_assigned_to_id_user_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recurring_route_stop" ADD CONSTRAINT "recurring_route_stop_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recurring_route_stop" ADD CONSTRAINT "recurring_route_stop_recurring_route_id_recurring_route_id_fk" FOREIGN KEY ("recurring_route_id") REFERENCES "public"."recurring_route"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recurring_route_stop" ADD CONSTRAINT "recurring_route_stop_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recurring_route_stop" ADD CONSTRAINT "recurring_route_stop_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_rate" ADD CONSTRAINT "service_rate_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "snow_contract" ADD CONSTRAINT "snow_contract_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "snow_contract" ADD CONSTRAINT "snow_contract_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "snow_contract" ADD CONSTRAINT "snow_contract_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "snow_event" ADD CONSTRAINT "snow_event_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "snow_event" ADD CONSTRAINT "snow_event_snow_contract_id_snow_contract_id_fk" FOREIGN KEY ("snow_contract_id") REFERENCES "public"."snow_contract"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "snow_event" ADD CONSTRAINT "snow_event_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "snow_event" ADD CONSTRAINT "snow_event_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "snow_event" ADD CONSTRAINT "snow_event_assigned_to_id_user_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointment" ADD CONSTRAINT "appointment_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointment" ADD CONSTRAINT "appointment_stylist_id_user_id_fk" FOREIGN KEY ("stylist_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointment" ADD CONSTRAINT "appointment_stylist_member_id_team_member_id_fk" FOREIGN KEY ("stylist_member_id") REFERENCES "public"."team_member"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointment" ADD CONSTRAINT "appointment_service_id_service_menu_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service_menu"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointment" ADD CONSTRAINT "appointment_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointment" ADD CONSTRAINT "appointment_patient_id_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patient"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointment" ADD CONSTRAINT "appointment_owner_id_contact_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointment" ADD CONSTRAINT "appointment_provider_id_user_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_account_entry" ADD CONSTRAINT "client_account_entry_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_account_entry" ADD CONSTRAINT "client_account_entry_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_account_entry" ADD CONSTRAINT "client_account_entry_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_account_entry" ADD CONSTRAINT "client_account_entry_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_profile" ADD CONSTRAINT "client_profile_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_profile" ADD CONSTRAINT "client_profile_preferred_stylist_id_user_id_fk" FOREIGN KEY ("preferred_stylist_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_profile" ADD CONSTRAINT "client_profile_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "membership_enrollment" ADD CONSTRAINT "membership_enrollment_plan_id_membership_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."membership_plan"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "membership_enrollment" ADD CONSTRAINT "membership_enrollment_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "membership_enrollment" ADD CONSTRAINT "membership_enrollment_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "membership_plan" ADD CONSTRAINT "membership_plan_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_menu" ADD CONSTRAINT "service_menu_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_record" ADD CONSTRAINT "service_record_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_record" ADD CONSTRAINT "service_record_appointment_id_appointment_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointment"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_record" ADD CONSTRAINT "service_record_stylist_id_user_id_fk" FOREIGN KEY ("stylist_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_record" ADD CONSTRAINT "service_record_stylist_member_id_team_member_id_fk" FOREIGN KEY ("stylist_member_id") REFERENCES "public"."team_member"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_record" ADD CONSTRAINT "service_record_service_id_service_menu_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service_menu"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_record" ADD CONSTRAINT "service_record_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lab_result" ADD CONSTRAINT "lab_result_patient_id_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patient"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lab_result" ADD CONSTRAINT "lab_result_visit_id_visit_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visit"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lab_result" ADD CONSTRAINT "lab_result_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "patient" ADD CONSTRAINT "patient_owner_id_contact_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "patient" ADD CONSTRAINT "patient_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prescription" ADD CONSTRAINT "prescription_patient_id_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patient"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prescription" ADD CONSTRAINT "prescription_visit_id_visit_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visit"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prescription" ADD CONSTRAINT "prescription_prescriber_id_user_id_fk" FOREIGN KEY ("prescriber_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prescription" ADD CONSTRAINT "prescription_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vaccination" ADD CONSTRAINT "vaccination_patient_id_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patient"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vaccination" ADD CONSTRAINT "vaccination_visit_id_visit_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visit"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vaccination" ADD CONSTRAINT "vaccination_provider_id_user_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vaccination" ADD CONSTRAINT "vaccination_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit" ADD CONSTRAINT "visit_patient_id_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patient"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit" ADD CONSTRAINT "visit_appointment_id_appointment_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointment"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit" ADD CONSTRAINT "visit_provider_id_user_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit" ADD CONSTRAINT "visit_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wellness_enrollment" ADD CONSTRAINT "wellness_enrollment_plan_id_wellness_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."wellness_plan"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wellness_enrollment" ADD CONSTRAINT "wellness_enrollment_patient_id_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patient"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wellness_enrollment" ADD CONSTRAINT "wellness_enrollment_owner_id_contact_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wellness_enrollment" ADD CONSTRAINT "wellness_enrollment_last_invoice_id_invoice_id_fk" FOREIGN KEY ("last_invoice_id") REFERENCES "public"."invoice"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wellness_enrollment" ADD CONSTRAINT "wellness_enrollment_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wellness_plan" ADD CONSTRAINT "wellness_plan_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "catalog_part" ADD CONSTRAINT "catalog_part_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rental_reservation" ADD CONSTRAINT "rental_reservation_unit_id_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."unit"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rental_reservation" ADD CONSTRAINT "rental_reservation_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rental_reservation" ADD CONSTRAINT "rental_reservation_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repair_order" ADD CONSTRAINT "repair_order_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repair_order" ADD CONSTRAINT "repair_order_customer_id_contact_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repair_order" ADD CONSTRAINT "repair_order_unit_id_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."unit"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repair_order" ADD CONSTRAINT "repair_order_technician_id_user_id_fk" FOREIGN KEY ("technician_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repair_order" ADD CONSTRAINT "repair_order_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sales_lead" ADD CONSTRAINT "sales_lead_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sales_lead" ADD CONSTRAINT "sales_lead_unit_id_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."unit"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sales_lead" ADD CONSTRAINT "sales_lead_assigned_to_user_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sales_lead" ADD CONSTRAINT "sales_lead_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_sales_alert" ADD CONSTRAINT "service_sales_alert_repair_order_id_repair_order_id_fk" FOREIGN KEY ("repair_order_id") REFERENCES "public"."repair_order"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_sales_alert" ADD CONSTRAINT "service_sales_alert_sales_lead_id_sales_lead_id_fk" FOREIGN KEY ("sales_lead_id") REFERENCES "public"."sales_lead"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_sales_alert" ADD CONSTRAINT "service_sales_alert_salesperson_id_user_id_fk" FOREIGN KEY ("salesperson_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_sales_alert" ADD CONSTRAINT "service_sales_alert_customer_id_contact_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_sales_alert" ADD CONSTRAINT "service_sales_alert_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "unit" ADD CONSTRAINT "unit_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event" ADD CONSTRAINT "event_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event" ADD CONSTRAINT "event_space_id_event_space_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."event_space"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event" ADD CONSTRAINT "event_coordinator_id_user_id_fk" FOREIGN KEY ("coordinator_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event" ADD CONSTRAINT "event_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_menu_item" ADD CONSTRAINT "event_menu_item_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_menu_item" ADD CONSTRAINT "event_menu_item_package_id_menu_package_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."menu_package"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_menu_item" ADD CONSTRAINT "event_menu_item_space_id_event_space_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."event_space"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_menu_item" ADD CONSTRAINT "event_menu_item_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_payment" ADD CONSTRAINT "event_payment_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_payment" ADD CONSTRAINT "event_payment_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_space" ADD CONSTRAINT "event_space_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_timeline" ADD CONSTRAINT "event_timeline_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_timeline" ADD CONSTRAINT "event_timeline_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "menu_package" ADD CONSTRAINT "menu_package_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_check" ADD CONSTRAINT "bar_check_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_check" ADD CONSTRAINT "bar_check_opened_by_id_user_id_fk" FOREIGN KEY ("opened_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_check" ADD CONSTRAINT "bar_check_closed_by_id_user_id_fk" FOREIGN KEY ("closed_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_check" ADD CONSTRAINT "bar_check_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_check_item" ADD CONSTRAINT "bar_check_item_check_id_bar_check_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."bar_check"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_check_item" ADD CONSTRAINT "bar_check_item_menu_item_id_bar_menu_item_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."bar_menu_item"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_check_item" ADD CONSTRAINT "bar_check_item_tap_id_bar_tap_id_fk" FOREIGN KEY ("tap_id") REFERENCES "public"."bar_tap"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_check_item" ADD CONSTRAINT "bar_check_item_added_by_id_user_id_fk" FOREIGN KEY ("added_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_check_item" ADD CONSTRAINT "bar_check_item_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_check_payment" ADD CONSTRAINT "bar_check_payment_check_id_bar_check_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."bar_check"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_check_payment" ADD CONSTRAINT "bar_check_payment_taken_by_id_user_id_fk" FOREIGN KEY ("taken_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_check_payment" ADD CONSTRAINT "bar_check_payment_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_closeout" ADD CONSTRAINT "bar_closeout_closed_by_id_user_id_fk" FOREIGN KEY ("closed_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_closeout" ADD CONSTRAINT "bar_closeout_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_event" ADD CONSTRAINT "bar_event_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_game" ADD CONSTRAINT "bar_game_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_gift_card" ADD CONSTRAINT "bar_gift_card_check_id_bar_check_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."bar_check"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_gift_card" ADD CONSTRAINT "bar_gift_card_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_gift_card_ledger" ADD CONSTRAINT "bar_gift_card_ledger_card_id_bar_gift_card_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."bar_gift_card"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_gift_card_ledger" ADD CONSTRAINT "bar_gift_card_ledger_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_kitchen_ticket" ADD CONSTRAINT "bar_kitchen_ticket_check_id_bar_check_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."bar_check"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_kitchen_ticket" ADD CONSTRAINT "bar_kitchen_ticket_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_kitchen_ticket_item" ADD CONSTRAINT "bar_kitchen_ticket_item_ticket_id_bar_kitchen_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."bar_kitchen_ticket"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_kitchen_ticket_item" ADD CONSTRAINT "bar_kitchen_ticket_item_menu_item_id_bar_menu_item_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."bar_menu_item"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_kitchen_ticket_item" ADD CONSTRAINT "bar_kitchen_ticket_item_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_menu_item" ADD CONSTRAINT "bar_menu_item_section_id_bar_menu_section_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."bar_menu_section"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_menu_item" ADD CONSTRAINT "bar_menu_item_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_menu_section" ADD CONSTRAINT "bar_menu_section_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_purchase_order" ADD CONSTRAINT "bar_purchase_order_vendor_id_bar_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."bar_vendor"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_purchase_order" ADD CONSTRAINT "bar_purchase_order_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_purchase_order_line" ADD CONSTRAINT "bar_purchase_order_line_order_id_bar_purchase_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."bar_purchase_order"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_purchase_order_line" ADD CONSTRAINT "bar_purchase_order_line_stock_item_id_bar_stock_item_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "public"."bar_stock_item"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_purchase_order_line" ADD CONSTRAINT "bar_purchase_order_line_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_recipe_line" ADD CONSTRAINT "bar_recipe_line_menu_item_id_bar_menu_item_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."bar_menu_item"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_recipe_line" ADD CONSTRAINT "bar_recipe_line_stock_item_id_bar_stock_item_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "public"."bar_stock_item"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_recipe_line" ADD CONSTRAINT "bar_recipe_line_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_schedule_shift" ADD CONSTRAINT "bar_schedule_shift_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_schedule_shift" ADD CONSTRAINT "bar_schedule_shift_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_schedule_week" ADD CONSTRAINT "bar_schedule_week_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_settings" ADD CONSTRAINT "bar_settings_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_special" ADD CONSTRAINT "bar_special_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_special" ADD CONSTRAINT "bar_special_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_status" ADD CONSTRAINT "bar_status_updated_by_id_user_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_status" ADD CONSTRAINT "bar_status_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_stock_count" ADD CONSTRAINT "bar_stock_count_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_stock_count_line" ADD CONSTRAINT "bar_stock_count_line_count_id_bar_stock_count_id_fk" FOREIGN KEY ("count_id") REFERENCES "public"."bar_stock_count"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_stock_count_line" ADD CONSTRAINT "bar_stock_count_line_stock_item_id_bar_stock_item_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "public"."bar_stock_item"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_stock_count_line" ADD CONSTRAINT "bar_stock_count_line_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_stock_item" ADD CONSTRAINT "bar_stock_item_vendor_id_bar_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."bar_vendor"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_stock_item" ADD CONSTRAINT "bar_stock_item_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_tap" ADD CONSTRAINT "bar_tap_stock_item_id_bar_stock_item_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "public"."bar_stock_item"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_tap" ADD CONSTRAINT "bar_tap_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_time_off" ADD CONSTRAINT "bar_time_off_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_time_off" ADD CONSTRAINT "bar_time_off_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_vendor" ADD CONSTRAINT "bar_vendor_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "loyalty_members" ADD CONSTRAINT "loyalty_members_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "loyalty_members" ADD CONSTRAINT "loyalty_members_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "loyalty_rewards" ADD CONSTRAINT "loyalty_rewards_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "loyalty_rewards" ADD CONSTRAINT "loyalty_rewards_menu_item_id_bar_menu_item_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."bar_menu_item"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "loyalty_rewards" ADD CONSTRAINT "loyalty_rewards_service_id_service_menu_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service_menu"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_member_id_loyalty_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."loyalty_members"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_log_company_id_idx" ON "activity_log" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_log_entity_type_entity_id_idx" ON "activity_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_photo_company_id_idx" ON "job_photo" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_photo_job_id_idx" ON "job_photo" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_session_token_idx" ON "portal_session" USING btree ("token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_session_contact_id_idx" ON "portal_session" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_company_id_idx" ON "site" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_contact_id_idx" ON "site" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vehicle_trip_company_id_status_idx" ON "vehicle_trip" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vehicle_trip_vehicle_id_idx" ON "vehicle_trip" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recurring_route_company_id_idx" ON "recurring_route" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recurring_route_day_of_week_idx" ON "recurring_route" USING btree ("day_of_week");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recurring_route_stop_route_id_idx" ON "recurring_route_stop" USING btree ("recurring_route_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recurring_route_stop_company_id_idx" ON "recurring_route_stop" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_rate_company_id_idx" ON "service_rate" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_rate_service_type_idx" ON "service_rate" USING btree ("service_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "snow_contract_company_id_idx" ON "snow_contract" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "snow_contract_site_id_idx" ON "snow_contract" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "snow_contract_status_idx" ON "snow_contract" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "snow_event_company_id_idx" ON "snow_event" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "snow_event_contract_id_idx" ON "snow_event" USING btree ("snow_contract_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "snow_event_serviced_at_idx" ON "snow_event" USING btree ("serviced_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointment_company_id_idx" ON "appointment" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointment_contact_id_idx" ON "appointment" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointment_start_idx" ON "appointment" USING btree ("start_time");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_account_entry_client_idx" ON "client_account_entry" USING btree ("company_id","contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_account_entry_invoice_idx" ON "client_account_entry" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_profile_company_id_idx" ON "client_profile" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "client_profile_contact_id_key" ON "client_profile" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "membership_enrollment_company_id_idx" ON "membership_enrollment" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "membership_enrollment_contact_id_idx" ON "membership_enrollment" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "membership_enrollment_renews_at_idx" ON "membership_enrollment" USING btree ("renews_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "membership_plan_company_id_idx" ON "membership_plan" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_menu_company_id_idx" ON "service_menu" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_record_company_id_idx" ON "service_record" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_record_contact_id_idx" ON "service_record" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_record_performed_idx" ON "service_record" USING btree ("performed_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "service_record_appointment_unique" ON "service_record" USING btree ("company_id","appointment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lab_result_company_id_idx" ON "lab_result" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lab_result_patient_id_idx" ON "lab_result" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "patient_company_id_idx" ON "patient" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "patient_owner_id_idx" ON "patient" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prescription_company_id_idx" ON "prescription" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prescription_patient_id_idx" ON "prescription" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vaccination_company_id_idx" ON "vaccination" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vaccination_patient_id_idx" ON "vaccination" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vaccination_due_idx" ON "vaccination" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_company_id_idx" ON "visit" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_patient_id_idx" ON "visit" USING btree ("patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "visit_invoice_id_unique_idx" ON "visit" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wellness_enrollment_company_id_idx" ON "wellness_enrollment" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wellness_enrollment_patient_id_idx" ON "wellness_enrollment" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wellness_plan_company_id_idx" ON "wellness_plan" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "catalog_part_company_pn_oem_key" ON "catalog_part" USING btree ("company_id","part_number","oem");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalog_part_company_oem_idx" ON "catalog_part" USING btree ("company_id","oem");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rental_reservation_company_id_idx" ON "rental_reservation" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rental_reservation_unit_id_start_date_idx" ON "rental_reservation" USING btree ("unit_id","start_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repair_order_company_id_idx" ON "repair_order" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repair_order_status_idx" ON "repair_order" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repair_order_customer_id_idx" ON "repair_order" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "repair_order_ro_number_company_id_key" ON "repair_order" USING btree ("ro_number","company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_lead_company_id_idx" ON "sales_lead" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_lead_stage_idx" ON "sales_lead" USING btree ("stage");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_lead_assigned_to_idx" ON "sales_lead" USING btree ("assigned_to");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_lead_contact_id_idx" ON "sales_lead" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_sales_alert_company_id_idx" ON "service_sales_alert" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_sales_alert_salesperson_id_idx" ON "service_sales_alert" USING btree ("salesperson_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_sales_alert_dismissed_at_idx" ON "service_sales_alert" USING btree ("dismissed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "unit_company_id_idx" ON "unit" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "unit_status_idx" ON "unit" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "unit_category_idx" ON "unit" USING btree ("category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "unit_make_idx" ON "unit" USING btree ("make");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unit_vin_company_id_key" ON "unit" USING btree ("vin","company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_company_id_idx" ON "event" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_contact_id_idx" ON "event" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_date_idx" ON "event" USING btree ("event_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_status_idx" ON "event" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_menu_item_company_id_idx" ON "event_menu_item" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_menu_item_event_id_idx" ON "event_menu_item" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_payment_company_id_idx" ON "event_payment" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_payment_event_id_idx" ON "event_payment" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_payment_due_idx" ON "event_payment" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_space_company_id_idx" ON "event_space" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_timeline_company_id_idx" ON "event_timeline" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_timeline_event_id_idx" ON "event_timeline" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "menu_package_company_id_idx" ON "menu_package" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bar_check_company_number_key" ON "bar_check" USING btree ("company_id","number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_check_company_status_idx" ON "bar_check" USING btree ("company_id","status","opened_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_check_company_closed_idx" ON "bar_check" USING btree ("company_id","closed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_check_item_check_idx" ON "bar_check_item" USING btree ("check_id","added_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_check_payment_check_idx" ON "bar_check_payment" USING btree ("check_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_check_payment_company_taken_idx" ON "bar_check_payment" USING btree ("company_id","taken_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_closeout_company_day_idx" ON "bar_closeout" USING btree ("company_id","business_day");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bar_event_company_slug_key" ON "bar_event" USING btree ("company_id","slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_event_company_idx" ON "bar_event" USING btree ("company_id","is_published","starts_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_game_company_idx" ON "bar_game" USING btree ("company_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bar_gift_card_company_code_key" ON "bar_gift_card" USING btree ("company_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bar_gift_card_company_key_key" ON "bar_gift_card" USING btree ("company_id","idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_gift_card_ledger_card_idx" ON "bar_gift_card_ledger" USING btree ("card_id","at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_kitchen_ticket_company_open_idx" ON "bar_kitchen_ticket" USING btree ("company_id","bumped_at","fired_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_kitchen_ticket_item_ticket_idx" ON "bar_kitchen_ticket_item" USING btree ("ticket_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bar_menu_item_company_slug_key" ON "bar_menu_item" USING btree ("company_id","slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_menu_item_section_idx" ON "bar_menu_item" USING btree ("section_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bar_menu_section_company_slug_key" ON "bar_menu_section" USING btree ("company_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bar_purchase_order_company_number_key" ON "bar_purchase_order" USING btree ("company_id","number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_purchase_order_line_order_idx" ON "bar_purchase_order_line" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_recipe_line_item_idx" ON "bar_recipe_line" USING btree ("menu_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_schedule_shift_company_day_idx" ON "bar_schedule_shift" USING btree ("company_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bar_schedule_week_company_week_key" ON "bar_schedule_week" USING btree ("company_id","week_start");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bar_settings_company_key" ON "bar_settings" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_special_company_idx" ON "bar_special" USING btree ("company_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bar_status_company_key" ON "bar_status" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_stock_count_company_idx" ON "bar_stock_count" USING btree ("company_id","status","finished_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bar_stock_count_line_key" ON "bar_stock_count_line" USING btree ("count_id","stock_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_stock_item_company_idx" ON "bar_stock_item" USING btree ("company_id","category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_tap_company_idx" ON "bar_tap" USING btree ("company_id","is_active","sort_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_time_off_company_day_idx" ON "bar_time_off" USING btree ("company_id","day");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_vendor_company_idx" ON "bar_vendor" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "loyalty_member_company_id_idx" ON "loyalty_members" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "loyalty_member_company_contact_uniq" ON "loyalty_members" USING btree ("company_id","contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "loyalty_reward_company_id_idx" ON "loyalty_rewards" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "loyalty_tx_member_idx" ON "loyalty_transactions" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "loyalty_tx_earn_per_check" ON "loyalty_transactions" USING btree ("member_id","earn_check_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document" ADD CONSTRAINT "document_patient_id_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patient"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "equipment" ADD CONSTRAINT "equipment_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoice" ADD CONSTRAINT "invoice_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoice" ADD CONSTRAINT "invoice_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoice" ADD CONSTRAINT "invoice_patient_id_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patient"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job" ADD CONSTRAINT "job_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job" ADD CONSTRAINT "job_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quote" ADD CONSTRAINT "quote_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quote" ADD CONSTRAINT "quote_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
