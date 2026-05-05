import { z } from 'zod';

export const switchAccountSchema = z.object({
  tenant_id: z.string().min(1),
});

export type SwitchAccountDto = z.infer<typeof switchAccountSchema>;
