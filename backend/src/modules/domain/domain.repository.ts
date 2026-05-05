import { Prisma } from '@prisma/client';

import { BaseRepository } from '../../core/repository';
import { prisma } from '../../utils/prisma';

export class DomainRepository extends BaseRepository {
  listDomains(tenant_id: string) {
    return prisma.domain.findMany({
      where: { tenant_id },
      orderBy: { created_at: 'desc' },
    });
  }

  findDomainById(tenant_id: string, domain_id: string) {
    return prisma.domain.findFirst({
      where: {
        id: domain_id,
        tenant_id,
      },
      include: {
        context: true,
      },
    });
  }

  findByNormalizedDomain(tenant_id: string, normalized_domain: string) {
    return prisma.domain.findFirst({
      where: {
        tenant_id,
        normalized_domain,
      },
      include: {
        context: true,
      },
    });
  }

  createDomain(params: {
    tenant_id: string;
    user_id: string;
    normalized_domain: string;
    display_domain: string;
    source_url: string;
  }) {
    return prisma.domain.create({
      data: {
        tenant_id: params.tenant_id,
        created_by_user_id: params.user_id,
        normalized_domain: params.normalized_domain,
        display_domain: params.display_domain,
        source_url: params.source_url,
        scrape_status: 'queued',
      },
      include: {
        context: true,
      },
    });
  }

  async createScrapeRun(domain_id: string) {
    return prisma.domainScrapeRun.create({
      data: {
        domain_id,
        status: 'running',
        started_at: new Date(),
      },
    });
  }

  async completeScrapeRun(params: { domain_id: string; run_id: string; page_count: number }) {
    const now = new Date();
    await prisma.$transaction([
      prisma.domainScrapeRun.update({
        where: { id: params.run_id },
        data: {
          status: 'completed',
          finished_at: now,
          page_count: params.page_count,
          error_message: null,
        },
      }),
      prisma.domain.update({
        where: { id: params.domain_id },
        data: {
          scrape_status: 'completed',
          last_scraped_at: now,
        },
      }),
    ]);
  }

  async failScrapeRun(params: { domain_id: string; run_id: string; error_message: string }) {
    const now = new Date();
    await prisma.$transaction([
      prisma.domainScrapeRun.update({
        where: { id: params.run_id },
        data: {
          status: 'failed',
          finished_at: now,
          error_message: params.error_message.slice(0, 500),
        },
      }),
      prisma.domain.update({
        where: { id: params.domain_id },
        data: {
          scrape_status: 'failed',
        },
      }),
    ]);
  }

  async markDomainRunning(domain_id: string) {
    await prisma.domain.update({
      where: { id: domain_id },
      data: { scrape_status: 'running' },
    });
  }

  async saveDomainContext(params: {
    domain_id: string;
    context_json: Record<string, unknown>;
    pages_json: Array<Record<string, unknown>>;
  }) {
    const context_json = params.context_json as Prisma.InputJsonValue;
    const pages_json = params.pages_json as Prisma.InputJsonValue;
    await prisma.domainContext.upsert({
      where: { domain_id: params.domain_id },
      create: {
        domain_id: params.domain_id,
        context_json,
        pages_json,
        extracted_at: new Date(),
      },
      update: {
        context_json,
        pages_json,
        extracted_at: new Date(),
      },
    });
  }
}

export const domainRepository = new DomainRepository();
