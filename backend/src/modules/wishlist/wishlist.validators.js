import { z } from 'zod';
import { objectIdSchema } from '../../validators/common.js';

export const wishlistProductSchema = z.object({ productId: objectIdSchema });

export const wishlistParamsSchema = z.object({ productId: objectIdSchema });
