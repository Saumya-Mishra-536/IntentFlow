import React, { useCallback } from 'react';
import { 
  ReactFlow, 
  Controls, 
  Background, 
  useNodesState, 
  useEdgesState, 
  addEdge,
  Handle,
  Position,
  Panel
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { motion } from 'framer-motion';
import { 
  Target, 
  ChevronLeft,
  Plus
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';

const nodeTypes = {
  campaign: ({ data }: any) => (
    <div className="px-6 py-4 rounded-2xl bg-primary/20 border-2 border-primary shadow-[0_0_20px_rgba(59,130,246,0.3)] backdrop-blur-xl">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-xl bg-primary text-white"><Target size={20} /></div>
        <div>
          <div className="text-[10px] font-bold text-primary uppercase tracking-widest leading-none mb-1">Campaign Root</div>
          <div className="text-sm font-black text-white">{data.label}</div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="w-3 h-3 bg-primary border-2 border-white" />
    </div>
  ),
  version: ({ data }: any) => (
    <div className="px-5 py-3 rounded-xl bg-white/5 border border-white/10 backdrop-blur-md">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-white/10 text-white/70"><Zap size={16} /></div>
        <div>
          <div className="text-[9px] font-bold text-white/30 uppercase tracking-widest leading-none mb-1">Version {data.version}</div>
          <div className="text-xs font-bold text-white/80">{data.label}</div>
        </div>
      </div>
      <Handle type="target" position={Position.Top} className="w-2 h-2 bg-white/40" />
      <Handle type="source" position={Position.Bottom} className="w-2 h-2 bg-white/40" />
    </div>
  ),
  session: ({ data }: any) => (
    <div className="px-5 py-3 rounded-xl bg-purple-500/10 border border-purple-500/30 backdrop-blur-md">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-purple-500/20 text-purple-400"><MessageSquare size={16} /></div>
        <div>
          <div className="text-[9px] font-bold text-purple-400/50 uppercase tracking-widest leading-none mb-1">{data.provider} Session</div>
          <div className="text-xs font-bold text-white/80">{data.id}</div>
        </div>
      </div>
      <Handle type="target" position={Position.Top} className="w-2 h-2 bg-purple-400/40" />
      <Handle type="source" position={Position.Bottom} className="w-2 h-2 bg-purple-400/40" />
    </div>
  ),
  prompt: ({ data }: any) => (
    <div className="px-5 py-3 rounded-xl bg-green-500/10 border border-green-500/30 backdrop-blur-md max-w-[200px]">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-green-500/20 text-green-400"><Cpu size={16} /></div>
        <div>
          <div className="text-[9px] font-bold text-green-400/50 uppercase tracking-widest leading-none mb-1">Prompt Node</div>
          <div className="text-[11px] font-medium text-white/60 line-clamp-2">{data.content}</div>
        </div>
      </div>
      <Handle type="target" position={Position.Top} className="w-2 h-2 bg-green-400/40" />
    </div>
  )
};

const initialNodes = [
  { id: '1', type: 'campaign', position: { x: 400, y: 0 }, data: { label: 'Product Launch Q2' } },
  { id: '2', type: 'version', position: { x: 400, y: 120 }, data: { label: 'Initial Strategy', version: 1 } },
  { id: '3', type: 'session', position: { x: 200, y: 240 }, data: { provider: 'ChatGPT', id: 'CS-8241' } },
  { id: '4', type: 'session', position: { x: 600, y: 240 }, data: { provider: 'Claude', id: 'CS-9110' } },
  { id: '5', type: 'prompt', position: { x: 100, y: 360 }, data: { content: 'Analyze the user intent regarding SaaS pricing models...' } },
  { id: '6', type: 'prompt', position: { x: 300, y: 360 }, data: { content: 'Identify pain points in current enterprise outreach...' } },
  { id: '7', type: 'prompt', position: { x: 600, y: 360 }, data: { content: 'Generate high-intent keyword snapshots...' } },
];

const initialEdges = [
  { id: 'e1-2', source: '1', target: '2', animated: true, style: { stroke: '#3b82f6' } },
  { id: 'e2-3', source: '2', target: '3', style: { stroke: 'rgba(255,255,255,0.1)' } },
  { id: 'e2-4', source: '2', target: '4', style: { stroke: 'rgba(255,255,255,0.1)' } },
  { id: 'e3-5', source: '3', target: '5', style: { stroke: 'rgba(168,85,247,0.3)' } },
  { id: 'e3-6', source: '3', target: '6', style: { stroke: 'rgba(168,85,247,0.3)' } },
  { id: 'e4-7', source: '4', target: '7', style: { stroke: 'rgba(168,85,247,0.3)' } },
];

const CampaignGraphPage: React.FC = () => {
  const { id } = useParams();
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect = useCallback((params: any) => setEdges((eds) => addEdge(params, eds)), [setEdges]);

  return (
    <div className="h-full flex flex-col space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/app/campaigns" className="p-2 rounded-xl bg-white/5 border border-white/10 text-white/40 hover:text-white hover:bg-white/10 transition-all">
            <ChevronLeft size={20} />
          </Link>
          <div>
            <h1 className="text-2xl font-black tracking-tight">Campaign Flow</h1>
            <p className="text-white/40 text-xs font-bold uppercase tracking-widest">ID: {id} • Real-time Graph View</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button className="px-4 py-2 rounded-xl bg-green-500/10 border border-green-500/20 text-green-500 text-sm font-bold flex items-center gap-2">
            <Sparkles size={16} /> Deploy Version
          </button>
          <button className="px-5 py-2 rounded-xl bg-primary text-white text-sm font-bold flex items-center gap-2">
            <Plus size={18} /> New Node
          </button>
        </div>
      </div>

      <div className="flex-1 rounded-[40px] bg-[#080808] border border-white/5 overflow-hidden relative shadow-inner">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
          className="bg-transparent"
        >
          <Background color="#1a1a1a" gap={20} size={1} />
          <Controls className="bg-[#121212] border-white/10 fill-white/40" />
          <Panel position="top-right" className="bg-[#121212]/80 backdrop-blur-md p-4 border border-white/10 rounded-2xl">
            <div className="text-[10px] font-bold text-white/30 uppercase tracking-[0.2em] mb-3">Graph Stats</div>
            <div className="space-y-2">
              <div className="flex justify-between gap-8"><span className="text-[11px] text-white/50">Total Nodes</span> <span className="text-[11px] font-bold">12</span></div>
              <div className="flex justify-between gap-8"><span className="text-[11px] text-white/50">Active Sessions</span> <span className="text-[11px] font-bold text-purple-400">4</span></div>
              <div className="flex justify-between gap-8"><span className="text-[11px] text-white/50">Prompt Logic</span> <span className="text-[11px] font-bold text-green-400">Verified</span></div>
            </div>
          </Panel>
        </ReactFlow>
      </div>
    </div>
  );
};

export default CampaignGraphPage;
