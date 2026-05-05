import { z } from 'zod';

export const exchangeExtensionSchema = z.object({
  code: z.string().min(1),
});

export type ExchangeExtensionDto = z.infer<typeof exchangeExtensionSchema>;
