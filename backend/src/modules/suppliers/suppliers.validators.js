import { z } from 'zod';
import { DEFAULT_SUPPLIER_CAPABILITIES, SUPPLIER_ADAPTER_TYPES } from '../../constants/supplier.js';
import { paginationQuerySchema } from '../../validators/common.js';

const capabilityShape = Object.fromEntries(
  Object.keys(DEFAULT_SUPPLIER_CAPABILITIES).map((key) => [key, z.boolean().optional()])
);

const capabilitiesSchema = z.object(capabilityShape).partial();

const markupRuleSchema = z.object({
  type: z.enum(['percent', 'fixed']).optional(),
  value: z.coerce.number().min(0, 'Markup value cannot be negative').max(1000000).optional(),
  minMarginPercent: z.coerce.number().min(0).max(100).optional()
});

const credentialValueSchema = z.union([z.string(), z.number(), z.boolean()]);

export const credentialSchema = z
  .record(credentialValueSchema)
  .refine((value) => Object.keys(value).length > 0, 'At least one credential field is required');

export const createSupplierSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    code: z
      .string()
      .trim()
      .min(2)
      .max(60)
      .regex(/^[A-Za-z0-9_-]+$/, 'Code may contain letters, numbers, underscore and hyphen only'),
    description: z.string().trim().max(1000).optional().default(''),
    adapterType: z.enum(Object.values(SUPPLIER_ADAPTER_TYPES)).default(SUPPLIER_ADAPTER_TYPES.MOCK),
    baseUrl: z.string().trim().url('Base URL must be a valid URL').optional(),
    allowedHosts: z.array(z.string().trim().max(253)).max(20).optional().default([]),
    credentials: credentialSchema.optional(),
    config: z.record(z.any()).optional().default({}),
    capabilities: capabilitiesSchema.optional(),
    markupRule: markupRuleSchema.optional(),
    isActive: z.boolean().optional().default(true)
  })
  .superRefine((value, ctx) => {
    if (value.adapterType === SUPPLIER_ADAPTER_TYPES.GENERIC_REST && !value.baseUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['baseUrl'],
        message: 'baseUrl is required for the generic_rest adapter'
      });
    }
  });

export const updateSupplierSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().max(1000).optional(),
    baseUrl: z.string().trim().url('Base URL must be a valid URL').optional(),
    allowedHosts: z.array(z.string().trim().max(253)).max(20).optional(),
    capabilities: capabilitiesSchema.optional(),
    config: z.record(z.any()).optional(),
    markupRule: markupRuleSchema.optional(),
    isActive: z.boolean().optional()
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export const updateMarkupSchema = markupRuleSchema.refine(
  (value) => Object.keys(value).length > 0,
  'At least one markup field is required'
);

export const supplierLogsQuerySchema = paginationQuerySchema.extend({
  type: z.enum(['catalogue', 'inventory', 'order_submit', 'order_status', 'tracking', 'connection_test']).optional(),
  status: z.enum(['started', 'success', 'partial', 'failed']).optional()
});

export const listSuppliersQuerySchema = paginationQuerySchema.extend({
  isActive: z.enum(['true', 'false']).optional(),
  adapterType: z.enum(Object.values(SUPPLIER_ADAPTER_TYPES)).optional(),
  search: z.string().trim().max(100).optional()
});

export const syncCatalogueSchema = z.object({
  maxPages: z.coerce.number().int().min(1).max(200).optional()
});

export const syncInventorySchema = z.object({
  markMissingUnavailable: z.boolean().optional().default(false)
});

export const staleScanSchema = z.object({
  hours: z.coerce.number().int().min(1).max(720).optional()
});
