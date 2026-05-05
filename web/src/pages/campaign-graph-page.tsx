import { useEffect, useMemo, useState } from 'react';
import { useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import {
  Background,
  BackgroundVariant,
  Controls,
  Edge,
  Handle,
  MiniMap,
  Node,
  NodeProps,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from '@dagrejs/dagre';
import { AppLayoutContext } from './app-layout';
import { auth_storage, CampaignTreeNode, CampaignVersionSummary, get_campaign_tree, get_campaign_versions } from '@/shared/lib/auth';

const NODE_W = 240;
const NODE_H = 70;

const TYPE_STYLES: Record<string, { wrap: string; badge: string }> = {
  prompt: {
    wrap: 'border-zinc-300 bg-zinc-100/85 dark:border-zinc-700 dark:bg-zinc-900/80',
    badge: 'border-zinc-400/60 bg-zinc-200/70 text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200',
  },
  subquery: {
    wrap: 'border-stone-300 bg-stone-100/85 dark:border-stone-700 dark:bg-stone-900/80',
    badge: 'border-stone-400/60 bg-stone-200/70 text-stone-700 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-200',
  },
  site: {
    wrap: 'border-slate-300 bg-slate-100/85 dark:border-slate-700 dark:bg-slate-900/80',
    badge: 'border-slate-400/60 bg-slate-200/70 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200',
  },
  generated: {
    wrap: 'border-neutral-300 bg-neutral-100/85 dark:border-neutral-700 dark:bg-neutral-900/80',
    badge:
      'border-neutral-400/60 bg-neutral-200/70 text-neutral-700 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200',
  },
};

function TreeNode({ data }: NodeProps) {
  const nodeData = data as { label: string; type: string };
  const style = TYPE_STYLES[nodeData.type] ?? {
    wrap: 'border-border bg-card',
    badge: 'border-border bg-muted text-muted-foreground',
  };

  return (
    <div
      className={`rounded-lg border px-3 py-2 shadow-sm ${style.wrap}`}
      style={{ width: NODE_W, minHeight: NODE_H }}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !bg-border" />
      <div className="flex flex-col gap-1.5">
        <span className={`inline-flex w-fit rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${style.badge}`}>
          {nodeData.type}
        </span>
        <p className="line-clamp-2 text-xs leading-snug text-foreground">{nodeData.label}</p>
      </div>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !bg-border" />
    </div>
  );
}

const nodeTypes = { treeNode: TreeNode };

function buildFlow(roots: CampaignTreeNode[]) {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const nodeLabel = (node: CampaignTreeNode) => {
    const explicit = node.metadata?.ui?.display_label?.trim();
    if (explicit) return explicit;
    const key = node.content.trim().toLowerCase();
    if (node.type === 'subquery' && (key === '__unscoped__' || key === 'unmapped_sources')) {
      return 'Unmapped results';
    }
    return node.content;
  };

  const walk = (node: CampaignTreeNode) => {
    nodes.push({
      id: node.id,
      type: 'treeNode',
      data: { label: nodeLabel(node), type: node.type },
      position: { x: 0, y: 0 },
    });

    node.children.forEach((child) => {
      edges.push({
        id: `${node.id}-${child.id}`,
        source: node.id,
        target: child.id,
        style: { stroke: 'hsl(var(--border))', strokeWidth: 1.4 },
      });
      walk(child);
    });
  };

  roots.forEach(walk);
  return { nodes, edges };
}

function countNodes(roots: CampaignTreeNode[]): number {
  const walk = (node: CampaignTreeNode): number => 1 + node.children.reduce((sum, child) => sum + walk(child), 0);
  return roots.reduce((sum, root) => sum + walk(root), 0);
}

function applyLayout(nodes: Node[], edges: Edge[]): Node[] {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: 'LR',
    nodesep: 64,
    ranksep: 130,
    marginx: 36,
    marginy: 28,
  });

  nodes.forEach((node) => graph.setNode(node.id, { width: NODE_W, height: NODE_H }));
  edges.forEach((edge) => graph.setEdge(edge.source, edge.target));

  dagre.layout(graph);

  return nodes.map((node) => {
    const pos = graph.node(node.id);
    return {
      ...node,
      position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 },
    };
  });
}

export default function ProjectGraphPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const requested_version_id = searchParams.get('version_id') ?? undefined;
  const { projectsData: campaignsData } = useOutletContext<AppLayoutContext>();

  const campaign = useMemo(() => campaignsData.find((item) => item.project.id === id), [campaignsData, id]);
  const [versions, setVersions] = useState<CampaignVersionSummary[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string | undefined>(requested_version_id);
  const [roots, setRoots] = useState<CampaignTreeNode[]>(campaign?.roots ?? []);
  const [nodeCount, setNodeCount] = useState<number>(campaign?.project.total_nodes ?? 0);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    const { nodes: sourceNodes, edges: sourceEdges } = buildFlow(roots);
    setNodes(applyLayout(sourceNodes, sourceEdges));
    setEdges(sourceEdges);
  }, [roots, setEdges, setNodes]);

  useEffect(() => {
    if (!id) return;
    const token = auth_storage.get_access_token();
    if (!token) return;
    void (async () => {
      try {
        const payload = await get_campaign_versions(token, id);
        setVersions(payload.versions ?? []);
        setSelectedVersionId((prev) => {
          if (prev && payload.versions.some((version) => version.id === prev)) return prev;
          return payload.versions.find((version) => version.is_active)?.id ?? payload.versions[0]?.id;
        });
      } catch {
        setVersions([]);
      }
    })();
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const token = auth_storage.get_access_token();
    if (!token) return;
    void (async () => {
      try {
        const payload = await get_campaign_tree(token, id, { version_id: selectedVersionId });
        setRoots(payload.roots ?? []);
        setNodeCount(countNodes(payload.roots ?? []));
      } catch {
        setRoots(campaign?.roots ?? []);
        setNodeCount(campaign?.project.total_nodes ?? 0);
      }
    })();
  }, [id, selectedVersionId, campaign]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (selectedVersionId) {
      next.set('version_id', selectedVersionId);
    } else {
      next.delete('version_id');
    }
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [selectedVersionId, searchParams, setSearchParams]);

  const isDark = document.documentElement.classList.contains('dark');

  if (!campaign) {
    return (
      <div className="flex h-full w-full items-center justify-center p-6">
        <div className="dashboard-surface rounded-xl px-5 py-4 text-center">
          <p className="text-sm font-medium text-foreground">Campaign graph not available in this workspace.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Refresh the sidebar campaigns or switch to the workspace that owns this campaign.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-surface relative h-full w-full overflow-hidden rounded-xl">
      <div className="absolute left-3 top-3 z-10 rounded-md border border-border/70 bg-background/85 px-3 py-2 backdrop-blur">
        <p className="text-xs font-semibold text-foreground">{campaign.project.name}</p>
        <p className="text-[11px] text-muted-foreground">{nodeCount} mapped nodes</p>
        {versions.length ? (
          <select
            className="mt-2 h-7 rounded border border-border bg-background px-1 text-[11px]"
            value={selectedVersionId ?? ''}
            onChange={(event) => setSelectedVersionId(event.target.value || undefined)}
          >
            {versions.map((version) => (
              <option key={version.id} value={version.id}>
                {`v${version.version_number}${version.is_active ? ' (active)' : ''}${version.label ? ` - ${version.label}` : ''}`}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      <ReactFlow
        className="dashboard-grid"
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        colorMode={isDark ? 'dark' : 'light'}
        fitView
        fitViewOptions={{ padding: 0.14 }}
        minZoom={0.16}
        maxZoom={2}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1}
          color={isDark ? 'hsl(220 8% 24%)' : 'hsl(220 8% 76%)'}
        />
        <Controls className="!overflow-hidden !rounded-md !border !border-border !bg-card !shadow-none" />
        <MiniMap
          className="!rounded-md !border !border-border !bg-card"
          nodeColor={() => (isDark ? 'hsl(220 8% 45%)' : 'hsl(220 8% 56%)')}
          maskColor={isDark ? 'rgba(18, 18, 20, 0.58)' : 'rgba(255, 255, 255, 0.55)'}
        />
      </ReactFlow>
    </div>
  );
}
