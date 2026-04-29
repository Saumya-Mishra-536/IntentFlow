import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader } from '@/shared/components/ui/card';
import { Input } from '@/shared/components/ui/input';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/shared/components/ui/sheet';
import { Search, ChevronLeft, ChevronRight, RefreshCw, BarChart2, Mail, Building, Activity } from 'lucide-react';
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

export default function AdminUsersPage() {
    const [users, setUsers] = useState<any[]>([]);
    const [total, setTotal] = useState(0);
    const [search, setSearch] = useState('');
    const [segment, setSegment] = useState('all');
    const [offset, setOffset] = useState(0);
    const [loading, setLoading] = useState(false);

    // Drawer state
    const [selectedUser, setSelectedUser] = useState<any | null>(null);
    const [userSignals, setUserSignals] = useState<any[]>([]);
    const [drawerLoading, setDrawerLoading] = useState(false);

    const limit = 20;

    const loadUsers = useCallback(async () => {
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
    useEffect(() => { void loadUsers(); }, [loadUsers]);

    const handleUserClick = async (user: any) => {
        setSelectedUser(user);
        setDrawerLoading(true);
        try {
            const signalsData = await adminFetch(`/api/analytics/admin/signals?user_id=${user.id}&limit=50`);
            setUserSignals(signalsData.signals);
        } catch {
            setUserSignals([]);
        } finally {
            setDrawerLoading(false);
        }
    };

    return (
        <div className="flex-1 space-y-4 p-8 pt-6 overflow-auto bg-muted/20">
            <div className="flex items-center justify-between space-y-2">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Users & Leads</h2>
                    <p className="text-muted-foreground">Manage platform users and analyze lead intelligence scores.</p>
                </div>
            </div>

            <Card>
                <CardHeader className="pb-3">
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
                        <Button variant="outline" size="icon" onClick={loadUsers}><RefreshCw className="h-4 w-4" /></Button>
                        <span className="text-sm text-muted-foreground">{total} users</span>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="rounded-md border overflow-hidden">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b bg-muted/50">
                                    <th className="text-left px-4 py-3 font-medium">User</th>
                                    <th className="text-left px-4 py-3 font-medium">Role</th>
                                    <th className="text-left px-4 py-3 font-medium">Company</th>
                                    <th className="text-right px-4 py-3 font-medium">Lead Score</th>
                                    <th className="text-left px-4 py-3 font-medium">Segment</th>
                                    <th className="text-right px-4 py-3 font-medium">Signals</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Loading users...</td></tr>
                                ) : users.length === 0 ? (
                                    <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No users found</td></tr>
                                ) : users.map((u: any) => (
                                    <tr
                                        key={u.id}
                                        className="border-b hover:bg-muted/30 transition-colors cursor-pointer group"
                                        onClick={() => handleUserClick(u)}
                                    >
                                        <td className="px-4 py-3">
                                            <div className="font-medium group-hover:text-primary transition-colors">{u.name || 'Unknown'}</div>
                                            <div className="text-xs text-muted-foreground">{u.email}</div>
                                        </td>
                                        <td className="px-4 py-3"><RoleBadge role={u.app_role} /></td>
                                        <td className="px-4 py-3 text-muted-foreground">
                                            <div className="truncate max-w-[150px]">{u.company_name ?? u.company_domain ?? '—'}</div>
                                            <div className="text-xs">{u.job_role}</div>
                                        </td>
                                        <td className="px-4 py-3 text-right font-semibold">
                                            {u.lead_score_current != null ? u.lead_score_current.toFixed(1) : '—'}
                                        </td>
                                        <td className="px-4 py-3"><SegmentBadge segment={u.lead_segment} /></td>
                                        <td className="px-4 py-3 text-right">
                                            <Badge variant="secondary">{u._count?.leadSignals ?? 0}</Badge>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="flex items-center justify-between mt-4">
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
                </CardContent>
            </Card>

            {/* User Details Drawer */}
            <Sheet open={!!selectedUser} onOpenChange={(open) => !open && setSelectedUser(null)}>
                <SheetContent className="sm:max-w-xl overflow-y-auto">
                    <SheetHeader className="mb-6">
                        <SheetTitle className="text-2xl">{selectedUser?.name || 'User Details'}</SheetTitle>
                        <SheetDescription className="flex items-center gap-2">
                            <Mail className="h-4 w-4" /> {selectedUser?.email}
                        </SheetDescription>
                    </SheetHeader>

                    {selectedUser && (
                        <div className="space-y-6">
                            {/* Profile Details */}
                            <div className="grid grid-cols-2 gap-4">
                                <Card>
                                    <CardContent className="p-4 flex gap-3 items-center">
                                        <div className="p-2 bg-primary/10 rounded-full"><Building className="h-5 w-5 text-primary" /></div>
                                        <div>
                                            <div className="text-sm font-medium">Company</div>
                                            <div className="text-xs text-muted-foreground truncate w-[140px]">{selectedUser.company_name || selectedUser.company_domain || 'Not provided'}</div>
                                        </div>
                                    </CardContent>
                                </Card>
                                <Card>
                                    <CardContent className="p-4 flex gap-3 items-center">
                                        <div className="p-2 bg-primary/10 rounded-full"><BarChart2 className="h-5 w-5 text-primary" /></div>
                                        <div>
                                            <div className="text-sm font-medium">Lead Score</div>
                                            <div className="flex items-center gap-2">
                                                <span className="font-bold">{selectedUser.lead_score_current?.toFixed(1) || 0}</span>
                                                <SegmentBadge segment={selectedUser.lead_segment} />
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>

                            {/* Intent Signals List */}
                            <div>
                                <h3 className="font-semibold mb-3 flex items-center gap-2">
                                    <Activity className="h-4 w-4 text-primary" /> Latest Intent Signals
                                </h3>

                                {drawerLoading ? (
                                    <div className="text-sm text-muted-foreground p-4 border rounded-md text-center">Loading signals...</div>
                                ) : userSignals.length === 0 ? (
                                    <div className="text-sm text-muted-foreground p-4 border rounded-md text-center bg-muted/20">
                                        No intent signals captured yet.
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        {userSignals.map((signal: any) => (
                                            <div key={signal.id} className="p-3 border rounded-md flex justify-between items-start bg-card shadow-sm hover:border-primary/50 transition-colors">
                                                <div>
                                                    <Badge variant="outline" className="mb-1">{signal.signal_type}</Badge>
                                                    <div className="text-sm mt-1">
                                                        {typeof signal.value === 'object' ? JSON.stringify(signal.value) : signal.value}
                                                    </div>
                                                </div>
                                                <div className="text-right flex flex-col items-end gap-1">
                                                    <div className="text-xs text-muted-foreground">{new Date(signal.created_at).toLocaleDateString()}</div>
                                                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${signal.confidence > 0.7 ? 'bg-green-500/10 text-green-500' :
                                                        signal.confidence > 0.4 ? 'bg-yellow-500/10 text-yellow-500' :
                                                            'bg-muted text-muted-foreground'
                                                        }`}>
                                                        {(signal.confidence * 100).toFixed(0)}% Match
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </SheetContent>
            </Sheet>
        </div>
    );
}
