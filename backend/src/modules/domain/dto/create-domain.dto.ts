import { z } from 'zod';

export const createDomainSchema = z.object({
  domain_url: z.string().min(1),
});

export type CreateDomainDto = z.infer<typeof createDomainSchema>;
