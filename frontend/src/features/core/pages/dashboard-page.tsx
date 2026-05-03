import React from 'react';
import { 
  TrendingUp, 
  Target, 
  Zap, 
  ArrowUpRight, 
  ArrowDownRight,
  Sparkles,
  MousePointer2,
  Share2
} from 'lucide-react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from 'recharts';
import { motion } from 'framer-motion';

const data = [
  { name: '01 May', intent: 400, conversions: 240 },
  { name: '02 May', intent: 300, conversions: 139 },
  { name: '03 May', intent: 980, conversions: 500 },
  { name: '04 May', intent: 390, conversions: 300 },
  { name: '05 May', intent: 480, conversions: 380 },
  { name: '06 May', intent: 1200, conversions: 800 },
  { name: '07 May', intent: 1100, conversions: 900 },
];

const StatCard = ({ title, value, change, icon, color }: any) => (
  <motion.div 
    whileHover={{ y: -4 }}
    className="p-6 rounded-3xl bg-white/[0.03] border border-white/5 hover:bg-white/[0.05] hover:border-white/10 transition-all group"
  >
    <div className="flex justify-between items-start mb-4">
      <div className={`p-3 rounded-2xl bg-${color}-500/10 text-${color}-500 group-hover:scale-110 transition-transform shadow-inner`}>
        {icon}
      </div>
      <div className={`flex items-center gap-1 text-xs font-bold ${change > 0 ? 'text-green-500' : 'text-red-500'}`}>
        {change > 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
        {Math.abs(change)}%
      </div>
    </div>
    <div className="text-white/40 text-xs font-bold uppercase tracking-widest mb-1">{title}</div>
    <div className="text-3xl font-black">{value}</div>
  </motion.div>
);

const DashboardPage: React.FC = () => {
  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Overview</h1>
          <p className="text-white/40 text-sm font-medium">Welcome back, here's what's happening with your intent flows.</p>
        </div>
        <div className="flex items-center gap-3">
          <button className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-sm font-bold hover:bg-white/10 transition-all">
            Export Data
          </button>
          <button className="px-5 py-2 rounded-xl bg-primary text-white text-sm font-bold shadow-lg shadow-primary/20 hover:opacity-90 transition-all flex items-center gap-2">
            <Zap size={16} /> Run Analysis
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard title="Total Intent Signals" value="12,482" change={12.5} icon={<MousePointer2 size={20} />} color="blue" />
        <StatCard title="Active Campaigns" value="8" change={0} icon={<Target size={20} />} color="purple" />
        <StatCard title="Lead Conversion" value="2.4%" change={-2.1} icon={<TrendingUp size={20} />} color="green" />
        <StatCard title="Workspace Reach" value="48.5k" change={24.8} icon={<Share2 size={20} />} color="orange" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Chart */}
        <div className="lg:col-span-2 p-8 rounded-[32px] bg-white/[0.03] border border-white/5">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-lg font-bold">Intent Velocity</h3>
            <div className="flex gap-4">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-primary" />
                <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Captured Intent</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-green-500" />
                <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Conversions</span>
              </div>
            </div>
          </div>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data}>
                <defs>
                  <linearGradient id="colorIntent" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorConv" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="5 5" vertical={false} stroke="rgba(255,255,255,0.03)" />
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: 'rgba(255,255,255,0.2)', fontSize: 10, fontWeight: 700 }} 
                  dy={10}
                />
                <YAxis hide />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#0A0A0A', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', fontSize: '12px' }}
                />
                <Area type="monotone" dataKey="intent" stroke="#3b82f6" fillOpacity={1} fill="url(#colorIntent)" strokeWidth={3} />
                <Area type="monotone" dataKey="conversions" stroke="#22c55e" fillOpacity={1} fill="url(#colorConv)" strokeWidth={3} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Recent Signals */}
        <div className="p-8 rounded-[32px] bg-white/[0.03] border border-white/5">
          <h3 className="text-lg font-bold mb-6">Recent Signals</h3>
          <div className="space-y-6">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex gap-4 items-center group cursor-pointer">
                <div className="h-10 w-10 rounded-xl bg-white/5 flex items-center justify-center group-hover:bg-primary/10 transition-colors">
                  <Sparkles size={16} className="text-white/40 group-hover:text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold truncate">High Intent Detected</div>
                  <div className="text-[10px] text-white/30 uppercase tracking-widest font-bold">Campaign #824 • 2m ago</div>
                </div>
                <div className="text-[10px] font-black text-primary bg-primary/10 px-2 py-1 rounded-md">
                  +42%
                </div>
              </div>
            ))}
          </div>
          <button className="w-full mt-8 py-3 rounded-xl bg-white/5 text-xs font-bold text-white/40 hover:bg-white/10 hover:text-white transition-all">
            View All Signals
          </button>
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;
