import { z } from 'zod';
export const lifecycleStateSchema = z.enum(['active', 'suspending', 'suspended', 'resuming']);
export const stateRequestSchema = z.object({
    type: z.literal('state')
});
export const stateResponseSchema = z.object({
    type: z.literal('state'),
    state: lifecycleStateSchema
});
