-- CreateEnum
CREATE TYPE "DomainScrapeStatus" AS ENUM ('queued', 'running', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "AccountJoinRequestStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "AuthCodeStatus" AS ENUM ('active', 'used', 'expired');

-- CreateEnum
CREATE TYPE "CaptureStatus" AS ENUM ('listening', 'intercepting', 'analyzing', 'generating', 'complete', 'failed');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('queued', 'processing', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "AiChatProvider" AS ENUM ('chatgpt', 'claude', 'gemini', 'perplexity', 'grok', 'unknown');

-- CreateEnum
CREATE TYPE "NodeType" AS ENUM ('prompt', 'subquery', 'site', 'generated');

-- CreateEnum
CREATE TYPE "CampaignVersionStatus" AS ENUM ('draft', 'active', 'archived');

-- CreateEnum
CREATE TYPE "AppRole" AS ENUM ('admin', 'user');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT,
    "name" TEXT,
    "avatar_url" TEXT,
    "active_tenant_id" TEXT,
    "app_role" "AppRole" NOT NULL DEFAULT 'user',
    "company_name" TEXT,
    "company_domain" TEXT,
    "linkedin_url" TEXT,
    "x_url" TEXT,
    "other_social_urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "timezone" TEXT,
    "locale" TEXT,
    "job_role" TEXT,
    "lead_score_current" DOUBLE PRECISION,
    "lead_segment" TEXT,
    "lead_score_updated_at" TIMESTAMP(3),
    "scoring_model_version" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "userId" TEXT,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantMember" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'owner',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Domain" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "normalized_domain" TEXT NOT NULL,
    "display_domain" TEXT NOT NULL,
    "source_url" TEXT NOT NULL,
    "scrape_status" "DomainScrapeStatus" NOT NULL DEFAULT 'queued',
    "last_scraped_at" TIMESTAMP(3),
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Domain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainContext" (
    "id" TEXT NOT NULL,
    "domain_id" TEXT NOT NULL,
    "context_json" JSONB NOT NULL,
    "pages_json" JSONB NOT NULL,
    "extracted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DomainContext_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainScrapeRun" (
    "id" TEXT NOT NULL,
    "domain_id" TEXT NOT NULL,
    "status" "DomainScrapeStatus" NOT NULL DEFAULT 'queued',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "error_message" TEXT,
    "page_count" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DomainScrapeRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountJoinRequest" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "requestor_user_id" TEXT NOT NULL,
    "status" "AccountJoinRequestStatus" NOT NULL DEFAULT 'pending',
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "resolved_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountJoinRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthAccount" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OAuthAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthCode" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "state" TEXT,
    "status" "AuthCodeStatus" NOT NULL DEFAULT 'active',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "domain_id" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "metadata" JSONB,
    "target_location" TEXT,
    "industry_tag" TEXT,
    "business_type" TEXT,
    "primary_goal" TEXT,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignVersion" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "label" TEXT,
    "status" "CampaignVersionStatus" NOT NULL DEFAULT 'draft',
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "config_json" JSONB,
    "archive_storage_uri" TEXT,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaptureSession" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "campaign_version_id" TEXT NOT NULL,
    "chat_provider" "AiChatProvider" NOT NULL DEFAULT 'unknown',
    "conversation_id" TEXT NOT NULL,
    "provider_chat_id" TEXT,
    "chat_url" TEXT,
    "chat_title" TEXT,
    "status" "CaptureStatus" NOT NULL DEFAULT 'listening',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_event_at" TIMESTAMP(3),
    "last_opened_at" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "CaptureSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaptureTurn" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "capture_session_id" TEXT NOT NULL,
    "request_id" TEXT,
    "turn_exchange_id" TEXT,
    "prompt" TEXT NOT NULL,
    "finished_reason" TEXT,
    "raw_event_json" JSONB,
    "metadata" JSONB,
    "prompt_detected_at" TIMESTAMP(3),
    "response_finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaptureTurn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptNode" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "campaign_version_id" TEXT NOT NULL,
    "capture_session_id" TEXT,
    "capture_turn_id" TEXT,
    "parent_id" TEXT,
    "type" "NodeType" NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromptNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SemrushSnapshot" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "campaign_version_id" TEXT NOT NULL,
    "prompt_node_id" TEXT,
    "query_text" TEXT NOT NULL,
    "summary_metrics" JSONB,
    "raw_response" JSONB,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SemrushSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenerationRun" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "campaign_version_id" TEXT NOT NULL,
    "capture_turn_id" TEXT,
    "status" "RunStatus" NOT NULL DEFAULT 'queued',
    "depth_limit" INTEGER NOT NULL DEFAULT 3,
    "node_limit" INTEGER NOT NULL DEFAULT 200,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GenerationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "campaign_id" TEXT,
    "session_id" TEXT,
    "event_name" TEXT NOT NULL,
    "properties" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadSignal" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "campaign_version_id" TEXT,
    "user_id" TEXT NOT NULL,
    "signal_type" TEXT NOT NULL,
    "value" JSONB,
    "confidence" DOUBLE PRECISION,
    "source_turn_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadSignal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_active_tenant_id_idx" ON "User"("active_tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE INDEX "Tenant_owner_user_id_created_at_idx" ON "Tenant"("owner_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "TenantMember_user_id_created_at_idx" ON "TenantMember"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "TenantMember_tenant_id_user_id_key" ON "TenantMember"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "Domain_tenant_id_created_at_idx" ON "Domain"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Domain_tenant_id_normalized_domain_key" ON "Domain"("tenant_id", "normalized_domain");

-- CreateIndex
CREATE UNIQUE INDEX "DomainContext_domain_id_key" ON "DomainContext"("domain_id");

-- CreateIndex
CREATE INDEX "DomainContext_extracted_at_idx" ON "DomainContext"("extracted_at" DESC);

-- CreateIndex
CREATE INDEX "DomainScrapeRun_domain_id_started_at_idx" ON "DomainScrapeRun"("domain_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "AccountJoinRequest_tenant_id_status_requested_at_idx" ON "AccountJoinRequest"("tenant_id", "status", "requested_at" DESC);

-- CreateIndex
CREATE INDEX "AccountJoinRequest_requestor_user_id_requested_at_idx" ON "AccountJoinRequest"("requestor_user_id", "requested_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "OAuthAccount_provider_provider_account_id_key" ON "OAuthAccount"("provider", "provider_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_token_hash_key" ON "RefreshToken"("token_hash");

-- CreateIndex
CREATE INDEX "RefreshToken_user_id_revoked_at_idx" ON "RefreshToken"("user_id", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "AuthCode_code_hash_key" ON "AuthCode"("code_hash");

-- CreateIndex
CREATE INDEX "AuthCode_user_id_status_idx" ON "AuthCode"("user_id", "status");

-- CreateIndex
CREATE INDEX "Campaign_tenant_id_created_at_idx" ON "Campaign"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "Campaign_tenant_id_archived_at_created_at_idx" ON "Campaign"("tenant_id", "archived_at", "created_at" DESC);

-- CreateIndex
CREATE INDEX "Campaign_tenant_id_domain_id_created_at_idx" ON "Campaign"("tenant_id", "domain_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "CampaignVersion_tenant_id_campaign_id_created_at_idx" ON "CampaignVersion"("tenant_id", "campaign_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "CampaignVersion_tenant_id_is_active_created_at_idx" ON "CampaignVersion"("tenant_id", "is_active", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignVersion_campaign_id_version_number_key" ON "CampaignVersion"("campaign_id", "version_number");

-- CreateIndex
CREATE INDEX "idx_cs_started_at" ON "CaptureSession"("tenant_id", "campaign_version_id", "chat_provider", "started_at" DESC);

-- CreateIndex
CREATE INDEX "idx_cs_last_event_at" ON "CaptureSession"("tenant_id", "campaign_version_id", "last_event_at" DESC);

-- CreateIndex
CREATE INDEX "idx_cs_provider_chat_id" ON "CaptureSession"("tenant_id", "campaign_version_id", "chat_provider", "provider_chat_id");

-- CreateIndex
CREATE INDEX "idx_cs_chat_url" ON "CaptureSession"("tenant_id", "campaign_version_id", "chat_provider", "chat_url");

-- CreateIndex
CREATE UNIQUE INDEX "CaptureSession_tenant_id_campaign_version_id_chat_provider__key" ON "CaptureSession"("tenant_id", "campaign_version_id", "chat_provider", "conversation_id");

-- CreateIndex
CREATE INDEX "CaptureTurn_tenant_id_capture_session_id_response_finished__idx" ON "CaptureTurn"("tenant_id", "capture_session_id", "response_finished_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "CaptureTurn_capture_session_id_request_id_turn_exchange_id_key" ON "CaptureTurn"("capture_session_id", "request_id", "turn_exchange_id");

-- CreateIndex
CREATE INDEX "PromptNode_tenant_id_campaign_version_id_created_at_idx" ON "PromptNode"("tenant_id", "campaign_version_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "PromptNode_tenant_id_capture_session_id_created_at_idx" ON "PromptNode"("tenant_id", "capture_session_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "PromptNode_capture_turn_id_idx" ON "PromptNode"("capture_turn_id");

-- CreateIndex
CREATE INDEX "SemrushSnapshot_tenant_id_campaign_version_id_fetched_at_idx" ON "SemrushSnapshot"("tenant_id", "campaign_version_id", "fetched_at" DESC);

-- CreateIndex
CREATE INDEX "GenerationRun_tenant_id_status_created_at_idx" ON "GenerationRun"("tenant_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "AnalyticsEvent_tenant_id_event_name_created_at_idx" ON "AnalyticsEvent"("tenant_id", "event_name", "created_at" DESC);

-- CreateIndex
CREATE INDEX "AnalyticsEvent_user_id_created_at_idx" ON "AnalyticsEvent"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "LeadSignal_tenant_id_user_id_signal_type_created_at_idx" ON "LeadSignal"("tenant_id", "user_id", "signal_type", "created_at" DESC);

-- CreateIndex
CREATE INDEX "LeadSignal_tenant_id_campaign_version_id_created_at_idx" ON "LeadSignal"("tenant_id", "campaign_version_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_active_tenant_id_fkey" FOREIGN KEY ("active_tenant_id") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantMember" ADD CONSTRAINT "TenantMember_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantMember" ADD CONSTRAINT "TenantMember_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Domain" ADD CONSTRAINT "Domain_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Domain" ADD CONSTRAINT "Domain_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainContext" ADD CONSTRAINT "DomainContext_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "Domain"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainScrapeRun" ADD CONSTRAINT "DomainScrapeRun_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "Domain"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountJoinRequest" ADD CONSTRAINT "AccountJoinRequest_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountJoinRequest" ADD CONSTRAINT "AccountJoinRequest_requestor_user_id_fkey" FOREIGN KEY ("requestor_user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountJoinRequest" ADD CONSTRAINT "AccountJoinRequest_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthAccount" ADD CONSTRAINT "OAuthAccount_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthCode" ADD CONSTRAINT "AuthCode_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "Domain"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignVersion" ADD CONSTRAINT "CampaignVersion_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignVersion" ADD CONSTRAINT "CampaignVersion_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignVersion" ADD CONSTRAINT "CampaignVersion_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureSession" ADD CONSTRAINT "CaptureSession_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureSession" ADD CONSTRAINT "CaptureSession_campaign_version_id_fkey" FOREIGN KEY ("campaign_version_id") REFERENCES "CampaignVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureTurn" ADD CONSTRAINT "CaptureTurn_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureTurn" ADD CONSTRAINT "CaptureTurn_capture_session_id_fkey" FOREIGN KEY ("capture_session_id") REFERENCES "CaptureSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptNode" ADD CONSTRAINT "PromptNode_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptNode" ADD CONSTRAINT "PromptNode_campaign_version_id_fkey" FOREIGN KEY ("campaign_version_id") REFERENCES "CampaignVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptNode" ADD CONSTRAINT "PromptNode_capture_session_id_fkey" FOREIGN KEY ("capture_session_id") REFERENCES "CaptureSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptNode" ADD CONSTRAINT "PromptNode_capture_turn_id_fkey" FOREIGN KEY ("capture_turn_id") REFERENCES "CaptureTurn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptNode" ADD CONSTRAINT "PromptNode_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "PromptNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SemrushSnapshot" ADD CONSTRAINT "SemrushSnapshot_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SemrushSnapshot" ADD CONSTRAINT "SemrushSnapshot_campaign_version_id_fkey" FOREIGN KEY ("campaign_version_id") REFERENCES "CampaignVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SemrushSnapshot" ADD CONSTRAINT "SemrushSnapshot_prompt_node_id_fkey" FOREIGN KEY ("prompt_node_id") REFERENCES "PromptNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationRun" ADD CONSTRAINT "GenerationRun_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationRun" ADD CONSTRAINT "GenerationRun_campaign_version_id_fkey" FOREIGN KEY ("campaign_version_id") REFERENCES "CampaignVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationRun" ADD CONSTRAINT "GenerationRun_capture_turn_id_fkey" FOREIGN KEY ("capture_turn_id") REFERENCES "CaptureTurn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSignal" ADD CONSTRAINT "LeadSignal_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSignal" ADD CONSTRAINT "LeadSignal_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSignal" ADD CONSTRAINT "LeadSignal_campaign_version_id_fkey" FOREIGN KEY ("campaign_version_id") REFERENCES "CampaignVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSignal" ADD CONSTRAINT "LeadSignal_source_turn_id_fkey" FOREIGN KEY ("source_turn_id") REFERENCES "CaptureTurn"("id") ON DELETE SET NULL ON UPDATE CASCADE;
