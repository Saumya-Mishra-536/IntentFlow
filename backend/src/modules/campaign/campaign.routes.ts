import { Router } from 'express';
import { campaignController } from './campaign.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';

const router = Router();

router.get('/analytics/dashboard', authMiddleware, campaignController.getDashboardAnalytics);

// Campaign endpoints
router.get('/', authMiddleware, campaignController.listCampaigns);
router.post('/', authMiddleware, campaignController.createCampaign);
router.get('/:campaign_id', authMiddleware, campaignController.getCampaign);
router.patch('/:campaign_id', authMiddleware, campaignController.updateCampaign);
router.delete('/:campaign_id', authMiddleware, campaignController.deleteCampaign);
router.get('/:campaign_id/versions', authMiddleware, campaignController.listVersions);

// Short-form aliases — what the web/extension clients actually call
router.get('/:campaign_id/tree', authMiddleware, campaignController.getTree);
router.get('/:campaign_id/chat-threads', authMiddleware, campaignController.getChatThreads);
router.post('/:campaign_id/chat-threads/link', authMiddleware, campaignController.linkChatThread);
router.post('/:campaign_id/chat-threads/:thread_id/opened', authMiddleware, campaignController.markChatThreadOpened);
router.get('/:campaign_id/suggestions/generated', authMiddleware, campaignController.getGeneratedSuggestions);
router.post('/:campaign_id/suggestions/generate', authMiddleware, campaignController.generateSuggestions);
router.post('/:campaign_id/capture/ingest-turn', authMiddleware, campaignController.ingestTurn);
router.post('/:campaign_id/nodes/:node_id/refresh', authMiddleware, campaignController.refreshNode);
router.get('/:campaign_id/workflow/state', authMiddleware, campaignController.getWorkflowState);
router.post('/:campaign_id/providers/:provider/conversations/ingest', authMiddleware, campaignController.ingestConversation);
router.post('/:campaign_id/versions/:version_id/prompts/manual', authMiddleware, campaignController.addManualPrompt);
router.post('/:campaign_id/versions/:version_id/prompts/select', authMiddleware, campaignController.selectPromptCandidates);
router.post('/:campaign_id/versions/:version_id/prompts/selection-set', authMiddleware, campaignController.replacePromptSelection);
router.post('/:campaign_id/versions/:version_id/execute', authMiddleware, campaignController.executePrompts);
router.post('/:campaign_id/site-keywords/top-queries', authMiddleware, campaignController.getSiteTopQueries);
router.get('/:campaign_id/analytics/pipeline', authMiddleware, campaignController.getPipelineAnalytics);
router.get('/:campaign_id/analytics/prompts', authMiddleware, campaignController.getPromptAnalytics);
router.get('/:campaign_id/analytics/websites', authMiddleware, campaignController.getWebsiteAnalytics);

// Version specific (defaulting to active version for ease of extension/ui adoption)
router.get('/:campaign_id/versions/active/tree', authMiddleware, campaignController.getActiveTree);
router.get('/:campaign_id/versions/active/chat-threads', authMiddleware, campaignController.getActiveChatThreads);
router.post('/:campaign_id/versions/active/capture/ingest-turn', authMiddleware, campaignController.ingestTurn);

// Refire
router.post('/:campaign_id/versions/:version_number/refire', authMiddleware, campaignController.refire);


export { router as campaignRouter };
