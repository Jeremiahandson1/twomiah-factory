const express = require('express');
const { body, validationResult } = require('express-validator');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const appPaths = require('../config/paths');

const router = express.Router();

const leadsFile = path.join(appPaths.data, 'leads.json');

function readLeads() {
  try {
    if (!fs.existsSync(leadsFile)) return [];
    return JSON.parse(fs.readFileSync(leadsFile, 'utf8')) || [];
  } catch (e) { return []; }
}

function writeLeads(leads) {
  fs.writeFileSync(leadsFile, JSON.stringify(leads, null, 2));
}

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
  next();
};

const contactFormValidation = [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('phone').trim().notEmpty().withMessage('Phone is required'),
  body('email').optional({ checkFalsy: true }).isEmail().withMessage('Invalid email'),
  body('message').optional().trim(),
];

// POST /api/leads — public contact form submission
router.post('/', contactFormValidation, validate, async (req, res) => {
  try {
    const leads = readLeads();
    const lead = {
      id: uuidv4(),
      name: req.body.name,
      phone: req.body.phone,
      email: req.body.email || '',
      service: req.body.service || req.body.careType || '',
      message: req.body.message || req.body.comments || '',
      source: 'website',
      status: 'new',
      createdAt: new Date().toISOString(),
      ipAddress: req.ip,
      referrer: req.get('Referrer') || '',
    };
    leads.unshift(lead);
    writeLeads(leads);

    // Try to send email notification if configured
    try {
      const settings = JSON.parse(fs.readFileSync(path.join(appPaths.data, 'settings.json'), 'utf8'));
      const emailCfg = settings.emailNotifications;
      if (emailCfg?.enabled && emailCfg?.sendgridApiKey && emailCfg?.recipient) {
        const sgMail = require('@sendgrid/mail');
        sgMail.setApiKey(emailCfg.sendgridApiKey);
        await sgMail.send({
          to: emailCfg.recipient,
          from: emailCfg.fromEmail || `noreply@${settings.domain || 'yourdomain.com'}`,
          subject: `New Lead: ${lead.name} — ${settings.companyName || 'Your Site'}`,
          text: `New contact form submission:\n\nName: ${lead.name}\nPhone: ${lead.phone}\nEmail: ${lead.email}\nService: ${lead.service}\nMessage: ${lead.message}\n\nSubmitted: ${lead.createdAt}`,
        });
      }
    } catch (emailErr) {
      console.warn('[Leads] Email notification failed:', emailErr.message);
    }

    res.json({ success: true, message: 'Thank you! We will be in touch shortly.' });
  } catch (err) {
    console.error('[Leads] Submit error:', err.message);
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// POST /api/admin/leads — same handler, used by admin rate limiter route in server.js
router.post('/admin', contactFormValidation, validate, async (req, res) => {
  req.url = '/';
  router.handle(req, res);
});

module.exports = router;
