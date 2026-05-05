import { Campaign, CampaignVersion, PromptNode, CaptureSession, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { prisma } from '../../utils/prisma';
import { CreateCampaignDto, UpdateCampaignDto } from './dto/campaign.dto';

export class CampaignRepository {
    async forkVersionForRefresh(params: {
        tenant_id: string;
        campaign_id: string;
        user_id: string;
        source_version_id: string;
        source_target_node_id: string;
        refresh_provider: string;
        refresh_scope: 'node' | 'branch';
    }): Promise<{ version: CampaignVersion; mapped_target_node_id: string }> {
        const { tenant_id, campaign_id, user_id, source_version_id, source_target_node_id, refresh_provider, refresh_scope } = params;
        return prisma.$transaction(async (tx) => {
            const source_version = await tx.campaignVersion.findFirst({
                where: { id: source_version_id, tenant_id, campaign_id },
            });
            if (!source_version) {
                throw new Error('Source version not found');
            }

            await tx.campaignVersion.updateMany({
                where: { tenant_id, campaign_id, is_active: true },
                data: { is_active: false, status: 'archived', archived_at: new Date() },
            });

            const latest = await tx.campaignVersion.findFirst({
                where: { tenant_id, campaign_id },
                orderBy: { version_number: 'desc' },
            });
            const next_num = latest ? latest.version_number + 1 : source_version.version_number + 1;

            const new_version = await tx.campaignVersion.create({
                data: {
                    tenant_id,
                    campaign_id,
                    created_by_user_id: user_id,
                    version_number: next_num,
                    status: 'active',
                    is_active: true,
                    label: `Refresh (${refresh_scope}) from v${source_version.version_number}`,
                    config_json: {
                        refresh_source_version_id: source_version.id,
                        refresh_source_version_number: source_version.version_number,
                        refresh_provider,
                        refresh_scope,
                        refresh_target_source_node_id: source_target_node_id,
                    },
                },
            });

            const source_nodes = await tx.promptNode.findMany({
                where: { campaign_version_id: source_version.id, tenant_id },
                orderBy: { depth: 'asc' },
            });

            const old_to_new_id = new Map<string, string>(source_nodes.map((node) => [node.id, randomUUID()]));
            const mapped_target_node_id = old_to_new_id.get(source_target_node_id);
            if (!mapped_target_node_id) {
                throw new Error('Refresh target node not found in source graph');
            }

            const nodes_by_depth = new Map<number, PromptNode[]>();
            for (const node of source_nodes) {
                const bucket = nodes_by_depth.get(node.depth) ?? [];
                bucket.push(node);
                nodes_by_depth.set(node.depth, bucket);
            }

            const ordered_depths = Array.from(nodes_by_depth.keys()).sort((a, b) => a - b);
            for (const depth of ordered_depths) {
                const nodes = nodes_by_depth.get(depth) ?? [];
                if (!nodes.length) continue;

                await tx.promptNode.createMany({
                    data: nodes.map((node) => {
                        const mapped_parent_id = node.parent_id ? old_to_new_id.get(node.parent_id) : undefined;
                        return {
                            id: old_to_new_id.get(node.id)!,
                            tenant_id,
                            campaign_version_id: new_version.id,
                            type: node.type,
                            content: node.content,
                            depth: node.depth,
                            metadata: node.metadata || {},
                            parent_id: mapped_parent_id ?? null,
                            capture_session_id: null,
                            capture_turn_id: null,
                        };
                    }),
                });
            }

            return { version: new_version, mapped_target_node_id };
        }, { timeout: 30_000, maxWait: 10_000 });
    }

    async establishActiveVersion(campaign_id: string, user_id: string): Promise<CampaignVersion> {
        const active = await prisma.campaignVersion.findFirst({
            where: { campaign_id, is_active: true },
        });
        if (active) return active;

        const latest = await prisma.campaignVersion.findFirst({
            where: { campaign_id },
            orderBy: { version_number: 'desc' },
        });

        const next_version = latest ? latest.version_number + 1 : 1;

        return prisma.campaignVersion.create({
            data: {
                campaign_id,
                tenant_id: latest?.tenant_id || '', // Provided by caller context but needed here if making blind
                created_by_user_id: user_id,
                version_number: next_version,
                status: 'active',
                is_active: true,
            },
        });
    }

    async createCampaign(tenant_id: string, user_id: string, data: CreateCampaignDto): Promise<Campaign> {
        return prisma.$transaction(async (tx) => {
            const domain = await tx.domain.findFirst({
                where: {
                    id: data.domain_id,
                    tenant_id,
                },
                select: { id: true },
            });
            if (!domain) {
                throw new Error('Domain not found for campaign creation');
            }
            const campaign = await tx.campaign.create({
                data: {
                    tenant_id,
                    domain_id: data.domain_id,
                    created_by_user_id: user_id,
                    name: data.name,
                    description: data.description,
                    target_location: data.target_location,
                    industry_tag: data.industry_tag,
                    business_type: data.business_type,
                    primary_goal: data.primary_goal,
                },
            });

            await tx.campaignVersion.create({
                data: {
                    tenant_id,
                    campaign_id: campaign.id,
                    created_by_user_id: user_id,
                    version_number: 1,
                    status: 'active',
                    is_active: true,
                },
            });

            return campaign;
        });
    }

    async listCampaigns(tenant_id: string, domain_id?: string): Promise<any[]> {
        const campaigns = await prisma.campaign.findMany({
            where: {
                tenant_id,
                archived_at: null,
                ...(domain_id ? { domain_id } : {}),
            },
            orderBy: { updated_at: 'desc' },
            include: {
                versions: {
                    where: { is_active: true },
                    take: 1,
                },
            },
        });

        const active_version_ids = campaigns
            .map((campaign) => campaign.versions[0]?.id)
            .filter((value): value is string => Boolean(value));

        const [node_counts, root_prompt_counts] = await Promise.all([
            active_version_ids.length
                ? prisma.promptNode.groupBy({
                    by: ['campaign_version_id'],
                    where: {
                        tenant_id,
                        campaign_version_id: { in: active_version_ids },
                    },
                    _count: { _all: true },
                })
                : Promise.resolve([]),
            active_version_ids.length
                ? prisma.promptNode.groupBy({
                    by: ['campaign_version_id'],
                    where: {
                        tenant_id,
                        campaign_version_id: { in: active_version_ids },
                        parent_id: null,
                        type: 'prompt',
                    },
                    _count: { _all: true },
                })
                : Promise.resolve([]),
        ]);

        const total_nodes_by_version = new Map<string, number>(
            node_counts.map((row) => [row.campaign_version_id, row._count._all]),
        );
        const roots_by_version = new Map<string, number>(
            root_prompt_counts.map((row) => [row.campaign_version_id, row._count._all]),
        );

        return campaigns.map((campaign) => {
            const active_version = campaign.versions[0];
            const version_id = active_version?.id;
            return {
                id: campaign.id,
                domain_id: campaign.domain_id,
                name: campaign.name,
                description: campaign.description,
                created_at: campaign.created_at,
                updated_at: campaign.updated_at,
                active_version_number: active_version?.version_number ?? 1,
                total_nodes: version_id ? (total_nodes_by_version.get(version_id) ?? 0) : 0,
                root_prompt_count: version_id ? (roots_by_version.get(version_id) ?? 0) : 0,
            };
        });
    }

    async getCampaign(tenant_id: string, campaign_id: string): Promise<Campaign | null> {
        return prisma.campaign.findFirst({
            where: { id: campaign_id, tenant_id, archived_at: null },
            include: {
                versions: {
                    orderBy: { version_number: 'desc' },
                },
            },
        });
    }

    async updateCampaign(tenant_id: string, campaign_id: string, data: UpdateCampaignDto): Promise<Campaign | null> {
        const campaign = await prisma.campaign.findFirst({
            where: { id: campaign_id, tenant_id, archived_at: null },
        });
        if (!campaign) return null;

        return prisma.campaign.update({
            where: { id: campaign_id },
            data: {
                name: data.name,
                description: data.description,
                ...(data.target_location !== undefined ? { target_location: data.target_location } : {}),
                ...(data.industry_tag !== undefined ? { industry_tag: data.industry_tag } : {}),
                ...(data.business_type !== undefined ? { business_type: data.business_type } : {}),
                ...(data.primary_goal !== undefined ? { primary_goal: data.primary_goal } : {}),
            },
        });
    }

    async deleteCampaign(tenant_id: string, campaign_id: string): Promise<boolean> {
        const campaign = await prisma.campaign.findFirst({
            where: { id: campaign_id, tenant_id },
        });
        if (!campaign) return false;

        await prisma.campaign.update({
            where: { id: campaign_id },
            data: { archived_at: new Date() },
        });
        return true;
    }

    async getActiveVersion(tenant_id: string, campaign_id: string): Promise<CampaignVersion | null> {
        return prisma.campaignVersion.findFirst({
            where: { campaign_id, tenant_id, is_active: true },
        });
    }

    async getVersionById(tenant_id: string, campaign_id: string, version_id: string): Promise<CampaignVersion | null> {
        return prisma.campaignVersion.findFirst({
            where: { id: version_id, tenant_id, campaign_id },
        });
    }

    async listVersions(tenant_id: string, campaign_id: string): Promise<CampaignVersion[]> {
        return prisma.campaignVersion.findMany({
            where: { tenant_id, campaign_id },
            orderBy: { version_number: 'desc' },
        });
    }

    async getVersionNodes(tenant_id: string, campaign_version_id: string): Promise<PromptNode[]> {
        return prisma.promptNode.findMany({
            where: { campaign_version_id, tenant_id },
            orderBy: { created_at: 'asc' },
        });
    }

    async getChatThreads(tenant_id: string, campaign_version_id: string, limit: number, offset: number) {
        const sessions = await prisma.captureSession.findMany({
            where: { tenant_id, campaign_version_id },
            orderBy: { started_at: 'desc' },
            skip: offset,
            take: limit,
            include: {
                _count: {
                    select: { turns: true },
                },
                turns: {
                    orderBy: { created_at: 'desc' },
                    take: 1,
                },
            },
        });

        return sessions.map((s: any) => ({
            chat_thread_id: s.id,
            chat_provider: s.chat_provider,
            chat_title: s.chat_title,
            chat_url: s.chat_url,
            provider_chat_id: s.provider_chat_id,
            conversation_id: s.conversation_id,
            started_at: s.started_at,
            turn_count: s._count.turns,
            last_event_at: s.last_event_at,
            last_opened_at: s.last_opened_at,
            status: s.status,
            latest_turn_prompt: s.turns[0]?.prompt ?? null,
        }));
    }

    async findOrCreateSession(
        tenant_id: string,
        campaign_version_id: string,
        chat_provider: any,
        conversation_id: string
    ): Promise<CaptureSession> {
        const existing = await prisma.captureSession.findFirst({
            where: { tenant_id, campaign_version_id, chat_provider, conversation_id },
        });
        if (existing) {
            return existing;
        }

        try {
            return await prisma.captureSession.create({
                data: {
                    tenant_id,
                    campaign_version_id,
                    chat_provider,
                    conversation_id,
                },
            });
        } catch (error) {
            // Race-safe find-or-create: if another request created the row first, read and return it.
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                const raced = await prisma.captureSession.findFirst({
                    where: { tenant_id, campaign_version_id, chat_provider, conversation_id },
                });
                if (raced) {
                    return raced;
                }
            }
            throw error;
        }
    }

    async linkChatThread(params: {
        tenant_id: string;
        campaign_version_id: string;
        chat_provider: string;
        conversation_id?: string;
        provider_chat_id?: string;
        chat_url?: string;
        chat_title?: string;
    }): Promise<CaptureSession> {
        // Try to find by provider_chat_id first, then conversation_id
        const existing = await prisma.captureSession.findFirst({
            where: {
                tenant_id: params.tenant_id,
                campaign_version_id: params.campaign_version_id,
                chat_provider: params.chat_provider as any,
                ...(params.provider_chat_id
                    ? { provider_chat_id: params.provider_chat_id }
                    : params.conversation_id
                        ? { conversation_id: params.conversation_id }
                        : {}),
            },
        });

        if (existing) {
            return prisma.captureSession.update({
                where: { id: existing.id },
                data: {
                    chat_url: params.chat_url ?? existing.chat_url,
                    chat_title: params.chat_title ?? existing.chat_title,
                    provider_chat_id: params.provider_chat_id ?? existing.provider_chat_id,
                },
            });
        }

        return prisma.captureSession.create({
            data: {
                tenant_id: params.tenant_id,
                campaign_version_id: params.campaign_version_id,
                chat_provider: params.chat_provider as any,
                conversation_id: params.conversation_id ?? `web-linked-${Date.now()}`,
                provider_chat_id: params.provider_chat_id,
                chat_url: params.chat_url,
                chat_title: params.chat_title,
            },
        });
    }

    async markChatThreadOpened(tenant_id: string, session_id: string): Promise<CaptureSession | null> {
        const session = await prisma.captureSession.findFirst({
            where: { id: session_id, tenant_id },
        });
        if (!session) return null;

        return prisma.captureSession.update({
            where: { id: session_id },
            data: { last_opened_at: new Date() },
        });
    }

    async createNode(data: any): Promise<PromptNode> {
        return prisma.promptNode.create({ data });
    }

    async refireVersion(tenant_id: string, campaign_id: string, user_id: string, target_version_number: number): Promise<CampaignVersion> {
        return prisma.$transaction(async (tx) => {
            // 1. Get the target version
            const source_version = await tx.campaignVersion.findFirst({
                where: { tenant_id, campaign_id, version_number: target_version_number },
            });
            if (!source_version) throw new Error('Source version not found');

            // 2. Archive active version
            await tx.campaignVersion.updateMany({
                where: { tenant_id, campaign_id, is_active: true },
                data: { is_active: false, status: 'archived', archived_at: new Date() },
            });

            // 3. Determine next version number
            const latest = await tx.campaignVersion.findFirst({
                where: { tenant_id, campaign_id },
                orderBy: { version_number: 'desc' },
            });
            const next_num = latest ? latest.version_number + 1 : target_version_number + 1;

            // 4. Create new version
            const new_version = await tx.campaignVersion.create({
                data: {
                    tenant_id,
                    campaign_id,
                    created_by_user_id: user_id,
                    version_number: next_num,
                    status: 'active',
                    is_active: true,
                    label: `Refire from v${target_version_number}`,
                },
            });

            // 5. Clone nodes
            const source_nodes = await tx.promptNode.findMany({
                where: { campaign_version_id: source_version.id, tenant_id },
                orderBy: { depth: 'asc' }, // Ensure we clone top-down
            });

            const old_to_new_id = new Map<string, string>(
                source_nodes.map((node) => [node.id, randomUUID()]),
            );

            const nodes_by_depth = new Map<number, PromptNode[]>();
            for (const node of source_nodes) {
                const bucket = nodes_by_depth.get(node.depth) ?? [];
                bucket.push(node);
                nodes_by_depth.set(node.depth, bucket);
            }

            const ordered_depths = Array.from(nodes_by_depth.keys()).sort((a, b) => a - b);
            for (const depth of ordered_depths) {
                const nodes = nodes_by_depth.get(depth) ?? [];
                if (!nodes.length) continue;

                await tx.promptNode.createMany({
                    data: nodes.map((node) => {
                        const mapped_parent_id = node.parent_id ? old_to_new_id.get(node.parent_id) : undefined;
                        return {
                            id: old_to_new_id.get(node.id)!,
                            tenant_id,
                            campaign_version_id: new_version.id,
                            type: node.type,
                            content: node.content,
                            depth: node.depth,
                            metadata: node.metadata || {},
                            parent_id: mapped_parent_id ?? null,
                            capture_session_id: null,
                            capture_turn_id: null,
                        };
                    }),
                });
            }

            return new_version;
        }, { timeout: 30_000, maxWait: 10_000 });
    }
}

export const campaignRepository = new CampaignRepository();
