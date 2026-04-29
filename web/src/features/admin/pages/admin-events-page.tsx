import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader } from '@/shared/components/ui/card';
import { Input } from '@/shared/components/ui/input';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Search, ChevronLeft, ChevronRight, RefreshCw, Zap } from 'lucide-react';
import { auth_storage } from '@/shared/lib/auth';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'https://ai-seo-monorepo.onrender.com';

async function adminFetch(path: string) {
    const token = auth_storage.get_access_token();
    const r = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    const json = await r.json();
    if (!json.success) throw new Error(json.message || 'Request failed');
    return json.data;
}

export default function AdminEventsPage() {
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

    // Grouping properties dynamically for better display
    const renderProperties = (propsObj: any) => {
        if (!propsObj || Object.keys(propsObj).length === 0) return <span className="text-muted-foreground">—</span>;

        return (
            <div className="flex flex-wrap gap-1">
                {Object.entries(propsObj).map(([key, value]) => (
                    <Badge key={key} variant="outline" className="text-[10px] font-mono whitespace-nowrap bg-muted/20">
                        <span className="text-muted-foreground mr-1">{key}:</span>
                        {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                    </Badge>
                ))}
            </div>
        );
    };

    return (
        <div className="flex-1 space-y-4 p-8 pt-6 overflow-auto bg-muted/20">
            <div className="flex items-center justify-between space-y-2">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Behavioral Events</h2>
                    <p className="text-muted-foreground">Raw analytics data streaming from the extension and web app.</p>
                </div>
            </div>

            <Card>
                <CardHeader className="pb-3">
                    <div className="flex flex-wrap gap-3 items-center">
                        <div className="relative flex-1 min-w-[200px]">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input placeholder="Filter by event name (e.g. extension_installed)…" className="pl-9" value={eventName} onChange={e => setEventName(e.target.value)} />
                        </div>
                        <Input placeholder="Filter by User ID…" className="w-[260px]" value={userId} onChange={e => setUserId(e.target.value)} />
                        <Button variant="outline" size="icon" onClick={load}><RefreshCw className="h-4 w-4" /></Button>
                        <span className="text-sm text-muted-foreground">{total} events</span>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="rounded-md border overflow-hidden">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b bg-muted/50">
                                    <th className="text-left px-4 py-3 font-medium">Event</th>
                                    <th className="text-left px-4 py-3 font-medium">User</th>
                                    <th className="text-left px-4 py-3 font-medium">Campaign ID</th>
                                    <th className="text-left px-4 py-3 font-medium w-[40%]">Properties</th>
                                    <th className="text-left px-4 py-3 font-medium">Time relative</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Loading events...</td></tr>
                                ) : events.length === 0 ? (
                                    <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No events found</td></tr>
                                ) : events.map((e: any) => (
                                    <tr key={e.id} className="border-b hover:bg-muted/30 transition-colors">
                                        <td className="px-4 py-3 font-mono text-xs">
                                            <Badge variant="secondary" className="gap-1 bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 border-blue-500/20">
                                                <Zap className="h-3 w-3" />
                                                {e.event_name}
                                            </Badge>
                                        </td>
                                        <td className="px-4 py-3 text-xs text-muted-foreground">{e.user?.email ?? e.user_id}</td>
                                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{e.campaign_id ?? '—'}</td>
                                        <td className="px-4 py-3">{renderProperties(e.properties)}</td>
                                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                                            {new Date(e.created_at).toLocaleString()}
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
        </div>
    );
}
