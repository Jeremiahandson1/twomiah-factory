import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import sms from '../services/sms.js';

const router = Router();

// ============================================
// WEBHOOKS (No auth - called by Twilio)
// ============================================

// Incoming SMS webhook
router.post('/webhook/incoming', async (req, res) => {
  try {
    await sms.handleIncomingSMS(req.body);
    // Twilio expects TwiML response
    res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  } catch (error) {
    console.error('SMS webhook error:', error);
    res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  }
});

// Message status webhook
router.post('/webhook/status', async (req, res) => {
  try {
    await sms.handleStatusUpdate(req.body);
    res.sendStatus(200);
  } catch (error) {
    console.error('SMS status webhook error:', error);
    res.sendStatus(200);
  }
});

// Apply auth to remaining routes
router.use(authenticate);

// ============================================
// CONVERSATIONS
// ============================================

// Get conversations
router.get('/conversations', async (req, res, next) => {
  try {
    const { status, unreadOnly, search, page, limit } = req.query;
    const data = await sms.getConversations(req.user.companyId, {
      status,
      unreadOnly: unreadOnly === 'true',
      search,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 50,
    });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

// Get unread count
router.get('/unread-count', async (req, res, next) => {
  try {
    const count = await sms.getUnreadCount(req.user.companyId);
    res.json({ count });
  } catch (error) {
    next(error);
  }
});

// Get single conversation
router.get('/conversations/:id', async (req, res, next) => {
  try {
    const conversation = await sms.getConversation(req.params.id, req.user.companyId);
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    res.json(conversation);
  } catch (error) {
    next(error);
  }
});

// Archive conversation
router.post('/conversations/:id/archive', async (req, res, next) => {
  try {
    await sms.archiveConversation(req.params.id, req.user.companyId);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// Link conversation to contact
router.post('/conversations/:id/link', async (req, res, next) => {
  try {
    const { contactId } = req.body;
    await sms.linkToContact(req.params.id, req.user.companyId, contactId);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ============================================
// SEND MESSAGES
// ============================================

// Send SMS
router.post('/send', async (req, res, next) => {
  try {
    const { contactId, toPhone, message, jobId, templateId } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    if (!contactId && !toPhone) {
      return res.status(400).json({ error: 'contactId or toPhone is required' });
    }

    const result = await sms.sendSMS(req.user.companyId, {
      contactId,
      toPhone,
      message,
      userId: req.user.userId,
      jobId,
      templateId,
    });

    res.json(result);
  } catch (error) {
    if (error.message.includes('phone')) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

// Reply to conversation
router.post('/conversations/:id/reply', async (req, res, next) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Get conversation to find phone
    const conversation = await sms.getConversation(req.params.id, req.user.companyId);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const result = await sms.sendSMS(req.user.companyId, {
      toPhone: conversation.phone,
      contactId: conversation.contactId,
      message,
      userId: req.user.userId,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Send bulk SMS
router.post('/bulk', requirePermission('contacts:update'), async (req, res, next) => {
  try {
    const { contactIds, message, templateId } = req.body;

    if (!contactIds?.length) {
      return res.status(400).json({ error: 'contactIds array is required' });
    }

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const results = await sms.sendBulkSMS(req.user.companyId, {
      contactIds,
      message,
      templateId,
      userId: req.user.userId,
    });

    res.json(results);
  } catch (error) {
    next(error);
  }
});

// Send job update
router.post('/job-update/:jobId', async (req, res, next) => {
  try {
    const { updateType } = req.body;

    if (!['scheduled', 'on_way', 'started', 'completed', 'reminder'].includes(updateType)) {
      return res.status(400).json({ error: 'Invalid updateType' });
    }

    const result = await sms.sendJobUpdate(req.user.companyId, req.params.jobId, updateType);
    res.json(result || { sent: false, reason: 'No phone number' });
  } catch (error) {
    next(error);
  }
});

// ============================================
// TEMPLATES
// ============================================

// Get templates
router.get('/templates', async (req, res, next) => {
  try {
    const { category } = req.query;
    const templates = await sms.getTemplates(req.user.companyId, { category });
    res.json(templates);
  } catch (error) {
    next(error);
  }
});

// Create template
router.post('/templates', async (req, res, next) => {
  try {
    const template = await sms.createTemplate(req.user.companyId, req.body);
    res.status(201).json(template);
  } catch (error) {
    next(error);
  }
});

// Update template
router.put('/templates/:id', async (req, res, next) => {
  try {
    await sms.updateTemplate(req.params.id, req.user.companyId, req.body);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// Delete template
router.delete('/templates/:id', async (req, res, next) => {
  try {
    await sms.deleteTemplate(req.params.id, req.user.companyId);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ============================================
// AUTO-RESPONDERS
// ============================================

// Get auto-responders
router.get('/auto-responders', async (req, res, next) => {
  try {
    const responders = await sms.getAutoResponders(req.user.companyId);
    res.json(responders);
  } catch (error) {
    next(error);
  }
});

// Create auto-responder
router.post('/auto-responders', async (req, res, next) => {
  try {
    const responder = await sms.createAutoResponder(req.user.companyId, req.body);
    res.status(201).json(responder);
  } catch (error) {
    next(error);
  }
});

export default router;
