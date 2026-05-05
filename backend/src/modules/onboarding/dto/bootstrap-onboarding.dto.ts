import { z } from 'zod';

const createAccountSchema = z.object({
  mode: z.literal('create_account'),
  domain_url: z.string().min(1),
});

const joinAccountSchema = z.object({
  mode: z.literal('join_account'),
  account_slug: z.string().min(2).max(64),
});

export const bootstrapOnboardingSchema = z.discriminatedUnion('mode', [
  createAccountSchema,
  joinAccountSchema,
]);

export type BootstrapOnboardingDto = z.infer<typeof bootstrapOnboardingSchema>;
