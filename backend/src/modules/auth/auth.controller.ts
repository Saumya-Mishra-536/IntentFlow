import { Request, Response } from 'express';

import { ApiResponse } from '../../core/api-response';
import { BaseController } from '../../core/controller';
import { HttpException } from '../../core/http-exception';
import { AuthenticatedRequest } from '../../types/express';
import { exchangeExtensionSchema } from './dto/exchange-extension.dto';
import { issueAuthCodeSchema } from './dto/issue-auth-code.dto';
import { refreshTokenSchema } from './dto/refresh-token.dto';
import { loginSchema } from './dto/login.dto';
import { setPasswordSchema } from './dto/set-password.dto';
import { switchAccountSchema } from './dto/switch-account.dto';
import { AuthService, authService } from './auth.service';

class AuthController extends BaseController {
  constructor(private readonly service: AuthService = authService) {
    super();
  }

  startGoogle = async (req: Request, res: Response) => {
    const redirect_uri = typeof req.query.redirect_uri === 'string' ? req.query.redirect_uri : undefined;
    const state = typeof req.query.state === 'string' ? req.query.state : undefined;
    const action = typeof req.query.action === 'string' && ['signin', 'signup'].includes(req.query.action) ? (req.query.action as 'signin' | 'signup') : undefined;
    const url = this.service.startGoogleOAuth({ redirect_uri, client_state: state, action });
    return res.redirect(url);
  };

  googleCallback = async (req: Request, res: Response) => {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const googleError = typeof req.query.error === 'string' ? req.query.error : '';

    if (!state) {
      throw new HttpException(400, 'Missing OAuth state');
    }

    // Google returned an error (user denied, misconfiguration, etc.) or issued no code.
    // Decode the state so we can redirect the user back gracefully instead of crashing.
    if (googleError || !code) {
      const decoded = this.service.decodeOAuthState(state);
      const redirect_url = new URL(decoded.redirect_uri);
      redirect_url.searchParams.set('error', googleError || 'access_denied');
      if (decoded.client_state) redirect_url.searchParams.set('state', decoded.client_state);
      return res.redirect(redirect_url.toString());
    }

    const result = await this.service.completeGoogleOAuth({ code, state });
    const redirect_url = new URL(result.redirect_uri);

    if ('error' in result && result.error) {
      redirect_url.searchParams.set('error', result.error);
    } else if ('code' in result && result.code) {
      redirect_url.searchParams.set('code', result.code);
    }

    if (result.state) {
      redirect_url.searchParams.set('state', result.state);
    }
    return res.redirect(redirect_url.toString());
  };


  exchangeExtensionCode = async (req: Request, res: Response) => {
    const validated = exchangeExtensionSchema.parse(req.body);
    const data = await this.service.exchangeExtensionCode(validated.code);
    return res.json(ApiResponse.success(data, 'Extension auth exchange successful'));
  };

  issueAuthCode = async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user?.id) {
      throw new HttpException(401, 'Unauthorized');
    }
    const validated = issueAuthCodeSchema.parse(req.body);
    const data = await this.service.issueAuthCodeForUser({
      user_id: req.user.id,
      redirect_uri: validated.redirect_uri,
      state: validated.state,
    });
    return res.json(ApiResponse.success(data, 'Auth code issued'));
  };

  refreshToken = async (req: Request, res: Response) => {
    const validated = refreshTokenSchema.parse(req.body);
    const data = await this.service.refreshAccessToken(validated.refresh_token);
    return res.json(ApiResponse.success(data, 'Token refreshed'));
  };

  switchAccount = async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user?.id) {
      throw new HttpException(401, 'Unauthorized');
    }
    const validated = switchAccountSchema.parse(req.body);
    const data = await this.service.switchAccount({
      user_id: req.user.id,
      tenant_id: validated.tenant_id,
    });
    return res.json(ApiResponse.success(data, 'Account switched'));
  };

  logout = async (req: Request, res: Response) => {
    const validated = refreshTokenSchema.parse(req.body);
    const data = await this.service.logout(validated.refresh_token);
    return res.json(ApiResponse.success(data, 'Logout processed'));
  };

  login = async (req: Request, res: Response) => {
    const validated = loginSchema.parse(req.body);
    const data = await this.service.loginWithEmail(validated.email, validated.password);
    return res.json(ApiResponse.success(data, 'Login successful'));
  };

  setPassword = async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user?.id) {
      throw new HttpException(401, 'Unauthorized');
    }
    const validated = setPasswordSchema.parse(req.body);
    await this.service.setPassword(req.user.id, validated.password);
    return res.json(ApiResponse.success(null, 'Password updated successfully'));
  };

  me = async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user?.id) {
      throw new HttpException(401, 'Unauthorized');
    }
    const data = await this.service.getMe(req.user.id);
    return res.json(ApiResponse.success(data));
  };
}

export const authController = new AuthController();
