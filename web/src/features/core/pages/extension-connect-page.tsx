import { useEffect, useMemo, useState } from 'react';

import { auth_storage, get_me, issue_extension_code, start_google_login } from '@/shared/lib/auth';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { Loader2, Plug } from 'lucide-react';

export default function ExtensionConnectPage() {
  const query = useMemo(() => new URLSearchParams(window.location.search), []);
  const extension_redirect_uri = query.get('extension_redirect_uri') ?? '';
  const extension_state = query.get('state') ?? undefined;
  const auto = query.get('auto') === '1';

  const [loading, set_loading] = useState(true);
  const [is_signed_in, set_is_signed_in] = useState(false);
  const [message, set_message] = useState('Checking web session...');
  const [handoff_code, set_handoff_code] = useState('');
  const [connecting, set_connecting] = useState(false);

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

  const connect_extension = async () => {
    const access_token = auth_storage.get_access_token();
    if (!access_token) { set_message('No active session found'); return; }
    if (!extension_redirect_uri) { set_message('Missing extension_redirect_uri'); return; }

    set_connecting(true);
    set_message('Sending secure handoff to extension...');
    try {
      const issued = await issue_extension_code({
        access_token,
        redirect_uri: extension_redirect_uri,
        state: extension_state,
      });
      const sent = send_to_opener({ code: issued.code, state: issued.state });
      if (sent) { window.close(); return; }
      set_handoff_code(issued.code);
      set_message('Could not message extension automatically. Copy the code below and paste it in the extension.');
    } catch (error) {
      set_message(error instanceof Error ? error.message : 'Failed to connect extension');
    } finally {
      set_connecting(false);
    }
  };

  useEffect(() => {
    const boot = async () => {
      const access_token = auth_storage.get_access_token();
      if (!access_token) {
        set_loading(false);
        set_is_signed_in(false);
        set_message('Sign in to continue');
        return;
      }
      try {
        await get_me(access_token);
        set_is_signed_in(true);
        set_message('Web session found. Ready to connect.');
      } catch {
        auth_storage.clear();
        set_is_signed_in(false);
        set_message('Sign in to continue');
      } finally {
        set_loading(false);
      }
    };
    void boot();
  }, []);

  useEffect(() => {
    if (!loading && is_signed_in && auto) {
      void connect_extension();
    }
  }, [loading, is_signed_in, auto]);

  const start_google_for_extension = () => {
    start_google_login({
      flow: 'extension_connect',
      extension_redirect_uri,
      extension_state: extension_state ?? '',
    });
  };

  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-muted/50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <Plug className="h-5 w-5 text-primary" />
            </div>
          </div>
          <CardTitle>Connect Extension</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {loading && (
            <div className="flex flex-col items-center gap-4 py-2">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <div className="w-full space-y-2">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-4 w-3/5 mx-auto" />
              </div>
            </div>
          )}

          {!loading && !is_signed_in && (
            <Button className="w-full" onClick={start_google_for_extension}>
              Sign in with Google
            </Button>
          )}

          {!loading && is_signed_in && (
            <div className="space-y-4">
              <Button
                className="w-full"
                onClick={() => void connect_extension()}
                disabled={connecting}
              >
                {connecting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {connecting ? 'Connecting...' : 'Continue to Extension'}
              </Button>

              {handoff_code && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">One-time code</p>
                  <code className="block break-all rounded-md bg-muted px-3 py-2 text-sm font-mono text-foreground border">
                    {handoff_code}
                  </code>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
