import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/shared/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs';
import { Input } from '@/shared/components/ui/input';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/components/ui/select';
import { Shield, Activity, Users, Target, Activity as Pulse, Zap, Search, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { useOutletContext } from 'react-router-dom';
import { AppLayoutContext } from './app-layout';
import { auth_storage } from '@/shared/lib/auth';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'https://ai-seo-monorepo.onrender.com';

async function adminFetch(path: string) {
    const token = auth_storage.get_access_token();
    const r = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    const json = await r.json();
    if (!json.success) throw new Error(json.message || 'Request failed');
    return json.data;
}

function SegmentBadge({ segment }: { segment?: string | null }) {
    if (!segment) return <span className="text-muted-foreground text-xs">—</span>;
    const color = segment === 'Hot' ? 'destructive' : segment === 'Warm' ? 'default' : 'secondary';
    return <Badge variant={color as any}>{segment}</Badge>;
}

function RoleBadge({ role }: { role?: string | null }) {
    return <Badge variant={role === 'admin' ? 'default' : 'outline'}>{role ?? 'user'}</Badge>;
}

// ─── Users Tab ────────────────────────────────────────────────────────────────
function UsersTab() {
    const [users, setUsers] = useState<any[]>([]);
    const [total, setTotal] = useState(0);
    const [search, setSearch] = useState('');
    const [segment, setSegment] = useState('all');
    const [offset, setOffset] = useState(0);
    const [loading, setLoading] = useState(false);
    const limit = 20;

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
            if (search) q.set('search', search);
            if (segment !== 'all') q.set('segment', segment);
            const data = await adminFetch(`/api/analytics/admin/users?${q}`);
            setUsers(data.users);
            setTotal(data.total);
        } catch { /* ignore */ } finally { setLoading(false); }
    }, [search, segment, offset]);

    useEffect(() => { setOffset(0); }, [search, segment]);
    useEffect(() => { void load(); }, [load]);

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap gap-3 items-center">
                <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search by email or name…" className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <Select value={segment} onValueChange={setSegment}>
                    <SelectTrigger className="w-[160px]"><SelectValue placeholder="Lead Segment" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Segments</SelectItem>
                        <SelectItem value="Hot">🔥 Hot</SelectItem>
                        <SelectItem value="Warm">🟡 Warm</SelectItem>
                        <SelectItem value="Cold">🔵 Cold</SelectItem>
                    </SelectContent>
                </Select>
                <Button variant="outline" size="icon" onClick={load}><RefreshCw className="h-4 w-4" /></Button>
                <span className="text-sm text-muted-foreground">{total} users</span>
            </div>

            <div className="rounded-md border overflow-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b bg-muted/50">
                            <th className="text-left px-4 py-3 font-medium">Email</th>
                            <th className="text-left px-4 py-3 font-medium">Name</th>
                            <th className="text-left px-4 py-3 font-medium">Role</th>
                            <th className="text-left px-4 py-3 font-medium">Company</th>
                            <th className="text-left px-4 py-3 font-medium">Job Role</th>
                            <th className="text-right px-4 py-3 font-medium">Lead Score</th>
                            <th className="text-left px-4 py-3 font-medium">Segment</th>
                            <th className="text-right px-4 py-3 font-medium">Signals</th>
                            <th className="text-left px-4 py-3 font-medium">Joined</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
                        ) : users.length === 0 ? (
                            <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">No users found</td></tr>
                        ) : users.map((u: any) => (
                            <tr key={u.id} className="border-b hover:bg-muted/30 transition-colors">
                                <td className="px-4 py-3 font-mono text-xs">{u.email}</td>
                                <td className="px-4 py-3">{u.name ?? '—'}</td>
                                <td className="px-4 py-3"><RoleBadge role={u.app_role} /></td>
                                <td className="px-4 py-3 text-muted-foreground">{u.company_name ?? u.company_domain ?? '—'}</td>
                                <td className="px-4 py-3 text-muted-foreground">{u.job_role ?? '—'}</td>
                                <td className="px-4 py-3 text-right font-semibold">{u.lead_score_current != null ? u.lead_score_current.toFixed(1) : '—'}</td>
                                <td className="px-4 py-3"><SegmentBadge segment={u.lead_segment} /></td>
                                <td className="px-4 py-3 text-right">{u._count?.leadSignals ?? 0}</td>
                                <td className="px-4 py-3 text-muted-foreground text-xs">{new Date(u.created_at).toLocaleDateString()}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Showing {offset + 1}–{Math.min(offset + limit, total)} of {total}</span>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(o => Math.max(0, o - limit))}>
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="sm" disabled={offset + limit >= total} onClick={() => setOffset(o => o + limit)}>
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>
            </div>
        </div>
    );
}

// ─── Analytics Events Tab ─────────────────────────────────────────────────────
function EventsTab() {
    const [events, setEvents] = useState<any[]>([]);
    const [total, setTotal] = useState(0);
    const [eventName, setEventName] = useState('');
    const [userId, setUserId] = useState('');
    const [offset, setOffset] = useState(0);
    const [loading, setLoading] = useState(false);
    const limit = 25;

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
            if (eventName) q.set('event_name', eventName);
            if (userId) q.set('user_id', userId);
            const data = await adminFetch(`/api/analytics/admin/events?${q}`);
            setEvents(data.events);
            setTotal(data.total);
        } catch { /* ignore */ } finally { setLoading(false); }
    }, [eventName, userId, offset]);

    useEffect(() => { setOffset(0); }, [eventName, userId]);
    useEffect(() => { void load(); }, [load]);

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap gap-3 items-center">
                <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Filter by event name…" className="pl-9" value={eventName} onChange={e => setEventName(e.target.value)} />
                </div>
                <Input placeholder="Filter by User ID…" className="w-[260px]" value={userId} onChange={e => setUserId(e.target.value)} />
                <Button variant="outline" size="icon" onClick={load}><RefreshCw className="h-4 w-4" /></Button>
                <span className="text-sm text-muted-foreground">{total} events</span>
            </div>

            <div className="rounded-md border overflow-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b bg-muted/50">
                            <th className="text-left px-4 py-3 font-medium">Event</th>
                            <th className="text-left px-4 py-3 font-medium">User</th>
                            <th className="text-left px-4 py-3 font-medium">Campaign ID</th>
                            <th className="text-left px-4 py-3 font-medium">Properties</th>
                            <th className="text-left px-4 py-3 font-medium">Time</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
                        ) : events.length === 0 ? (
                            <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No events found</td></tr>
                        ) : events.map((e: any) => (
                            <tr key={e.id} className="border-b hover:bg-muted/30 transition-colors">
                                <td className="px-4 py-3 font-mono text-xs"><Badge variant="secondary">{e.event_name}</Badge></td>
                                <td className="px-4 py-3 text-xs text-muted-foreground">{e.user?.email ?? e.user_id}</td>
                                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{e.campaign_id ?? '—'}</td>
                                <td className="px-4 py-3 max-w-[280px] truncate text-xs text-muted-foreground">{JSON.stringify(e.properties)}</td>
                                <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{new Date(e.created_at).toLocaleString()}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Showing {offset + 1}–{Math.min(offset + limit, total)} of {total}</span>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(o => Math.max(0, o - limit))}>
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="sm" disabled={offset + limit >= total} onClick={() => setOffset(o => o + limit)}>
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>
            </div>
        </div>
    );
}

// ─── Lead Signals Tab ─────────────────────────────────────────────────────────
function SignalsTab() {
    const [signals, setSignals] = useState<any[]>([]);
    const [total, setTotal] = useState(0);
    const [signalType, setSignalType] = useState('');
    const [userId, setUserId] = useState('');
    const [offset, setOffset] = useState(0);
    const [loading, setLoading] = useState(false);
    const limit = 25;

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
            if (signalType) q.set('signal_type', signalType);
            if (userId) q.set('user_id', userId);
            const data = await adminFetch(`/api/analytics/admin/signals?${q}`);
            setSignals(data.signals);
            setTotal(data.total);
        } catch { /* ignore */ } finally { setLoading(false); }
    }, [signalType, userId, offset]);

    useEffect(() => { setOffset(0); }, [signalType, userId]);
    useEffect(() => { void load(); }, [load]);

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap gap-3 items-center">
                <Select value={signalType || 'all'} onValueChange={(v: string) => setSignalType(v === 'all' ? '' : v)}>
                    <SelectTrigger className="w-[200px]"><SelectValue placeholder="Signal type" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Types</SelectItem>
                        <SelectItem value="budget_intent">Budget Intent</SelectItem>
                        <SelectItem value="competitor_comparison">Competitor Comparison</SelectItem>
                        <SelectItem value="purchase_intent">Purchase Intent</SelectItem>
                    </SelectContent>
                </Select>
                <Input placeholder="Filter by User ID…" className="w-[260px]" value={userId} onChange={e => setUserId(e.target.value)} />
                <Button variant="outline" size="icon" onClick={load}><RefreshCw className="h-4 w-4" /></Button>
                <span className="text-sm text-muted-foreground">{total} signals</span>
            </div>

            <div className="rounded-md border overflow-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b bg-muted/50">
                            <th className="text-left px-4 py-3 font-medium">Signal Type</th>
                            <th className="text-left px-4 py-3 font-medium">User</th>
                            <th className="text-right px-4 py-3 font-medium">Confidence</th>
                            <th className="text-left px-4 py-3 font-medium">Value</th>
                            <th className="text-left px-4 py-3 font-medium">Time</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
                        ) : signals.length === 0 ? (
                            <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No signals found</td></tr>
                        ) : signals.map((s: any) => (
                            <tr key={s.id} className="border-b hover:bg-muted/30 transition-colors">
                                <td className="px-4 py-3"><Badge variant="outline">{s.signal_type}</Badge></td>
                                <td className="px-4 py-3 text-xs text-muted-foreground">{s.user?.email ?? s.user_id}</td>
                                <td className="px-4 py-3 text-right font-semibold">
                                    <span className={s.confidence > 0.7 ? 'text-green-500' : s.confidence > 0.4 ? 'text-yellow-500' : 'text-muted-foreground'}>
                                        {(s.confidence * 100).toFixed(0)}%
                                    </span>
                                </td>
                                <td className="px-4 py-3 text-xs text-muted-foreground max-w-[280px] truncate">{JSON.stringify(s.value)}</td>
                                <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{new Date(s.created_at).toLocaleString()}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Showing {offset + 1}–{Math.min(offset + limit, total)} of {total}</span>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(o => Math.max(0, o - limit))}>
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="sm" disabled={offset + limit >= total} onClick={() => setOffset(o => o + limit)}>
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>
            </div>
        </div>
    );
}

// ─── Main Admin Dashboard ─────────────────────────────────────────────────────
export default function AdminDashboardPage() {
    const { user } = useOutletContext<AppLayoutContext>();
    const [stats, setStats] = useState<any>(null);

    useEffect(() => {
        adminFetch('/api/analytics/admin/stats').then(setStats).catch(() => { });
    }, []);

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Admin Dashboard</h2>
                    <p className="text-muted-foreground text-sm">Logged in as <span className="font-medium">{user.email}</span></p>
                </div>
                <Badge variant="default" className="gap-1"><Shield className="h-3 w-3" /> Admin</Badge>
            </div>

            {/* Stats cards */}
            <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Total Users</CardTitle>
                        <Users className="h-4 w-4 text-primary" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats?.user_count ?? '—'}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Analytics Events</CardTitle>
                        <Pulse className="h-4 w-4 text-primary" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats?.event_count ?? '—'}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Intent Signals</CardTitle>
                        <Target className="h-4 w-4 text-primary" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats?.signal_count ?? '—'}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Active Campaigns</CardTitle>
                        <Activity className="h-4 w-4 text-primary" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats?.campaign_count ?? '—'}</div>
                    </CardContent>
                </Card>
            </div>

            {/* Tabbed data views */}
            <Card>
                <CardHeader>
                    <CardTitle>Data Explorer</CardTitle>
                    <CardDescription>Browse and filter all user, behavioral, and intent data across the platform.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Tabs defaultValue="users">
                        <TabsList className="mb-4">
                            <TabsTrigger value="users" className="gap-1.5"><Users className="h-3 w-3" /> Users</TabsTrigger>
                            <TabsTrigger value="events" className="gap-1.5"><Zap className="h-3 w-3" /> Analytics Events</TabsTrigger>
                            <TabsTrigger value="signals" className="gap-1.5"><Target className="h-3 w-3" /> Lead Signals</TabsTrigger>
                        </TabsList>
                        <TabsContent value="users"><UsersTab /></TabsContent>
                        <TabsContent value="events"><EventsTab /></TabsContent>
                        <TabsContent value="signals"><SignalsTab /></TabsContent>
                    </Tabs>
                </CardContent>
            </Card>
        </div>
    );
}
