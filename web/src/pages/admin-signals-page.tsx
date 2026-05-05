import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader } from '@/shared/components/ui/card';
import { Input } from '@/shared/components/ui/input';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/components/ui/select';
import { ChevronLeft, ChevronRight, RefreshCw, Target } from 'lucide-react';
import { auth_storage } from '@/shared/lib/auth';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'https://ai-seo-monorepo.onrender.com';

async function adminFetch(path: string) {
    const token = auth_storage.get_access_token();
    const r = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    const json = await r.json();
    if (!json.success) throw new Error(json.message || 'Request failed');
    return json.data;
}

export default function AdminSignalsPage() {
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
        <div className="flex-1 space-y-4 p-8 pt-6 overflow-auto bg-muted/20">
            <div className="flex items-center justify-between space-y-2">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Intent Signals</h2>
                    <p className="text-muted-foreground">NLP-extracted signals highlighting buying intent and competitor analysis.</p>
                </div>
            </div>

            <Card>
                <CardHeader className="pb-3">
                    <div className="flex flex-wrap gap-3 items-center">
                        <Select value={signalType || 'all'} onValueChange={(v: string) => setSignalType(v === 'all' ? '' : v)}>
                            <SelectTrigger className="w-[220px]"><SelectValue placeholder="Filter by Signal Type" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Signal Types</SelectItem>
                                <SelectItem value="budget_intent">Budget Intent</SelectItem>
                                <SelectItem value="competitor_comparison">Competitor Comparison</SelectItem>
                                <SelectItem value="purchase_intent">Purchase Intent</SelectItem>
                            </SelectContent>
                        </Select>
                        <Input placeholder="Filter by User ID…" className="w-[260px]" value={userId} onChange={e => setUserId(e.target.value)} />
                        <Button variant="outline" size="icon" onClick={load}><RefreshCw className="h-4 w-4" /></Button>
                        <span className="text-sm text-muted-foreground">{total} total signals captured</span>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="rounded-md border overflow-hidden">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b bg-muted/50">
                                    <th className="text-left px-4 py-3 font-medium">Signal Type</th>
                                    <th className="text-left px-4 py-3 font-medium">User</th>
                                    <th className="text-right px-4 py-3 font-medium">Confidence Match</th>
                                    <th className="text-left px-4 py-3 font-medium">Context Value</th>
                                    <th className="text-left px-4 py-3 font-medium">Timestamp</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Loading signals...</td></tr>
                                ) : signals.length === 0 ? (
                                    <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No signals found</td></tr>
                                ) : signals.map((s: any) => (
                                    <tr key={s.id} className="border-b hover:bg-muted/30 transition-colors">
                                        <td className="px-4 py-3">
                                            <Badge variant="outline" className="gap-1 text-primary border-primary/50">
                                                <Target className="h-3 w-3" />
                                                {s.signal_type}
                                            </Badge>
                                        </td>
                                        <td className="px-4 py-3 text-xs text-muted-foreground">{s.user?.email ?? s.user_id}</td>
                                        <td className="px-4 py-3 text-right font-semibold">
                                            <span className={s.confidence > 0.7 ? 'text-green-500' : s.confidence > 0.4 ? 'text-yellow-500' : 'text-muted-foreground'}>
                                                {(s.confidence * 100).toFixed(0)}%
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-sm text-foreground max-w-[280px] break-words">
                                            {typeof s.value === 'object' ? JSON.stringify(s.value) : s.value}
                                        </td>
                                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                                            {new Date(s.created_at).toLocaleString()}
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
