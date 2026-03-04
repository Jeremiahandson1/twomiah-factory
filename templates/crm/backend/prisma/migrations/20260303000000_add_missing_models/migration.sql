-- Migration: add_missing_models
-- Place this file at: crm/backend/prisma/migrations/20260303000000_add_missing_models/migration.sql

CREATE TABLE IF NOT EXISTS "AgreementPlan" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "name" TEXT NOT NULL, "description" TEXT,
  "price" DECIMAL(10,2) NOT NULL DEFAULT 0, "billingFrequency" TEXT NOT NULL DEFAULT 'monthly',
  "visitsIncluded" INTEGER, "discountPercent" DECIMAL(5,2), "durationMonths" INTEGER,
  "autoRenew" BOOLEAN NOT NULL DEFAULT false, "includedServices" TEXT[],
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgreementPlan_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AgreementPlan_companyId_idx" ON "AgreementPlan"("companyId");

CREATE TABLE IF NOT EXISTS "WarrantyTemplate" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "name" TEXT NOT NULL, "category" TEXT,
  "durationMonths" INTEGER NOT NULL DEFAULT 12, "coverageDetails" TEXT, "exclusions" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WarrantyTemplate_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "WarrantyTemplate_companyId_idx" ON "WarrantyTemplate"("companyId");

CREATE TABLE IF NOT EXISTS "ProjectWarranty" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "projectId" TEXT, "contactId" TEXT, "templateId" TEXT,
  "name" TEXT NOT NULL, "category" TEXT, "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3), "documentUrl" TEXT, "status" TEXT NOT NULL DEFAULT 'active', "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectWarranty_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ProjectWarranty_companyId_idx" ON "ProjectWarranty"("companyId");

CREATE TABLE IF NOT EXISTS "TakeoffAssembly" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "name" TEXT NOT NULL, "category" TEXT,
  "measurementType" TEXT, "wasteFactor" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TakeoffAssembly_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "TakeoffAssembly_companyId_idx" ON "TakeoffAssembly"("companyId");

CREATE TABLE IF NOT EXISTS "AssemblyMaterial" (
  "id" TEXT NOT NULL, "assemblyId" TEXT NOT NULL, "name" TEXT NOT NULL,
  "quantityPer" DECIMAL(12,4) NOT NULL DEFAULT 1, "unit" TEXT NOT NULL,
  "unitCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssemblyMaterial_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AssemblyMaterial_assemblyId_idx" ON "AssemblyMaterial"("assemblyId");

CREATE TABLE IF NOT EXISTS "TakeoffSheet" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "projectId" TEXT, "name" TEXT NOT NULL,
  "planReference" TEXT, "planUrl" TEXT, "status" TEXT NOT NULL DEFAULT 'draft',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TakeoffSheet_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "TakeoffSheet_companyId_idx" ON "TakeoffSheet"("companyId");

CREATE TABLE IF NOT EXISTS "RecurringInvoice" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "projectId" TEXT, "contactId" TEXT,
  "frequency" TEXT NOT NULL DEFAULT 'monthly', "startDate" TIMESTAMP(3) NOT NULL,
  "nextRunDate" TIMESTAMP(3), "endDate" TIMESTAMP(3), "autoSend" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'active', "amount" DECIMAL(12,2) NOT NULL DEFAULT 0, "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecurringInvoice_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "RecurringInvoice_companyId_idx" ON "RecurringInvoice"("companyId");

CREATE TABLE IF NOT EXISTS "RecurringLineItem" (
  "id" TEXT NOT NULL, "recurringInvoiceId" TEXT NOT NULL, "description" TEXT NOT NULL,
  "quantity" DECIMAL(12,4) NOT NULL DEFAULT 1, "unitPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecurringLineItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "RecurringLineItem_recurringInvoiceId_idx" ON "RecurringLineItem"("recurringInvoiceId");

CREATE TABLE IF NOT EXISTS "EquipmentType" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "name" TEXT NOT NULL, "category" TEXT, "brand" TEXT,
  "defaultWarrantyMonths" INTEGER, "maintenanceIntervalMonths" INTEGER,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EquipmentType_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "EquipmentType_companyId_idx" ON "EquipmentType"("companyId");

CREATE TABLE IF NOT EXISTS "EmailRecipient" (
  "id" TEXT NOT NULL, "campaignId" TEXT NOT NULL, "contactId" TEXT, "email" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending', "sentAt" TIMESTAMP(3), "openedAt" TIMESTAMP(3), "clickedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailRecipient_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "EmailRecipient_campaignId_idx" ON "EmailRecipient"("campaignId");

CREATE TABLE IF NOT EXISTS "Task" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "title" TEXT NOT NULL, "description" TEXT,
  "dueDate" TIMESTAMP(3), "priority" TEXT NOT NULL DEFAULT 'medium', "status" TEXT NOT NULL DEFAULT 'open',
  "checklist" JSONB, "assignedToId" TEXT, "projectId" TEXT, "jobId" TEXT, "contactId" TEXT, "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Task_companyId_idx" ON "Task"("companyId");
CREATE INDEX IF NOT EXISTS "Task_assignedToId_idx" ON "Task"("assignedToId");

CREATE TABLE IF NOT EXISTS "Activity" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "userId" TEXT, "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL, "action" TEXT NOT NULL, "description" TEXT, "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Activity_companyId_idx" ON "Activity"("companyId");
CREATE INDEX IF NOT EXISTS "Activity_entityType_entityId_idx" ON "Activity"("entityType", "entityId");

CREATE TABLE IF NOT EXISTS "ActivityLog" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "userId" TEXT, "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL, "action" TEXT NOT NULL, "description" TEXT, "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ActivityLog_companyId_idx" ON "ActivityLog"("companyId");

CREATE TABLE IF NOT EXISTS "CallLog" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "trackingNumberId" TEXT, "contactId" TEXT,
  "callerNumber" TEXT, "duration" INTEGER, "recordingUrl" TEXT, "status" TEXT, "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CallLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CallLog_companyId_idx" ON "CallLog"("companyId");

CREATE TABLE IF NOT EXISTS "Comment" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "userId" TEXT, "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL, "content" TEXT NOT NULL, "mentions" TEXT[], "attachments" JSONB, "parentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Comment_companyId_idx" ON "Comment"("companyId");
CREATE INDEX IF NOT EXISTS "Comment_entityType_entityId_idx" ON "Comment"("entityType", "entityId");

CREATE TABLE IF NOT EXISTS "CommentReaction" (
  "id" TEXT NOT NULL, "commentId" TEXT NOT NULL, "userId" TEXT NOT NULL, "reaction" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommentReaction_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CommentReaction_commentId_idx" ON "CommentReaction"("commentId");

CREATE TABLE IF NOT EXISTS "DripSequence" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "name" TEXT NOT NULL, "trigger" TEXT, "steps" JSONB,
  "active" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DripSequence_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "DripSequence_companyId_idx" ON "DripSequence"("companyId");

CREATE TABLE IF NOT EXISTS "SequenceEnrollment" (
  "id" TEXT NOT NULL, "sequenceId" TEXT NOT NULL, "contactId" TEXT NOT NULL,
  "currentStep" INTEGER NOT NULL DEFAULT 0, "status" TEXT NOT NULL DEFAULT 'active', "nextEmailAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SequenceEnrollment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SequenceEnrollment_sequenceId_idx" ON "SequenceEnrollment"("sequenceId");
CREATE INDEX IF NOT EXISTS "SequenceEnrollment_contactId_idx" ON "SequenceEnrollment"("contactId");

CREATE TABLE IF NOT EXISTS "EmailClick" (
  "id" TEXT NOT NULL, "recipientId" TEXT NOT NULL, "url" TEXT NOT NULL,
  "clickedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailClick_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "EmailClick_recipientId_idx" ON "EmailClick"("recipientId");

CREATE TABLE IF NOT EXISTS "EquipmentServiceRecord" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "equipmentId" TEXT NOT NULL, "jobId" TEXT,
  "technicianId" TEXT, "serviceDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "serviceType" TEXT NOT NULL, "partsUsed" JSONB, "laborHours" DECIMAL(8,2), "cost" DECIMAL(12,2), "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EquipmentServiceRecord_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "EquipmentServiceRecord_companyId_idx" ON "EquipmentServiceRecord"("companyId");
CREATE INDEX IF NOT EXISTS "EquipmentServiceRecord_equipmentId_idx" ON "EquipmentServiceRecord"("equipmentId");

CREATE TABLE IF NOT EXISTS "JobAssignment" (
  "id" TEXT NOT NULL, "jobId" TEXT NOT NULL, "userId" TEXT NOT NULL, "role" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JobAssignment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "JobAssignment_jobId_idx" ON "JobAssignment"("jobId");
CREATE INDEX IF NOT EXISTS "JobAssignment_userId_idx" ON "JobAssignment"("userId");

CREATE TABLE IF NOT EXISTS "OauthState" (
  "id" TEXT NOT NULL, "state" TEXT NOT NULL, "provider" TEXT NOT NULL, "companyId" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OauthState_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "OauthState_state_key" ON "OauthState"("state");

CREATE TABLE IF NOT EXISTS "Photo" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "userId" TEXT, "filename" TEXT NOT NULL,
  "originalName" TEXT, "mimeType" TEXT, "size" INTEGER, "width" INTEGER, "height" INTEGER,
  "thumbnailPath" TEXT, "url" TEXT, "caption" TEXT, "tags" TEXT[], "entityType" TEXT, "entityId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Photo_companyId_idx" ON "Photo"("companyId");

CREATE TABLE IF NOT EXISTS "PricebookGoodBetterBest" (
  "id" TEXT NOT NULL, "pricebookItemId" TEXT NOT NULL, "tier" TEXT NOT NULL, "name" TEXT NOT NULL,
  "description" TEXT, "price" DECIMAL(12,2) NOT NULL DEFAULT 0, "features" TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PricebookGoodBetterBest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PricebookGoodBetterBest_pricebookItemId_idx" ON "PricebookGoodBetterBest"("pricebookItemId");

CREATE TABLE IF NOT EXISTS "PricebookMaterial" (
  "id" TEXT NOT NULL, "pricebookItemId" TEXT NOT NULL, "inventoryItemId" TEXT, "name" TEXT NOT NULL,
  "quantity" DECIMAL(12,4) NOT NULL DEFAULT 1, "priceOverride" DECIMAL(12,2),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PricebookMaterial_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PricebookMaterial_pricebookItemId_idx" ON "PricebookMaterial"("pricebookItemId");

CREATE TABLE IF NOT EXISTS "Product" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "name" TEXT NOT NULL, "description" TEXT,
  "sku" TEXT, "price" DECIMAL(12,2) NOT NULL DEFAULT 0, "category" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Product_companyId_idx" ON "Product"("companyId");

CREATE TABLE IF NOT EXISTS "ProjectBaseline" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "projectId" TEXT NOT NULL, "name" TEXT NOT NULL,
  "taskSnapshots" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectBaseline_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ProjectBaseline_projectId_idx" ON "ProjectBaseline"("projectId");

CREATE TABLE IF NOT EXISTS "ProjectSelection" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "projectId" TEXT NOT NULL, "categoryId" TEXT,
  "name" TEXT NOT NULL, "location" TEXT, "allowance" DECIMAL(12,2), "selectedOptionId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectSelection_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ProjectSelection_projectId_idx" ON "ProjectSelection"("projectId");

CREATE TABLE IF NOT EXISTS "ProjectTask" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "projectId" TEXT NOT NULL, "parentId" TEXT,
  "name" TEXT NOT NULL, "startDate" TIMESTAMP(3), "endDate" TIMESTAMP(3), "duration" INTEGER,
  "progress" INTEGER NOT NULL DEFAULT 0, "assignedToId" TEXT, "status" TEXT NOT NULL DEFAULT 'not_started',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectTask_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ProjectTask_projectId_idx" ON "ProjectTask"("projectId");

CREATE TABLE IF NOT EXISTS "TaskDependency" (
  "id" TEXT NOT NULL, "predecessorId" TEXT NOT NULL, "successorId" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'finish_to_start', "lagDays" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "TaskDependency_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "TaskDependency_predecessorId_idx" ON "TaskDependency"("predecessorId");
CREATE INDEX IF NOT EXISTS "TaskDependency_successorId_idx" ON "TaskDependency"("successorId");

CREATE TABLE IF NOT EXISTS "SelectionOption" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "categoryId" TEXT, "name" TEXT NOT NULL,
  "manufacturer" TEXT, "model" TEXT, "sku" TEXT, "price" DECIMAL(12,2), "imageUrl" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SelectionOption_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SelectionOption_companyId_idx" ON "SelectionOption"("companyId");

CREATE TABLE IF NOT EXISTS "SmsAutoResponder" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "name" TEXT NOT NULL, "trigger" TEXT NOT NULL,
  "keywords" TEXT[], "message" TEXT NOT NULL, "afterHoursOnly" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SmsAutoResponder_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SmsAutoResponder_companyId_idx" ON "SmsAutoResponder"("companyId");

CREATE TABLE IF NOT EXISTS "TakeoffCalculatedMaterial" (
  "id" TEXT NOT NULL, "itemId" TEXT NOT NULL, "materialName" TEXT NOT NULL,
  "baseQuantity" DECIMAL(12,4) NOT NULL DEFAULT 0, "wasteQuantity" DECIMAL(12,4) NOT NULL DEFAULT 0,
  "totalQuantity" DECIMAL(12,4) NOT NULL DEFAULT 0, "unitCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "totalCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TakeoffCalculatedMaterial_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "TakeoffCalculatedMaterial_itemId_idx" ON "TakeoffCalculatedMaterial"("itemId");

CREATE TABLE IF NOT EXISTS "PushSubscription" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "endpoint" TEXT NOT NULL,
  "p256dh" TEXT, "auth" TEXT, "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PushSubscription_userId_idx" ON "PushSubscription"("userId");

ALTER TABLE "Vehicle" ADD COLUMN IF NOT EXISTS "color" TEXT;
ALTER TABLE "Vehicle" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "Vehicle" ADD COLUMN IF NOT EXISTS "assignedUserId" TEXT;
ALTER TABLE "SelectionCategory" ADD COLUMN IF NOT EXISTS "active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "SelectionItem" ADD COLUMN IF NOT EXISTS "active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ServiceAgreement" ADD COLUMN IF NOT EXISTS "planId" TEXT;
ALTER TABLE "TakeoffItem" ADD COLUMN IF NOT EXISTS "sheetId" TEXT;
ALTER TABLE "WarrantyClaim" ADD COLUMN IF NOT EXISTS "projectWarrantyId" TEXT;

ALTER TABLE "AgreementPlan" ADD CONSTRAINT "AgreementPlan_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WarrantyTemplate" ADD CONSTRAINT "WarrantyTemplate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectWarranty" ADD CONSTRAINT "ProjectWarranty_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TakeoffAssembly" ADD CONSTRAINT "TakeoffAssembly_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssemblyMaterial" ADD CONSTRAINT "AssemblyMaterial_assemblyId_fkey" FOREIGN KEY ("assemblyId") REFERENCES "TakeoffAssembly"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TakeoffSheet" ADD CONSTRAINT "TakeoffSheet_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecurringInvoice" ADD CONSTRAINT "RecurringInvoice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecurringLineItem" ADD CONSTRAINT "RecurringLineItem_recurringInvoiceId_fkey" FOREIGN KEY ("recurringInvoiceId") REFERENCES "RecurringInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EquipmentType" ADD CONSTRAINT "EquipmentType_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CallLog" ADD CONSTRAINT "CallLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DripSequence" ADD CONSTRAINT "DripSequence_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EquipmentServiceRecord" ADD CONSTRAINT "EquipmentServiceRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectBaseline" ADD CONSTRAINT "ProjectBaseline_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectSelection" ADD CONSTRAINT "ProjectSelection_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SelectionOption" ADD CONSTRAINT "SelectionOption_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SmsAutoResponder" ADD CONSTRAINT "SmsAutoResponder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceAgreement" ADD CONSTRAINT "ServiceAgreement_planId_fkey" FOREIGN KEY ("planId") REFERENCES "AgreementPlan"("id") ON UPDATE CASCADE;
ALTER TABLE "TakeoffItem" ADD CONSTRAINT "TakeoffItem_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "TakeoffSheet"("id") ON UPDATE CASCADE;
ALTER TABLE "WarrantyClaim" ADD CONSTRAINT "WarrantyClaim_projectWarrantyId_fkey" FOREIGN KEY ("projectWarrantyId") REFERENCES "ProjectWarranty"("id") ON UPDATE CASCADE;
