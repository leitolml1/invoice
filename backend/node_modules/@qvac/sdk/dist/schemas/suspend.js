import { z } from 'zod';
export const suspendRequestSchema = z.object({
    type: z.literal('suspend')
});
export const suspendResponseSchema = z.object({
    type: z.literal('suspend')
});
