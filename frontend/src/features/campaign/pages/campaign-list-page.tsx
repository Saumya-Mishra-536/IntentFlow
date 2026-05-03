import React from 'react';
import { motion } from 'framer-motion';
import { 
  Plus, 
  Target, 
  MoreHorizontal, 
  ChevronRight,
  Sparkles
} from 'lucide-react';
import { Link } from 'react-router-dom';

const campaigns = [
  { id: '1', name: 'Product Launch Q2', industry: 'SaaS', status: 'Active', signals: 1240, lastActive: '2h ago' },
  { id: '2', name: 'Enterprise Outreach', industry: 'Fintech', status: 'Draft', signals: 0, lastActive: '1d ago' },
  { id: '3', name: 'Community Engagement', industry: 'Education', status: 'Active', signals: 856, lastActive: '5m ago' },
  { id: '4', name: 'Competitor Intel', industry: 'Marketing', status: 'Archived', signals: 4230, lastActive: '1w ago' },
];

const CampaignListPage: React.FC = () => {
  return (
    <div className="space-y-8 pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Campaigns</h1>
          <p className="text-white/40 text-sm font-medium">Manage and monitor your intent-driven marketing campaigns.</p>
        </div>
        <button className="px-6 py-3 rounded-2xl bg-primary text-white text-sm font-bold shadow-lg shadow-primary/20 hover:opacity-90 transition-all flex items-center gap-2 group">
          <Plus size={20} className="group-hover:rotate-90 transition-transform" /> Create Campaign
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {campaigns.map((campaign, i) => (
          <motion.div
            key={campaign.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            whileHover={{ y: -6 }}
            className="p-1 rounded-[32px] bg-gradient-to-b from-white/10 to-transparent group"
          >
            <div className="h-full p-8 rounded-[31px] bg-[#0D0D0D] border border-white/5 group-hover:border-primary/20 transition-all flex flex-col">
              <div className="flex justify-between items-start mb-6">
                <div className={`p-3 rounded-2xl bg-primary/10 text-primary shadow-inner`}>
                  <Target size={24} />
                </div>
                <button className="text-white/20 hover:text-white transition-colors">
                  <MoreHorizontal size={20} />
                </button>
              </div>

              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`h-2 w-2 rounded-full ${campaign.status === 'Active' ? 'bg-green-500 animate-pulse' : 'bg-white/20'}`} />
                  <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">{campaign.status}</span>
                </div>
                <h3 className="text-xl font-bold mb-2 group-hover:text-primary transition-colors">{campaign.name}</h3>
                <div className="text-sm text-white/40 font-medium mb-6">Industry: {campaign.industry}</div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-8 pt-6 border-t border-white/5">
                <div>
                  <div className="text-[10px] text-white/20 font-bold uppercase tracking-widest mb-1">Signals</div>
                  <div className="text-lg font-bold flex items-center gap-2">
                    <Sparkles size={14} className="text-primary" /> {campaign.signals}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-white/20 font-bold uppercase tracking-widest mb-1">Last Active</div>
                  <div className="text-sm font-bold text-white/60">{campaign.lastActive}</div>
                </div>
              </div>

              <Link 
                to={`/app/campaigns/${campaign.id}`}
                className="w-full py-3 rounded-xl bg-white/5 text-xs font-bold text-white/70 hover:bg-primary hover:text-white transition-all flex items-center justify-center gap-2"
              >
                View Campaign Graph <ChevronRight size={14} />
              </Link>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
};

export default CampaignListPage;
