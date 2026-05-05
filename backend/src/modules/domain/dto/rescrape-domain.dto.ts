import { z } from 'zod';

export const rescrapeDomainSchema = z.object({});

export type RescrapeDomainDto = z.infer<typeof rescrapeDomainSchema>;
