/**
 * Integrations Routes
 * 
 * Handles customer-facing integrations:
 * - QuickBooks (OAuth - customer connects their account)
 * - Stripe Connect (OAuth - customer connects their account)
 * - SMS (platform toggle - uses our Twilio)
 * - Email (platform toggle - uses our SendGrid)
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { prisma } from '../index.js';
import Stripe from 'stripe';

const router = Router();

// Platform Stripe (for Stripe Connect)
const stripe = process.env.STRIPE_SECRET_KEY 
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

// QuickBooks OAuth config
const QB_CLIENT_ID = process.env.QUICKBOOKS_CLIENT_ID;
const QB_CLIENT_SECRET = process.env.QUICKBOOKS_CLIENT_SECRET;
const QB_REDIRECT_URI = process.env.QUICKBOOKS_REDIRECT_URI || `${process.env.API_URL}/api/integrations/quickbooks/callback`;
const QB_ENVIRONMENT = process.env.QUICKBOOKS_ENVIRONMENT || 'sandbox'; // 'sandbox' or 'production'

// ============================================
// GET INTEGRATION STATUS
// ============================================

router.get('/status', authenticate, async (req, res, next) => {
  try {
    const company = await prisma.company.findUnique({
      where: { id: req.user.companyId },
      select: { settings: true, integrations: true },
    });

    const integrations = company?.integrations || {};
    const settings = company?.settings || {};

    // Get usage for current month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [smsCount, emailCount] = await Promise.all([
      prisma.smsMessage.count({
        where: {
          companyId: req.user.companyId,
          createdAt: { gte: startOfMonth },
        },
      }),
      prisma.emailLog.count({
        where: {
          companyId: req.user.companyId,
          createdAt: { gte: startOfMonth },
        },
      }),
    ]);

    // Check Stripe Connect status if connected
    let stripeStatus = { connected: false, accountId: null, chargesEnabled: false };
    if (integrations.stripeAccountId) {
      try {
        const account = await stripe.accounts.retrieve(integrations.stripeAccountId);
        stripeStatus = {
          connected: true,
          accountId: account.id,
          chargesEnabled: account.charges_enabled,
        };
      } catch (err) {
        // Account no longer valid
        stripeStatus = { connected: false, accountId: null, chargesEnabled: false };
      }
    }

    res.json({
      quickbooks: {
        connected: !!integrations.quickbooksRealmId,
        companyName: integrations.quickbooksCompanyName || null,
        lastSync: integrations.quickbooksLastSync || null,
      },
      stripe: stripeStatus,
      sms: {
        enabled: settings.smsEnabled || false,
        usage: smsCount,
      },
      email: {
        enabled: settings.emailEnabled !== false, // default true
        usage: emailCount,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// QUICKBOOKS OAUTH
// ============================================

/**
 * Get QuickBooks OAuth URL
 */
router.get('/quickbooks/auth-url', authenticate, async (req, res, next) => {
  try {
    if (!QB_CLIENT_ID) {
      return res.status(500).json({ error: 'QuickBooks not configured' });
    }

    const state = Buffer.from(JSON.stringify({
      companyId: req.user.companyId,
      userId: req.user.id,
    })).toString('base64');

    const baseUrl = QB_ENVIRONMENT === 'production'
      ? 'https://appcenter.intuit.com/connect/oauth2'
      : 'https://appcenter.intuit.com/connect/oauth2';

    const params = new URLSearchParams({
      client_id: QB_CLIENT_ID,
      response_type: 'code',
      scope: 'com.intuit.quickbooks.accounting',
      redirect_uri: QB_REDIRECT_URI,
      state,
    });

    res.json({ authUrl: `${baseUrl}?${params}` });
  } catch (error) {
    next(error);
  }
});

/**
 * QuickBooks OAuth callback
 */
router.get('/quickbooks/callback', async (req, res, next) => {
  try {
    const { code, state, realmId, error: qbError } = req.query;

    if (qbError) {
      return res.redirect(`${process.env.FRONTEND_URL}/settings/integrations?error=quickbooks_denied`);
    }

    // Decode state
    const { companyId, userId } = JSON.parse(Buffer.from(state, 'base64').toString());

    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${QB_CLIENT_ID}:${QB_CLIENT_SECRET}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: QB_REDIRECT_URI,
      }),
    });

    const tokens = await tokenResponse.json();

    if (!tokenResponse.ok) {
      console.error('QuickBooks token error:', tokens);
      return res.redirect(`${process.env.FRONTEND_URL}/settings/integrations?error=quickbooks_failed`);
    }

    // Get company info from QuickBooks
    const baseUrl = QB_ENVIRONMENT === 'production'
      ? 'https://quickbooks.api.intuit.com'
      : 'https://sandbox-quickbooks.api.intuit.com';

    const companyInfoResponse = await fetch(
      `${baseUrl}/v3/company/${realmId}/companyinfo/${realmId}`,
      {
        headers: {
          'Authorization': `Bearer ${tokens.access_token}`,
          'Accept': 'application/json',
        },
      }
    );

    let qbCompanyName = 'QuickBooks Company';
    if (companyInfoResponse.ok) {
      const companyInfo = await companyInfoResponse.json();
      qbCompanyName = companyInfo.CompanyInfo?.CompanyName || qbCompanyName;
    }

    // Store tokens (encrypted in production)
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { integrations: true },
    });

    await prisma.company.update({
      where: { id: companyId },
      data: {
        integrations: {
          ...(company?.integrations || {}),
          quickbooksRealmId: realmId,
          quickbooksAccessToken: tokens.access_token,
          quickbooksRefreshToken: tokens.refresh_token,
          quickbooksTokenExpiry: new Date(Date.now() + tokens.expires_in * 1000),
          quickbooksCompanyName: qbCompanyName,
          quickbooksConnectedAt: new Date(),
        },
      },
    });

    res.redirect(`${process.env.FRONTEND_URL}/settings/integrations?success=quickbooks`);
  } catch (error) {
    console.error('QuickBooks callback error:', error);
    res.redirect(`${process.env.FRONTEND_URL}/settings/integrations?error=quickbooks_failed`);
  }
});

/**
 * Disconnect QuickBooks
 */
router.post('/quickbooks/disconnect', authenticate, async (req, res, next) => {
  try {
    const company = await prisma.company.findUnique({
      where: { id: req.user.companyId },
      select: { integrations: true },
    });

    const integrations = company?.integrations || {};
    
    // Remove QB-specific fields
    delete integrations.quickbooksRealmId;
    delete integrations.quickbooksAccessToken;
    delete integrations.quickbooksRefreshToken;
    delete integrations.quickbooksTokenExpiry;
    delete integrations.quickbooksCompanyName;
    delete integrations.quickbooksConnectedAt;
    delete integrations.quickbooksLastSync;

    await prisma.company.update({
      where: { id: req.user.companyId },
      data: { integrations },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

/**
 * Manual sync with QuickBooks
 */
router.post('/quickbooks/sync', authenticate, async (req, res, next) => {
  try {
    const company = await prisma.company.findUnique({
      where: { id: req.user.companyId },
      select: { integrations: true },
    });

    if (!company?.integrations?.quickbooksRealmId) {
      return res.status(400).json({ error: 'QuickBooks not connected' });
    }

    // TODO: Implement actual sync logic
    // For now, just update last sync time
    await prisma.company.update({
      where: { id: req.user.companyId },
      data: {
        integrations: {
          ...company.integrations,
          quickbooksLastSync: new Date(),
        },
      },
    });

    res.json({ success: true, message: 'Sync started' });
  } catch (error) {
    next(error);
  }
});

// ============================================
// STRIPE CONNECT
// ============================================

/**
 * Get Stripe Connect URL
 */
router.get('/stripe/connect-url', authenticate, async (req, res, next) => {
  try {
    const company = await prisma.company.findUnique({
      where: { id: req.user.companyId },
      select: { name: true, email: true, integrations: true },
    });

    // Create or retrieve connected account
    let accountId = company?.integrations?.stripeAccountId;

    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'standard',
        email: company?.email,
        business_profile: {
          name: company?.name,
        },
        metadata: {
          companyId: req.user.companyId,
        },
      });
      accountId = account.id;

      // Save account ID
      await prisma.company.update({
        where: { id: req.user.companyId },
        data: {
          integrations: {
            ...(company?.integrations || {}),
            stripeAccountId: accountId,
          },
        },
      });
    }

    // Create account link for onboarding
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${process.env.FRONTEND_URL}/settings/integrations?stripe=refresh`,
      return_url: `${process.env.FRONTEND_URL}/settings/integrations?stripe=success`,
      type: 'account_onboarding',
    });

    res.json({ connectUrl: accountLink.url });
  } catch (error) {
    next(error);
  }
});

/**
 * Disconnect Stripe
 */
router.post('/stripe/disconnect', authenticate, async (req, res, next) => {
  try {
    const company = await prisma.company.findUnique({
      where: { id: req.user.companyId },
      select: { integrations: true },
    });

    const integrations = company?.integrations || {};
    
    // Optionally delete the connected account (or just unlink)
    // await stripe.accounts.del(integrations.stripeAccountId);
    
    delete integrations.stripeAccountId;

    await prisma.company.update({
      where: { id: req.user.companyId },
      data: { integrations },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ============================================
// SMS TOGGLE (Platform Twilio)
// ============================================

router.post('/sms/toggle', authenticate, async (req, res, next) => {
  try {
    const { enabled } = req.body;

    const company = await prisma.company.findUnique({
      where: { id: req.user.companyId },
      select: { settings: true },
    });

    await prisma.company.update({
      where: { id: req.user.companyId },
      data: {
        settings: {
          ...(company?.settings || {}),
          smsEnabled: enabled,
        },
      },
    });

    res.json({ success: true, enabled });
  } catch (error) {
    next(error);
  }
});

// ============================================
// EMAIL TOGGLE (Platform SendGrid)
// ============================================

router.post('/email/toggle', authenticate, async (req, res, next) => {
  try {
    const { enabled } = req.body;

    const company = await prisma.company.findUnique({
      where: { id: req.user.companyId },
      select: { settings: true },
    });

    await prisma.company.update({
      where: { id: req.user.companyId },
      data: {
        settings: {
          ...(company?.settings || {}),
          emailEnabled: enabled,
        },
      },
    });

    res.json({ success: true, enabled });
  } catch (error) {
    next(error);
  }
});

export default router;
