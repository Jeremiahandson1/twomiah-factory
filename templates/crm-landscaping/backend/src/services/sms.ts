// Two-way SMS — shared implementation (packages/tenant-backend/src/integrations/sms.ts), vendored into this tenant as
// ../shared at generation. This file only wires the template's tables and services in.
import { createSmsService } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { smsConversation, smsMessage, smsTemplate, contact, company, job, user } from '../../db/schema.ts'
import { reportSmsUsage, walletSufficient } from './messagingUsage.ts'

const sms = createSmsService({ db, tables: { smsConversation, smsMessage, smsTemplate, contact, company, job, user }, usage: { reportSmsUsage, walletSufficient } })

export const { sendSMS, handleIncomingSMS, handleStatusUpdate, getConversations, getConversation, archiveConversation, linkToContact, createTemplate, getTemplates, updateTemplate, deleteTemplate, applyTemplateVariables, createAutoResponder, getAutoResponders, sendBulkSMS, sendJobUpdate, getUnreadCount } = sms
export default sms
