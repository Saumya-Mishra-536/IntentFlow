import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../middlewares/auth.middleware';
import { campaignService } from './campaign.service';
import {
    createCampaignSchema,
    updateCampaignSchema,
    ingestTurnSchema,
    linkChatThreadSchema,
    refreshNodeSchema,
    conversationIngestSchema,
    manualPromptSchema,
    selectPromptCandidatesSchema,
    replacePromptSelectionSchema,
    executePromptSchema,
    siteTopQueriesSchema,
} from './dto/campaign.dto';
import { ApiResponse } from '../../core/api-response';
import { HttpException } from '../../core/http-exception';

const parse_version_id = (raw: unknown): string | undefined => {
    if (typeof raw !== 'string') return undefined;
    const trimmed = raw.trim();
    return trimmed.length ? trimmed : undefined;
};

const get_campaign_id = (req: AuthRequest): string => req.params.campaign_id ?? req.params.workspace_id;
const get_version_id = (req: AuthRequest): string | undefined => req.params.version_id ?? parse_version_id(req.query.version_id);
const parse_analytics_range = (raw: unknown): '7d' | '30d' | 'all' => {
    if (raw === '7d' || raw === '30d' || raw === 'all') return raw;
    return '30d';
};

const parse_provider = (raw: unknown): 'chatgpt' | 'claude' | 'gemini' | 'perplexity' | 'grok' | 'unknown' => {
    if (raw === 'chatgpt' || raw === 'claude' || raw === 'gemini' || raw === 'perplexity' || raw === 'grok' || raw === 'unknown') {
        return raw;
    }
    throw new HttpException(400, 'Invalid provider');
};

export class CampaignController {
    async createCampaign(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const user_id = req.user!.id;
            const data = createCampaignSchema.parse(req.body);

            const campaign = await campaignService.createCampaign(tenant_id, user_id, data);
            res.status(201).json(ApiResponse.success(campaign, 'Campaign created'));
        } catch (error) {
            next(error);
        }
    }

    async listCampaigns(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const domain_id = typeof req.query.domain_id === 'string' ? req.query.domain_id : undefined;
            const campaigns = await campaignService.listCampaigns(tenant_id, domain_id);
            res.json(ApiResponse.success(campaigns));
        } catch (error) {
            next(error);
        }
    }

    async getCampaign(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const { campaign_id } = req.params;
            const campaign = await campaignService.getCampaign(tenant_id, campaign_id);
            res.json(ApiResponse.success(campaign));
        } catch (error) {
            next(error);
        }
    }

    async updateCampaign(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const { campaign_id } = req.params;
            const data = updateCampaignSchema.parse(req.body);

            const updated = await campaignService.updateCampaign(tenant_id, campaign_id, data);
            if (!updated) return res.status(404).json({ success: false, error: 'Campaign not found' });
            res.json(ApiResponse.success(updated, 'Campaign updated'));
        } catch (error) {
            next(error);
        }
    }

    async deleteCampaign(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const { campaign_id } = req.params;

            const deleted = await campaignService.deleteCampaign(tenant_id, campaign_id);
            if (!deleted) return res.status(404).json({ success: false, error: 'Campaign not found' });
            res.status(200).json(ApiResponse.success({ campaign_id, deleted: true }, 'Campaign deleted'));
        } catch (error) {
            next(error);
        }
    }

    async getActiveTree(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const { campaign_id } = req.params;
            const version_id = parse_version_id(req.query.version_id);
            const tree = await campaignService.getActiveTree(tenant_id, campaign_id, version_id);
            res.json(ApiResponse.success(tree));
        } catch (error) {
            next(error);
        }
    }

    async getActiveChatThreads(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const { campaign_id } = req.params;
            const limit = parseInt(req.query.limit as string) || 20;
            const offset = parseInt(req.query.offset as string) || 0;
            const version_id = parse_version_id(req.query.version_id);

            const threads = await campaignService.getActiveChatThreads(tenant_id, campaign_id, limit, offset, version_id);
            res.json(ApiResponse.success(threads));
        } catch (error) {
            next(error);
        }
    }

    async ingestTurn(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const user_id = req.user!.id;
            const campaign_id = get_campaign_id(req);
            const version_id = parse_version_id(req.query.version_id);
            const data = ingestTurnSchema.parse(req.body);

            const tree = await campaignService.ingestTurn(tenant_id, user_id, campaign_id, data, version_id);
            const workflow = await campaignService.getWorkflowState(
                tenant_id,
                campaign_id,
                tree?.version?.id ?? version_id,
            );
            const normalized_prompt = data.prompt.trim().replace(/\s+/g, ' ').toLowerCase();
            const source_prompt_id =
                typeof data.metadata?.source_prompt_id === 'string' ? data.metadata.source_prompt_id : undefined;
            const executed_prompt = workflow.executedPrompts.find((item) => {
                if (source_prompt_id && item.sourcePromptId === source_prompt_id) return true;
                return item.text.trim().replace(/\s+/g, ' ').toLowerCase() === normalized_prompt;
            }) ?? null;
            res.status(201).json(ApiResponse.success({ ...tree, executedPrompt: executed_prompt }, 'Turn ingested'));
        } catch (error) {
            next(error);
        }
    }

    async refire(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const user_id = req.user!.id;
            const { campaign_id, version_number } = req.params;

            const newVersion = await campaignService.refire(tenant_id, campaign_id, user_id, parseInt(version_number));
            res.status(201).json(ApiResponse.success(newVersion, 'Refired'));
        } catch (error) {
            next(error);
        }
    }

    async refreshNode(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const user_id = req.user!.id;
            const { campaign_id, node_id } = req.params;
            const version_id = parse_version_id(req.query.version_id);
            const payload = refreshNodeSchema.parse(req.body ?? {});
            const result = await campaignService.refreshNode(tenant_id, user_id, campaign_id, node_id, payload, version_id);
            res.status(202).json(ApiResponse.success(result, 'Refresh accepted'));
        } catch (error) {
            next(error);
        }
    }
    // ── Short-form aliases ────────────────────────────────────────────────────
    // The web/extension clients call /:id/tree and /:id/chat-threads directly.
    // These delegate to the active-version handlers and return empty gracefully
    // for brand-new campaigns that have no data yet.

    async getTree(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const { campaign_id } = req.params;
            const version_id = parse_version_id(req.query.version_id);
            const tree = await campaignService.getActiveTree(tenant_id, campaign_id, version_id);
            res.json(ApiResponse.success(tree));
        } catch (error) {
            next(error);
        }
    }

    async getChatThreads(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const { campaign_id } = req.params;
            const limit = parseInt(req.query.limit as string) || 20;
            const offset = parseInt(req.query.offset as string) || 0;
            const version_id = parse_version_id(req.query.version_id);
            const threads = await campaignService.getActiveChatThreads(tenant_id, campaign_id, limit, offset, version_id);
            res.json(ApiResponse.success(threads));
        } catch (error) {
            next(error);
        }
    }

    async linkChatThread(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const user_id = req.user!.id;
            const { campaign_id } = req.params;
            const version_id = parse_version_id(req.query.version_id);
            const data = linkChatThreadSchema.parse(req.body);

            const thread = await campaignService.linkChatThread(tenant_id, user_id, campaign_id, data, version_id);
            res.status(201).json(ApiResponse.success(thread, 'Chat thread linked'));
        } catch (error) {
            next(error);
        }
    }

    async markChatThreadOpened(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const { campaign_id, thread_id } = req.params;

            const result = await campaignService.markChatThreadOpened(tenant_id, campaign_id, thread_id);
            if (!result) return res.status(404).json({ success: false, message: 'Chat thread not found' });
            res.json(ApiResponse.success(result, 'Chat thread marked opened'));
        } catch (error) {
            next(error);
        }
    }

    async getGeneratedSuggestions(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const { campaign_id } = req.params;
            const limit = parseInt(req.query.limit as string) || 20;
            const offset = parseInt(req.query.offset as string) || 0;
            const version_id = parse_version_id(req.query.version_id);
            const suggestions = await campaignService.getGeneratedSuggestions(tenant_id, campaign_id, limit, offset, version_id);
            res.json(ApiResponse.success(suggestions));
        } catch (error) {
            next(error);
        }
    }

    async generateSuggestions(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const user_id = req.user!.id;
            const { campaign_id } = req.params;
            const version_id = parse_version_id(req.query.version_id);
            const raw_max = Number((req.body as Record<string, unknown> | undefined)?.max_suggestions);
            const max_suggestions = Number.isFinite(raw_max) ? raw_max : 5;
            const append = Boolean((req.body as Record<string, unknown> | undefined)?.append);
            const payload = await campaignService.generateSuggestions(tenant_id, user_id, campaign_id, max_suggestions, version_id, append);
            res.json(ApiResponse.success(payload));
        } catch (error) {
            next(error);
        }
    }

    async listVersions(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const { campaign_id } = req.params;
            const payload = await campaignService.listVersions(tenant_id, campaign_id);
            res.json(ApiResponse.success(payload));
        } catch (error) {
            next(error);
        }
    }

    async getWorkflowState(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const campaign_id = get_campaign_id(req);
            const version_id = get_version_id(req);
            const payload = await campaignService.getWorkflowState(tenant_id, campaign_id, version_id);
            res.json(ApiResponse.success(payload));
        } catch (error) {
            next(error);
        }
    }

    async getDashboardAnalytics(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const range = parse_analytics_range(req.query.range);
            const payload = await campaignService.getDashboardAnalytics(tenant_id, range);
            res.json(ApiResponse.success(payload));
        } catch (error) {
            next(error);
        }
    }

    async getPipelineAnalytics(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const user_id = req.user!.id;
            const campaign_id = get_campaign_id(req);
            const version_id = get_version_id(req);
            const range = parse_analytics_range(req.query.range);
            const payload = await campaignService.getPipelineAnalytics(tenant_id, user_id, campaign_id, version_id, range);
            res.json(ApiResponse.success(payload));
        } catch (error) {
            next(error);
        }
    }

    async getPromptAnalytics(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const user_id = req.user!.id;
            const campaign_id = get_campaign_id(req);
            const version_id = get_version_id(req);
            const range = parse_analytics_range(req.query.range);
            const payload = await campaignService.getPromptAnalytics(tenant_id, user_id, campaign_id, version_id, range);
            res.json(ApiResponse.success(payload));
        } catch (error) {
            next(error);
        }
    }

    async getWebsiteAnalytics(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const user_id = req.user!.id;
            const campaign_id = get_campaign_id(req);
            const version_id = get_version_id(req);
            const range = parse_analytics_range(req.query.range);
            const payload = await campaignService.getWebsiteAnalytics(tenant_id, user_id, campaign_id, version_id, range);
            res.json(ApiResponse.success(payload));
        } catch (error) {
            next(error);
        }
    }

    async ingestConversation(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const user_id = req.user!.id;
            const campaign_id = get_campaign_id(req);
            const version_id = get_version_id(req);
            const provider = parse_provider(req.params.provider);
            const payload = conversationIngestSchema.parse(req.body);
            const result = await campaignService.ingestConversation(tenant_id, user_id, campaign_id, provider, payload, version_id);
            res.status(201).json(ApiResponse.success(result, 'Conversation ingested'));
        } catch (error) {
            next(error);
        }
    }

    async addManualPrompt(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const user_id = req.user!.id;
            const campaign_id = get_campaign_id(req);
            const version_id = req.params.version_id ?? parse_version_id(req.query.version_id);
            const payload = manualPromptSchema.parse(req.body);
            const result = await campaignService.addManualPromptCandidate(tenant_id, user_id, campaign_id, version_id, payload);
            res.status(201).json(ApiResponse.success(result, 'Manual prompt added'));
        } catch (error) {
            next(error);
        }
    }

    async selectPromptCandidates(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const user_id = req.user!.id;
            const campaign_id = get_campaign_id(req);
            const version_id = req.params.version_id ?? parse_version_id(req.query.version_id);
            const payload = selectPromptCandidatesSchema.parse(req.body);
            const result = await campaignService.selectPromptCandidates(tenant_id, user_id, campaign_id, version_id, payload);
            res.json(ApiResponse.success(result));
        } catch (error) {
            next(error);
        }
    }

    async replacePromptSelection(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const user_id = req.user!.id;
            const campaign_id = get_campaign_id(req);
            const version_id = req.params.version_id ?? parse_version_id(req.query.version_id);
            const payload = replacePromptSelectionSchema.parse(req.body);
            const result = await campaignService.replacePromptSelection(tenant_id, user_id, campaign_id, version_id, payload.selectedPromptIds);
            res.json(ApiResponse.success(result));
        } catch (error) {
            next(error);
        }
    }

    async executePrompts(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const user_id = req.user!.id;
            const campaign_id = get_campaign_id(req);
            const version_id = req.params.version_id ?? parse_version_id(req.query.version_id);
            const payload = executePromptSchema.parse(req.body);
            const result = await campaignService.executePromptCandidates(tenant_id, user_id, campaign_id, version_id, payload);
            res.json(ApiResponse.success(result));
        } catch (error) {
            next(error);
        }
    }

    async getSiteTopQueries(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const tenant_id = req.user!.tenant_id;
            const user_id = req.user!.id;
            const campaign_id = get_campaign_id(req);
            const version_id = get_version_id(req);
            const payload = siteTopQueriesSchema.parse(req.body);
            const result = await campaignService.getSiteTopQueries(tenant_id, user_id, campaign_id, version_id, payload);
            res.json(ApiResponse.success(result));
        } catch (error) {
            next(error);
        }
    }
}

export const campaignController = new CampaignController();
