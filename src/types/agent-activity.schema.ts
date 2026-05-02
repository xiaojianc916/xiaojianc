import { z } from 'zod';

import {
  AGENT_ACTIVITY_KINDS,
  AGENT_ACTIVITY_STATUSES,
} from '@/types/agent-activity';

export const agentActivityStatusSchema = z.enum(AGENT_ACTIVITY_STATUSES);

export const agentActivityKindSchema = z.enum(AGENT_ACTIVITY_KINDS);

export const agentActivityDetailSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
  priority: z.number().finite().positive().optional(),
});

export const agentActivityFileSchema = z.object({
  path: z.string().min(1),
  basename: z.string().min(1),
  action: z.enum(['search', 'read', 'edit']),
  resultCount: z.number().int().nonnegative().optional(),
});

export const agentActivitySearchSchema = z.object({
  query: z.string().min(1),
  glob: z.string().min(1).optional(),
  resultCount: z.number().int().nonnegative().optional(),
});

export const agentActivityToolSchema = z.object({
  callId: z.string().min(1),
  name: z.string().min(1),
  argsSummary: z.string().min(1).optional(),
});

export const agentActivityCommandSchema = z.object({
  command: z.string().min(1),
  cwd: z.string().min(1).optional(),
  exitCode: z.number().int().optional(),
});

export const agentActivityErrorSchema = z.object({
  name: z.string().min(1).optional(),
  message: z.string().min(1),
});

export const agentActivitySchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  parentId: z.string().min(1).optional(),
  kind: agentActivityKindSchema,
  status: agentActivityStatusSchema,
  title: z.string().min(1),
  description: z.string().min(1).optional(),
  startedAt: z.number().int().nonnegative().optional(),
  endedAt: z.number().int().nonnegative().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  inputSummary: z.string().min(1).optional(),
  outputSummary: z.string().min(1).optional(),
  details: z.array(agentActivityDetailSchema).optional(),
  files: z.array(agentActivityFileSchema).optional(),
  search: agentActivitySearchSchema.optional(),
  tool: agentActivityToolSchema.optional(),
  command: agentActivityCommandSchema.optional(),
  error: agentActivityErrorSchema.optional(),
  metadata: z.record(z.string(), z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
  ])).optional(),
});
