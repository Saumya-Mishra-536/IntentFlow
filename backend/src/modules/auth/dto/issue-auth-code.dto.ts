import { z } from 'zod';

export const issueAuthCodeSchema = z.object({
  redirect_uri: z.string().min(1),
  state: z.string().optional(),
});

export type IssueAuthCodeDto = z.infer<typeof issueAuthCodeSchema>;
