import { Router } from 'express';
import rateLimit from 'express-rate-limit';

import { authMiddleware } from '../../middlewares/auth.middleware';
import { authController } from './auth.controller';

const router = Router();

// Rate-limit only the token-issuing endpoints that could be brute-forced.
// OAuth flows (google/start, google/callback, extension/exchange) are
// exempt — they involve redirects and are already gated by Google's OAuth.
// Disabled in development so local testing is never blocked.
const isDev = process.env['NODE_ENV'] !== 'production';
const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: isDev ? 0 : 15,      // 0 = unlimited in dev
    skip: () => isDev,         // extra guard: skip entirely in dev
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests — please try again later.' },
});

router.get('/google/start', authController.startGoogle);
router.get('/google/callback', authController.googleCallback);
router.post('/login', authRateLimiter, authController.login);
router.post('/set-password', authMiddleware, authRateLimiter, authController.setPassword);
router.post('/extension/exchange', authController.exchangeExtensionCode);
router.post('/code/exchange', authController.exchangeExtensionCode);
router.post('/issue-code', authMiddleware, authController.issueAuthCode);
router.post('/token/refresh', authRateLimiter, authController.refreshToken); // rate-limited
router.post('/logout', authRateLimiter, authController.logout);              // rate-limited
router.post('/switch-account', authMiddleware, authController.switchAccount);
router.get('/me', authMiddleware, authController.me);

export default router;
