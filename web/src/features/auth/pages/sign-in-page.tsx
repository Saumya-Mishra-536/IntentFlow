import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { auth_storage, login_with_email, start_google_login } from '@/shared/lib/auth';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import chatgptLogo from '/chatgpt.svg';
import claudeLogo from '/claude.svg';
import geminiLogo from '/gemini-light.svg';
import perplexityLogo from '/perplexity.svg';
import grokLogo from '/grok-(xai).svg';

export default function SignInPage() {
    const navigate = useNavigate();
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');

    // If already signed in, bounce to dashboard
    useEffect(() => {
        if (auth_storage.get_access_token()) navigate('/', { replace: true });
    }, [navigate]);

    const handleLogin = (action: 'signin' | 'signup') => {
        try {
            start_google_login({ flow: 'web_dashboard' }, action);
        } catch {
            setError('Could not start ' + (action === 'signin' ? 'sign-in' : 'sign-up') + '. Please try again.');
        }
    };

    const handleEmailSignIn = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);
        try {
            const result = await login_with_email(email, password);
            // Send admins directly to the admin dashboard
            const isAdmin = result?.user?.app_role === 'admin';
            window.location.href = isAdmin ? '/admin' : '/';
        } catch (err: any) {
            setError(err.message || 'Invalid email or password');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <main className="flex min-h-screen w-full items-center justify-center bg-muted/50 p-4">
            <Card className="w-full max-w-sm">
                <CardHeader className="text-center space-y-1">
                    <CardTitle className="text-2xl">Intent</CardTitle>
                    <CardDescription>Welcome to Intent SEO</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <Tabs defaultValue="signin" className="w-full">
                        <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="signin">Sign In</TabsTrigger>
                            <TabsTrigger value="signup">Sign Up</TabsTrigger>
                        </TabsList>

                        <TabsContent value="signin" className="space-y-4 mt-4">
                            <form onSubmit={handleEmailSignIn} className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="email">Email</Label>
                                    <Input
                                        id="email"
                                        type="email"
                                        placeholder="admin@relicwave.com"
                                        required
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        disabled={isLoading}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="password">Password</Label>
                                    <Input
                                        id="password"
                                        type="password"
                                        required
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        disabled={isLoading}
                                    />
                                </div>
                                <Button type="submit" className="w-full" disabled={isLoading}>
                                    {isLoading ? 'Signing in...' : 'Sign in with Email'}
                                </Button>
                            </form>

                            <div className="relative">
                                <div className="absolute inset-0 flex items-center">
                                    <span className="w-full border-t" />
                                </div>
                                <div className="relative flex justify-center text-xs uppercase">
                                    <span className="bg-background px-2 text-muted-foreground">Or continue with</span>
                                </div>
                            </div>

                            <Button variant="outline" className="w-full" onClick={() => handleLogin('signin')} disabled={isLoading}>
                                Google
                            </Button>
                        </TabsContent>

                        <TabsContent value="signup" className="space-y-4 mt-4">
                            <Button variant="outline" className="w-full" onClick={() => handleLogin('signup')}>
                                Sign up with Google
                            </Button>
                        </TabsContent>
                    </Tabs>

                    {error && <p className="text-center text-sm text-destructive">{error}</p>}
                    <div className="flex flex-col items-center gap-3 pt-4 border-t border-border/50">
                        <p className="text-xs text-muted-foreground">Supported AI tools</p>
                        <div className="flex items-center gap-4 opacity-70">
                            <img src={chatgptLogo} alt="ChatGPT" className="w-5 h-5 object-contain hover:opacity-100 transition-opacity" />
                            <img src={claudeLogo} alt="Claude" className="w-5 h-5 object-contain hover:opacity-100 transition-opacity" />
                            <img src={geminiLogo} alt="Gemini" className="w-5 h-5 object-contain hover:opacity-100 transition-opacity" />
                            <img src={perplexityLogo} alt="Perplexity" className="w-5 h-5 object-contain hover:opacity-100 transition-opacity" />
                            <img src={grokLogo} alt="Grok" className="w-5 h-5 object-contain hover:opacity-100 transition-opacity" />
                        </div>
                    </div>
                </CardContent>
            </Card>
        </main>
    );
}
