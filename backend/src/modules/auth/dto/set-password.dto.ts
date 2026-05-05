import { z } from 'zod';

export const setPasswordSchema = z.object({
    password: z.string().min(8, 'Password must be at least 8 characters long'),
});

export type SetPasswordDto = z.infer<typeof setPasswordSchema>;
