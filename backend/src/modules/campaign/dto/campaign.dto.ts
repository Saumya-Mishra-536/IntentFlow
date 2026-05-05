import { z } from 'zod';

const chatProviderSchema = z.enum(['chatgpt', 'claude', 'gemini', 'perplexity', 'grok', 'unknown']);

export const createCampaignSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    domain_id: z.string().min(1, 'domain_id is required'),
    description: z.string().optional(),
    target_location: z.string().optional(),
    industry_tag: z.string().optional(),
    business_type: z.string().optional(),
    primary_goal: z.string().optional(),
});

export type CreateCampaignDto = z.infer<typeof createCampaignSchema>;

export const updateCampaignSchema = z.object({
    name: z.string().min(1, 'Name is required').optional(),
    description: z.string().optional(),
    target_location: z.string().optional(),
    industry_tag: z.string().optional(),
    business_type: z.string().optional(),
    primary_goal: z.string().optional(),
});

export type UpdateCampaignDto = z.infer<typeof updateCampaignSchema>;

export const ingestTurnSchema = z.object({
    chat_provider: chatProviderSchema,
    conversation_id: z.string(),
    provider_chat_id: z.string().optional(),
    chat_url: z.string().optional(),
    chat_title: z.string().optional(),
    request_id: z.string().optional(),
    turn_exchange_id: z.string().optional(),
    prompt: z.string(),
    finished_reason: z.string().optional(),
    queries: z.array(z.string()).optional(),
    result_groups: z.array(z.any()).optional(),
    active_prompt_node_id: z.string().optional(),
    metadata: z.record(z.any()).optional(),
});

export type IngestTurnDto = z.infer<typeof ingestTurnSchema>;

export const refireSchema = z.object({
    source_version_number: z.number().int().positive(),
});

export type RefireDto = z.infer<typeof refireSchema>;

export const linkChatThreadSchema = z.object({
    chat_provider: chatProviderSchema,
    conversation_id: z.string().optional(),
    provider_chat_id: z.string().optional(),
    chat_url: z.string().url().optional(),
    chat_title: z.string().optional(),
});

export type LinkChatThreadDto = z.infer<typeof linkChatThreadSchema>;

export const refreshNodeSchema = z.object({
    provider: chatProviderSchema.optional(),
    scope: z.enum(['node', 'branch']).optional(),
});

export type RefreshNodeDto = z.infer<typeof refreshNodeSchema>;

export const conversationIngestSchema = z.object({
    conversationId: z.string().min(1, 'conversationId is required'),
    payload: z.any(),
    promptVersionId: z.string().optional(),
    source: z.string().min(1).optional(),
    prompt: z.string().optional(),
    sourcePromptId: z.string().optional(),
});

export type ConversationIngestDto = z.infer<typeof conversationIngestSchema>;

export const manualPromptSchema = z.object({
    text: z.string().min(1, 'text is required'),
});

export type ManualPromptDto = z.infer<typeof manualPromptSchema>;

export const selectPromptCandidatesSchema = z.object({
    promptIds: z.array(z.string()).min(1, 'promptIds is required'),
    selected: z.boolean(),
});

export type SelectPromptCandidatesDto = z.infer<typeof selectPromptCandidatesSchema>;

export const replacePromptSelectionSchema = z.object({
    selectedPromptIds: z.array(z.string()),
});

export type ReplacePromptSelectionDto = z.infer<typeof replacePromptSelectionSchema>;

export const executePromptSchema = z.object({
    mode: z.enum(['fire', 'refire']),
    promptIds: z.array(z.string()).min(1, 'promptIds is required'),
    provider: chatProviderSchema,
});

export type ExecutePromptDto = z.infer<typeof executePromptSchema>;

const siteTopQueryTargetSchema = z.object({
    domain: z.string().min(1).optional(),
    page_url: z.string().url().optional(),
}).superRefine((value, ctx) => {
    if (!value.domain && !value.page_url) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Each target must include domain or page_url',
            path: ['target'],
        });
    }
});

export const siteTopQueriesSchema = z.object({
    targets: z.array(siteTopQueryTargetSchema).optional(),
    hosts: z.array(z.string().min(1)).optional(),
    country: z.string().min(2).max(3).default('IN'),
    limit: z.number().int().min(1).max(50).default(10),
    forceRefresh: z.boolean().optional(),
}).superRefine((value, ctx) => {
    const has_targets = (value.targets?.length ?? 0) > 0;
    const has_hosts = (value.hosts?.length ?? 0) > 0;
    if (!has_targets && !has_hosts) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'targets or hosts are required',
            path: ['targets'],
        });
    }
});

export type SiteTopQueriesDto = z.infer<typeof siteTopQueriesSchema>;
