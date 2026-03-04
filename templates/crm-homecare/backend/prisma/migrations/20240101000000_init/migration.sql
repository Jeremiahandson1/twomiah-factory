-- Prisma Initial Migration

-- CreateTable
CREATE TABLE "agencies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "slug" TEXT NOT NULL UNIQUE,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#0369a1',
    "secondaryColor" TEXT,
    "logo" TEXT,
    "website" TEXT,
    "licenseNumber" TEXT,
    "npi" TEXT,
    "medicaidId" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "stripeCustomerId" TEXT UNIQUE,
    "subscriptionTier" TEXT,
    "twilioPhoneNumber" TEXT,
    "twilioAccountSid" TEXT,
    "twilioAuthToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL UNIQUE,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT,
    "role" TEXT NOT NULL DEFAULT 'caregiver',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "latitude" DECIMAL(10,8),
    "longitude" DECIMAL(11,8),
    "certifications" TEXT[] NOT NULL,
    "certificationsExpiry" TIMESTAMP(3)[] NOT NULL,
    "defaultPayRate" DECIMAL(8,2),
    "hireDate" DATE,
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "lastLogin" TIMESTAMP(3),
    "refreshToken" TEXT,
    "resetToken" TEXT,
    "resetTokenExp" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "caregiver_profiles" (
    "id" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL UNIQUE,
    "notes" TEXT,
    "capabilities" TEXT,
    "limitations" TEXT,
    "preferredHours" TEXT,
    "availableMon" BOOLEAN NOT NULL DEFAULT true,
    "availableTue" BOOLEAN NOT NULL DEFAULT true,
    "availableWed" BOOLEAN NOT NULL DEFAULT true,
    "availableThu" BOOLEAN NOT NULL DEFAULT true,
    "availableFri" BOOLEAN NOT NULL DEFAULT true,
    "availableSat" BOOLEAN NOT NULL DEFAULT false,
    "availableSun" BOOLEAN NOT NULL DEFAULT false,
    "npiNumber" TEXT,
    "taxonomyCode" TEXT DEFAULT '374700000X',
    "evvWorkerId" TEXT,
    "medicaidProviderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "caregiver_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "caregiver_availability" (
    "id" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL UNIQUE,
    "status" TEXT NOT NULL DEFAULT 'available',
    "maxHoursPerWeek" INTEGER NOT NULL DEFAULT 40,
    "weeklyAvailability" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "caregiver_availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "caregiver_schedules" (
    "id" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "dayOfWeek" INTEGER,
    "date" DATE,
    "startTime" TIME,
    "endTime" TIME,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "maxHoursPerWeek" INTEGER NOT NULL DEFAULT 40,
    "overtimeApproved" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "caregiver_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "caregiver_time_off" (
    "id" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "type" TEXT NOT NULL,
    "reason" TEXT,
    "approvedById" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "caregiver_time_off_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_sources" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "contactName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "payerType" TEXT DEFAULT 'other',
    "payerIdNumber" TEXT,
    "npi" TEXT,
    "expectedPayDays" INTEGER DEFAULT 30,
    "isActivePayer" BOOLEAN NOT NULL DEFAULT false,
    "ediPayerId" TEXT,
    "submissionMethod" TEXT DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "referral_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "dateOfBirth" DATE,
    "ssnEncrypted" TEXT,
    "gender" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "referredById" TEXT,
    "referralDate" DATE,
    "startDate" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "serviceType" TEXT,
    "insuranceProvider" TEXT,
    "insuranceId" TEXT,
    "insuranceGroup" TEXT,
    "medicalConditions" TEXT[] NOT NULL,
    "allergies" TEXT[] NOT NULL,
    "medications" TEXT[] NOT NULL,
    "preferredCaregivers" TEXT[] NOT NULL,
    "doNotUseCaregivers" TEXT[] NOT NULL,
    "notes" TEXT,
    "evvClientId" TEXT,
    "mcoMemberId" TEXT,
    "primaryDiagnosisCode" TEXT,
    "secondaryDiagnosisCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_emergency_contacts" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relationship" TEXT,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_emergency_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_onboarding" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL UNIQUE,
    "emergencyContactsCompleted" BOOLEAN NOT NULL DEFAULT false,
    "medicalHistoryCompleted" BOOLEAN NOT NULL DEFAULT false,
    "insuranceInfoCompleted" BOOLEAN NOT NULL DEFAULT false,
    "carePreferencesCompleted" BOOLEAN NOT NULL DEFAULT false,
    "familyCommunicationCompleted" BOOLEAN NOT NULL DEFAULT false,
    "initialAssessmentCompleted" BOOLEAN NOT NULL DEFAULT false,
    "allCompleted" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_onboarding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_assignments" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "assignmentDate" DATE NOT NULL,
    "hoursPerWeek" DECIMAL(5,2),
    "payRate" DECIMAL(10,2),
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedules" (
    "id" TEXT NOT NULL,
    "clientId" TEXT,
    "caregiverId" TEXT,
    "title" TEXT,
    "startTime" TIMESTAMP(3),
    "endTime" TIMESTAMP(3),
    "frequency" TEXT NOT NULL DEFAULT 'weekly',
    "effectiveDate" DATE,
    "anchorDate" DATE,
    "scheduleType" TEXT NOT NULL DEFAULT 'recurring',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "dayOfWeek" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "open_shifts" (
    "id" TEXT NOT NULL,
    "clientId" TEXT,
    "date" DATE NOT NULL,
    "startTime" TIME,
    "endTime" TIME,
    "status" TEXT NOT NULL DEFAULT 'open',
    "notes" TEXT,
    "sourceAbsenceId" TEXT,
    "notifiedCaregiverCount" INTEGER NOT NULL DEFAULT 0,
    "autoCreated" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "open_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "open_shift_notifications" (
    "id" TEXT NOT NULL,
    "openShiftId" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "notifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notificationType" TEXT NOT NULL DEFAULT 'push',

    CONSTRAINT "open_shift_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "absences" (
    "id" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "clientId" TEXT,
    "date" DATE NOT NULL,
    "type" TEXT NOT NULL,
    "reason" TEXT,
    "reportedById" TEXT,
    "coverageNeeded" BOOLEAN NOT NULL DEFAULT true,
    "coverageAssignedTo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "absences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_entries" (
    "id" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "scheduleId" TEXT,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3),
    "durationMinutes" INTEGER,
    "allottedMinutes" INTEGER,
    "billableMinutes" INTEGER,
    "discrepancyMinutes" INTEGER,
    "clockInLocation" JSONB,
    "clockOutLocation" JSONB,
    "isComplete" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gps_tracking" (
    "id" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "timeEntryId" TEXT,
    "latitude" DECIMAL(10,8) NOT NULL,
    "longitude" DECIMAL(11,8) NOT NULL,
    "accuracy" INTEGER,
    "speed" DECIMAL(6,2),
    "heading" INTEGER,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gps_tracking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "geofence_settings" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL UNIQUE,
    "radiusFeet" INTEGER NOT NULL DEFAULT 300,
    "autoClockIn" BOOLEAN NOT NULL DEFAULT true,
    "autoClockOut" BOOLEAN NOT NULL DEFAULT true,
    "requireGps" BOOLEAN NOT NULL DEFAULT true,
    "notifyAdminOnOverride" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "geofence_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "modifier1" TEXT,
    "modifier2" TEXT,
    "description" TEXT NOT NULL,
    "serviceCategory" TEXT,
    "payerType" TEXT NOT NULL DEFAULT 'all',
    "unitType" TEXT NOT NULL DEFAULT '15min',
    "ratePerUnit" DECIMAL(8,4),
    "requiresEvv" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "authorizations" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "payerId" TEXT,
    "authNumber" TEXT,
    "midasAuthId" TEXT,
    "procedureCode" TEXT,
    "modifier" TEXT,
    "authorizedUnits" DECIMAL(10,2) NOT NULL,
    "unitType" TEXT NOT NULL DEFAULT '15min',
    "usedUnits" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lowUnitsAlertThreshold" DECIMAL(10,2) NOT NULL DEFAULT 20,
    "notes" TEXT,
    "importedFrom" TEXT NOT NULL DEFAULT 'manual',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "authorizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evv_visits" (
    "id" TEXT NOT NULL,
    "timeEntryId" TEXT NOT NULL UNIQUE,
    "clientId" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "authorizationId" TEXT,
    "serviceCode" TEXT,
    "modifier" TEXT,
    "serviceDate" DATE NOT NULL,
    "actualStart" TIMESTAMP(3) NOT NULL,
    "actualEnd" TIMESTAMP(3),
    "unitsOfService" DECIMAL(8,2),
    "gpsInLat" DECIMAL(10,7),
    "gpsInLng" DECIMAL(10,7),
    "gpsOutLat" DECIMAL(10,7),
    "gpsOutLng" DECIMAL(10,7),
    "sandataStatus" TEXT NOT NULL DEFAULT 'pending',
    "sandataVisitId" TEXT,
    "sandataSubmittedAt" TIMESTAMP(3),
    "sandataResponse" JSONB,
    "sandataExceptionCode" TEXT,
    "sandataExceptionDesc" TEXT,
    "evvMethod" TEXT NOT NULL DEFAULT 'gps',
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "verificationIssues" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evv_visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "validation_log" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "validationType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "details" JSONB,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "validation_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL UNIQUE,
    "clientId" TEXT NOT NULL,
    "billingPeriodStart" DATE NOT NULL,
    "billingPeriodEnd" DATE NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "tax" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "paymentStatus" TEXT NOT NULL DEFAULT 'pending',
    "paymentDueDate" DATE,
    "paymentDate" DATE,
    "paymentMethod" TEXT,
    "stripePaymentIntentId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_line_items" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "timeEntryId" TEXT,
    "caregiverId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "hours" DECIMAL(6,2) NOT NULL,
    "rate" DECIMAL(10,2) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "edi_batches" (
    "id" TEXT NOT NULL,
    "payerId" TEXT,
    "batchNumber" TEXT NOT NULL UNIQUE,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "claimCount" INTEGER NOT NULL DEFAULT 0,
    "totalBilled" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "ediContent" TEXT,
    "submittedAt" TIMESTAMP(3),
    "responseCode" TEXT,
    "responseMessage" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "edi_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claims" (
    "id" TEXT NOT NULL,
    "clientId" TEXT,
    "caregiverId" TEXT,
    "ediBatchId" TEXT,
    "evvVisitId" TEXT,
    "authorizationId" TEXT,
    "claimNumber" TEXT,
    "serviceDate" DATE,
    "serviceCode" TEXT,
    "billedAmount" DECIMAL(10,2),
    "allowedAmount" DECIMAL(10,2),
    "paidAmount" DECIMAL(10,2),
    "denialCode" TEXT,
    "denialReason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "submissionDate" DATE,
    "paidDate" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "remittance_batches" (
    "id" TEXT NOT NULL,
    "payerId" TEXT,
    "payerName" TEXT NOT NULL,
    "payerType" TEXT NOT NULL DEFAULT 'other',
    "checkNumber" TEXT,
    "checkDate" DATE,
    "paymentDate" DATE,
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "rawOcrText" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending_match',
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "remittance_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "remittance_line_items" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "clientId" TEXT,
    "invoiceId" TEXT,
    "claimId" TEXT,
    "claimNumber" TEXT,
    "serviceDateFrom" DATE,
    "serviceDateTo" DATE,
    "billedAmount" DECIMAL(10,2),
    "allowedAmount" DECIMAL(10,2),
    "paidAmount" DECIMAL(10,2) NOT NULL,
    "adjustmentAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "denialCode" TEXT,
    "denialReason" TEXT,
    "matchStatus" TEXT NOT NULL DEFAULT 'unmatched',
    "matchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "remittance_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gusto_sync_log" (
    "id" TEXT NOT NULL,
    "syncType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "payPeriodStart" DATE,
    "payPeriodEnd" DATE,
    "recordsExported" INTEGER NOT NULL DEFAULT 0,
    "gustoResponse" JSONB,
    "errorMessage" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gusto_sync_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gusto_employee_map" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL UNIQUE,
    "gustoEmployeeId" TEXT,
    "gustoUuid" TEXT,
    "isSynced" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncedAt" TIMESTAMP(3),

    CONSTRAINT "gusto_employee_map_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" TEXT,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "date" DATE NOT NULL,
    "receiptUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance_ratings" (
    "id" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "ratingDate" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "satisfactionScore" INTEGER,
    "punctualityScore" INTEGER,
    "professionalismScore" INTEGER,
    "careQualityScore" INTEGER,
    "comments" TEXT,
    "noShows" INTEGER NOT NULL DEFAULT 0,
    "lateArrivals" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "performance_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "background_checks" (
    "id" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "checkType" TEXT NOT NULL DEFAULT 'criminal',
    "provider" TEXT,
    "cost" DECIMAL(8,2),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "initiatedDate" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expirationDate" DATE,
    "worcsReferenceNumber" TEXT,
    "worcsStatus" TEXT,
    "ssnEncrypted" TEXT,
    "driversLicenseEncrypted" TEXT,
    "driversLicenseState" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "background_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT,
    "title" TEXT NOT NULL,
    "message" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "emailSent" BOOLEAN NOT NULL DEFAULT false,
    "pushSent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL UNIQUE,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
    "pushEnabled" BOOLEAN NOT NULL DEFAULT true,
    "scheduleAlerts" BOOLEAN NOT NULL DEFAULT true,
    "absenceAlerts" BOOLEAN NOT NULL DEFAULT true,
    "billingAlerts" BOOLEAN NOT NULL DEFAULT true,
    "ratingAlerts" BOOLEAN NOT NULL DEFAULT true,
    "dailyDigest" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subscription" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_threads" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "threadType" TEXT NOT NULL DEFAULT 'direct',
    "isBroadcast" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_thread_participants" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_thread_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_log" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "logType" TEXT NOT NULL DEFAULT 'note',
    "direction" TEXT,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "loggedById" TEXT,
    "loggedByName" TEXT,
    "clientId" TEXT,
    "followUpDate" DATE,
    "followUpDone" BOOLEAN NOT NULL DEFAULT false,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "communication_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "noshow_alert_config" (
    "id" TEXT NOT NULL,
    "graceMinutes" INTEGER NOT NULL DEFAULT 15,
    "notifyAdmin" BOOLEAN NOT NULL DEFAULT true,
    "notifyCaregiver" BOOLEAN NOT NULL DEFAULT true,
    "notifyClientFamily" BOOLEAN NOT NULL DEFAULT false,
    "adminPhone" TEXT,
    "adminEmail" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "noshow_alert_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "noshow_alerts" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT,
    "caregiverId" TEXT,
    "clientId" TEXT,
    "shiftDate" DATE NOT NULL,
    "expectedStart" TIME NOT NULL,
    "alertedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolutionNote" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "smsSent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "noshow_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'general',
    "fields" JSONB NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "requiresSignature" BOOLEAN NOT NULL DEFAULT false,
    "autoAttachTo" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "form_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_submissions" (
    "id" TEXT NOT NULL,
    "templateId" TEXT,
    "templateName" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "clientId" TEXT,
    "submittedById" TEXT,
    "submittedByName" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "signature" TEXT,
    "signedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "form_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_activity" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "userId" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "failReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "tableName" TEXT,
    "recordId" TEXT,
    "oldData" JSONB,
    "newData" JSONB,
    "ipAddress" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_locations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "latitude" DECIMAL(10,8),
    "longitude" DECIMAL(11,8),
    "serviceRadiusMiles" INTEGER NOT NULL DEFAULT 5,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboard_cache" (
    "id" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL UNIQUE,
    "data" JSONB,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dashboard_cache_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "caregiver_schedules_caregiverId_idx" ON "caregiver_schedules"("caregiverId");
CREATE INDEX "caregiver_schedules_date_idx" ON "caregiver_schedules"("date");

CREATE INDEX "caregiver_time_off_caregiverId_idx" ON "caregiver_time_off"("caregiverId");
CREATE INDEX "caregiver_time_off_startDate_endDate_idx" ON "caregiver_time_off"("startDate", "endDate");

CREATE INDEX "referral_sources_type_idx" ON "referral_sources"("type");
CREATE INDEX "referral_sources_isActive_idx" ON "referral_sources"("isActive");

CREATE INDEX "clients_isActive_idx" ON "clients"("isActive");
CREATE INDEX "clients_referredById_idx" ON "clients"("referredById");

CREATE INDEX "client_emergency_contacts_clientId_idx" ON "client_emergency_contacts"("clientId");

CREATE INDEX "client_assignments_clientId_idx" ON "client_assignments"("clientId");
CREATE INDEX "client_assignments_caregiverId_idx" ON "client_assignments"("caregiverId");
CREATE INDEX "client_assignments_status_idx" ON "client_assignments"("status");

CREATE INDEX "schedules_clientId_idx" ON "schedules"("clientId");
CREATE INDEX "schedules_caregiverId_idx" ON "schedules"("caregiverId");

CREATE INDEX "open_shifts_date_idx" ON "open_shifts"("date");
CREATE INDEX "open_shifts_status_idx" ON "open_shifts"("status");

CREATE UNIQUE INDEX "open_shift_notifications_openShiftId_caregiverId_key" ON "open_shift_notifications"("openShiftId", "caregiverId");
CREATE INDEX "open_shift_notifications_openShiftId_idx" ON "open_shift_notifications"("openShiftId");

CREATE INDEX "absences_caregiverId_idx" ON "absences"("caregiverId");
CREATE INDEX "absences_date_idx" ON "absences"("date");

CREATE INDEX "time_entries_caregiverId_idx" ON "time_entries"("caregiverId");
CREATE INDEX "time_entries_clientId_idx" ON "time_entries"("clientId");
CREATE INDEX "time_entries_startTime_idx" ON "time_entries"("startTime");
CREATE INDEX "time_entries_scheduleId_idx" ON "time_entries"("scheduleId");

CREATE INDEX "gps_tracking_caregiverId_idx" ON "gps_tracking"("caregiverId");
CREATE INDEX "gps_tracking_timeEntryId_idx" ON "gps_tracking"("timeEntryId");
CREATE INDEX "gps_tracking_timestamp_idx" ON "gps_tracking"("timestamp");

CREATE INDEX "service_codes_code_idx" ON "service_codes"("code");
CREATE INDEX "service_codes_isActive_idx" ON "service_codes"("isActive");

CREATE INDEX "authorizations_clientId_idx" ON "authorizations"("clientId");
CREATE INDEX "authorizations_startDate_endDate_idx" ON "authorizations"("startDate", "endDate");
CREATE INDEX "authorizations_status_idx" ON "authorizations"("status");

CREATE INDEX "evv_visits_clientId_serviceDate_idx" ON "evv_visits"("clientId", "serviceDate");
CREATE INDEX "evv_visits_caregiverId_idx" ON "evv_visits"("caregiverId");
CREATE INDEX "evv_visits_sandataStatus_idx" ON "evv_visits"("sandataStatus");

CREATE INDEX "validation_log_entityId_entityType_idx" ON "validation_log"("entityId", "entityType");

CREATE INDEX "invoices_clientId_idx" ON "invoices"("clientId");
CREATE INDEX "invoices_paymentStatus_idx" ON "invoices"("paymentStatus");

CREATE INDEX "invoice_line_items_invoiceId_idx" ON "invoice_line_items"("invoiceId");

CREATE INDEX "edi_batches_status_idx" ON "edi_batches"("status");

CREATE INDEX "claims_ediBatchId_idx" ON "claims"("ediBatchId");
CREATE INDEX "claims_evvVisitId_idx" ON "claims"("evvVisitId");
CREATE INDEX "claims_status_idx" ON "claims"("status");

CREATE INDEX "remittance_batches_payerId_idx" ON "remittance_batches"("payerId");

CREATE INDEX "remittance_line_items_batchId_idx" ON "remittance_line_items"("batchId");

CREATE INDEX "expenses_userId_idx" ON "expenses"("userId");

CREATE INDEX "performance_ratings_caregiverId_idx" ON "performance_ratings"("caregiverId");
CREATE INDEX "performance_ratings_clientId_idx" ON "performance_ratings"("clientId");

CREATE INDEX "background_checks_caregiverId_idx" ON "background_checks"("caregiverId");

CREATE INDEX "notifications_userId_idx" ON "notifications"("userId");
CREATE INDEX "notifications_isRead_idx" ON "notifications"("isRead");

CREATE UNIQUE INDEX "push_subscriptions_userId_subscription_key" ON "push_subscriptions"("userId", "subscription");
CREATE INDEX "push_subscriptions_isActive_idx" ON "push_subscriptions"("isActive");

CREATE INDEX "message_threads_updatedAt_idx" ON "message_threads"("updatedAt");

CREATE UNIQUE INDEX "message_thread_participants_threadId_userId_key" ON "message_thread_participants"("threadId", "userId");
CREATE INDEX "message_thread_participants_userId_idx" ON "message_thread_participants"("userId");
CREATE INDEX "message_thread_participants_threadId_idx" ON "message_thread_participants"("threadId");

CREATE INDEX "messages_threadId_createdAt_idx" ON "messages"("threadId", "createdAt");

CREATE INDEX "communication_log_entityType_entityId_idx" ON "communication_log"("entityType", "entityId");
CREATE INDEX "communication_log_createdAt_idx" ON "communication_log"("createdAt");

CREATE INDEX "noshow_alerts_status_shiftDate_idx" ON "noshow_alerts"("status", "shiftDate");
CREATE INDEX "noshow_alerts_caregiverId_idx" ON "noshow_alerts"("caregiverId");

CREATE INDEX "form_templates_category_isActive_idx" ON "form_templates"("category", "isActive");

CREATE INDEX "form_submissions_entityType_entityId_idx" ON "form_submissions"("entityType", "entityId");
CREATE INDEX "form_submissions_templateId_idx" ON "form_submissions"("templateId");

CREATE INDEX "login_activity_email_idx" ON "login_activity"("email");
CREATE INDEX "login_activity_userId_idx" ON "login_activity"("userId");
CREATE INDEX "login_activity_createdAt_idx" ON "login_activity"("createdAt");

CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");
CREATE INDEX "audit_logs_timestamp_idx" ON "audit_logs"("timestamp");
CREATE INDEX "audit_logs_tableName_idx" ON "audit_logs"("tableName");
