import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { campaignController } from './campaign.controller';

const router = Router();

router.get('/:workspace_id/workflow/state', authMiddleware, campaignController.getWorkflowState);
router.post('/:workspace_id/providers/:provider/conversations/ingest', authMiddleware, campaignController.ingestConversation);
router.post('/:workspace_id/prompt-versions/:version_id/prompts/manual', authMiddleware, campaignController.addManualPrompt);
router.post('/:workspace_id/prompt-versions/:version_id/prompts/select', authMiddleware, campaignController.selectPromptCandidates);
router.post('/:workspace_id/prompt-versions/:version_id/prompts/selection-set', authMiddleware, campaignController.replacePromptSelection);
router.post('/:workspace_id/prompt-versions/:version_id/execute', authMiddleware, campaignController.executePrompts);
router.post('/:workspace_id/site-keywords/top-queries', authMiddleware, campaignController.getSiteTopQueries);

export { router as workspaceWorkflowRouter };
