import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { auth_storage, decode_state_payload, exchange_code, issue_extension_code } from '@/shared/lib/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const [message, set_message] = useState('Finalizing authentication...');
  const [handoff_code, set_handoff_code] = useState('');

  const [needs_password, set_needs_password] = useState(false);
  const [password, set_password_val] = useState('');
  const [conf_password, set_conf_password_val] = useState('');
  const [password_loading, set_password_loading] = useState(false);

  const has_run_ref = useRef(false);

  const send_to_opener = (payload: { code: string; state?: string }): boolean => {
    if (!window.opener) return false;
    try {
      window.opener.postMessage(
        { type: 'ai_seo_extension_auth_code', code: payload.code, state: payload.state },
        '*',
      );
      return true;
    } catch {
      return false;
    }
  };

  useEffect(() => {
    if (has_run_ref.current) return;
    has_run_ref.current = true;

    const run = async () => {
      try {
        const query = new URLSearchParams(window.location.search);
        const code = query.get('code');
        const state = query.get('state') || undefined;
        const errorParam = query.get('error');

        if (errorParam) {
          if (errorParam === 'user_not_found') {
            throw new Error('User not found. Please create an account first.');
          }
          throw new Error(errorParam);
        }

        if (!code) throw new Error('Missing OAuth code');

        const exchanged = await exchange_code(code);
        auth_storage.set_tokens(exchanged);

        if (exchanged.user?.needs_password) {
          set_needs_password(true);
          set_message('Please set a password to continue');
          return;
        }

        const state_payload = decode_state_payload(state);
        if (state_payload?.flow === 'extension_connect' && state_payload.extension_redirect_uri) {
          set_message('Connecting extension...');
          const issued = await issue_extension_code({
            access_token: exchanged.access_token,
            redirect_uri: state_payload.extension_redirect_uri,
            state: state_payload.extension_state,
          });
          const sent = send_to_opener({ code: issued.code, state: issued.state });
          if (sent) {
            window.close();
            return;
          }
          set_handoff_code(issued.code);
          set_message('Could not message extension automatically. Copy the code below and paste it in the extension.');
          return;
        }

        navigate('/', { replace: true });
      } catch (error) {
        console.error('[AuthCallback] failed', error);
        set_message(error instanceof Error ? error.message : 'Authentication failed');
      }
    };

    void run();
  }, [navigate]);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== conf_password) {
      toast.error("Passwords don't match");
      return;
    }
    if (password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    const token = auth_storage.get_access_token();
    if (!token) return;

    set_password_loading(true);
    try {
      const { set_password } = await import('@/shared/lib/auth');
      await set_password(token, password);
      toast.success('Password set successfully!');
      auth_storage.update_user({ needs_password: false } as Record<string, unknown>);
      navigate('/', { replace: true });
    } catch (err: any) {
      toast.error(err.message || 'Failed to set password');
      set_password_loading(false);
    }
  }

  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-muted/50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle>Signing In</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent>
          {needs_password ? (
            <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-4 py-2">
              <div className="flex flex-col gap-1.5 text-left">
                <Label htmlFor="pass">New Password</Label>
                <Input
                  id="pass"
                  type="password"
                  value={password}
                  onChange={(e) => set_password_val(e.target.value)}
                  required
                  disabled={password_loading}
                />
              </div>
              <div className="flex flex-col gap-1.5 text-left">
                <Label htmlFor="cpass">Confirm Password</Label>
                <Input
                  id="cpass"
                  type="password"
                  value={conf_password}
                  onChange={(e) => set_conf_password_val(e.target.value)}
                  required
                  disabled={password_loading}
                />
              </div>
              <Button type="submit" disabled={password_loading} className="w-full mt-2">
                {password_loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Set Password"}
              </Button>
            </form>
          ) : !handoff_code ? (
            <div className="flex flex-col items-center gap-4 py-2">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <div className="w-full space-y-2">
                <Skeleton className="h-3 w-2/5" />
                <Skeleton className="h-9 w-full" />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">One-time code</p>
              <code className="block break-all rounded-md bg-muted px-3 py-2 text-sm font-mono text-foreground border">
                {handoff_code}
              </code>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
