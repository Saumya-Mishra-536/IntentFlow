import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { auth_storage, bootstrap_onboarding, get_onboarding_context, switch_account } from '@/shared/lib/auth';
import { Sparkles } from 'lucide-react';
import { toast } from 'sonner';

export default function OnboardingPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'create_account' | 'join_account'>('create_account');
  const [domain_url, set_domain_url] = useState('');
  const [account_slug, set_account_slug] = useState('');
  const [submitting, set_submitting] = useState(false);
  const [loading_context, set_loading_context] = useState(true);
  const [pending_message, set_pending_message] = useState('');

  useEffect(() => {
    const boot = async () => {
      const token = auth_storage.get_access_token();
      if (!token) {
        set_loading_context(false);
        return;
      }
      try {
        const context = await get_onboarding_context(token);
        if (!context.needs_onboarding) {
          navigate('/workspace', { replace: true });
          return;
        }
      } catch {
        // Keep onboarding visible.
      } finally {
        set_loading_context(false);
      }
    };
    void boot();
  }, [navigate]);

  const handle_submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const token = auth_storage.get_access_token();
    if (!token) {
      toast.error('Please sign in again');
      window.location.href = '/sign-in';
      return;
    }

    if (mode === 'create_account' && !domain_url.trim()) {
      toast.error('Domain is required');
      return;
    }
    if (mode === 'join_account' && !account_slug.trim()) {
      toast.error('Account slug is required');
      return;
    }

    set_submitting(true);
    set_pending_message('');
    try {
      const context = await bootstrap_onboarding(
        token,
        mode === 'create_account'
          ? { mode: 'create_account', domain_url: domain_url.trim() }
          : { mode: 'join_account', account_slug: account_slug.trim().toLowerCase() },
      );

      if (context.join_request?.status === 'pending') {
        set_pending_message(`Request sent. Account @${context.join_request.account_slug} must approve access.`);
        toast.success('Join request submitted');
        return;
      }

      if (context.active_account?.tenant_id) {
        await switch_account(token, context.active_account.tenant_id);
      }

      if (!context.needs_onboarding) {
        navigate('/workspace', { replace: true });
        return;
      }

      toast.success('Account created.');
      navigate('/workspace', { replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to complete onboarding');
    } finally {
      set_submitting(false);
    }
  };

  const handleLogout = () => {
    auth_storage.clear();
    window.location.href = '/';
  };

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-muted/50 p-4">
      <Button
        variant="ghost"
        size="sm"
        onClick={handleLogout}
        className="absolute top-4 right-4 text-muted-foreground"
      >
        Sign out
      </Button>
      <div className="mb-8 text-center space-y-3">
        <div className="flex justify-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Sparkles className="h-6 w-6 text-primary" />
          </div>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Set up your account</h1>
        <p className="text-muted-foreground text-sm max-w-sm">
          Create an account with your domain, or request access to an existing account.
        </p>
      </div>

      <Card className="w-full max-w-md mx-auto">
        <CardHeader>
          <CardTitle>Account onboarding</CardTitle>
          <CardDescription>Create account + domain scrape, or join an existing account.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 grid grid-cols-2 rounded-md border p-1">
            <Button
              type="button"
              variant={mode === 'create_account' ? 'default' : 'ghost'}
              className="h-8"
              onClick={() => setMode('create_account')}
              disabled={loading_context || submitting}
            >
              Create account
            </Button>
            <Button
              type="button"
              variant={mode === 'join_account' ? 'default' : 'ghost'}
              className="h-8"
              onClick={() => setMode('join_account')}
              disabled={loading_context || submitting}
            >
              Join account
            </Button>
          </div>

          <form onSubmit={handle_submit} className="flex flex-col gap-4">
            {mode === 'create_account' ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="domain_url">Domain</Label>
                <Input
                  id="domain_url"
                  placeholder="example.com"
                  value={domain_url}
                  onChange={(event) => set_domain_url(event.target.value)}
                  disabled={loading_context || submitting}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  We will scrape your website context before onboarding completes.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="account_slug">Account slug</Label>
                <Input
                  id="account_slug"
                  placeholder="acme-account"
                  value={account_slug}
                  onChange={(event) => set_account_slug(event.target.value)}
                  disabled={loading_context || submitting}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  This sends an access request to that account's owner/admin.
                </p>
              </div>
            )}

            {pending_message ? <p className="text-xs text-amber-700">{pending_message}</p> : null}

            <div className="flex justify-end pt-2">
              <Button type="submit" disabled={loading_context || submitting}>
                {loading_context ? 'Checking...' : submitting ? 'Submitting...' : 'Continue'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
