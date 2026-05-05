import { z } from 'zod';

export const refreshTokenSchema = z.object({
  refresh_token: z.string().min(1),
});

export type RefreshTokenDto = z.infer<typeof refreshTokenSchema>;
