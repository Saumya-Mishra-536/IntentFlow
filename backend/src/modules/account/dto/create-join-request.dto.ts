import { z } from 'zod';

export const createJoinRequestSchema = z.object({
  account_slug: z.string().min(2).max(64),
});

export type CreateJoinRequestDto = z.infer<typeof createJoinRequestSchema>;
