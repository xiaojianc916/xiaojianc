import { z } from 'zod';

import {
  AI_AGENT_PERMISSION_SCOPES,
  AI_AGENT_PLAN_REFERENCE_TYPES,
  AI_AGENT_PLAN_RISK_LEVELS,
  AI_AGENT_PLAN_STEP_KINDS,
  AI_AGENT_PLAN_STEP_STATUSES,
  AI_AGENT_TASK_CLASSIFICATIONS,
} from '@/types/ai-agent';
import { aiContextReferenceSchema } from '@/types/ai-context.schema';
import {
  AI_AGENT_PERMISSION_LEVELS,
  AI_AGENT_TOOL_NAMES,
} from '@/types/ai-tools';

export const aiAgentToolNameSchema = z.enum(AI_AGENT_TOOL_NAMES);

export const aiAgentPermissionLevelSchema = z.enum(AI_AGENT_PERMISSION_LEVELS);

export const aiAgentPlanStepKindSchema = z.enum(AI_AGENT_PLAN_STEP_KINDS);

export const aiAgentPlanStepStatusSchema = z.enum(AI_AGENT_PLAN_STEP_STATUSES);

export const aiAgentPlanReferenceTypeSchema = z.enum(AI_AGENT_PLAN_REFERENCE_TYPES);

export const aiAgentPlanRiskLevelSchema = z.enum(AI_AGENT_PLAN_RISK_LEVELS);

export const aiAgentTaskClassificationSchema = z.enum(AI_AGENT_TASK_CLASSIFICATIONS);

export const aiAgentPermissionScopeSchema = z.enum(AI_AGENT_PERMISSION_SCOPES);

export const aiAgentPlanReferenceSchema = z.object({
  type: aiAgentPlanReferenceTypeSchema,
  label: z.string().min(1),
  uri: z.string().min(1),
});

export const aiTaskPlanStepSchema = z.object({
  id: z.string().min(1),
  index: z.number().int().nonnegative(),
  title: z.string().min(1),
  goal: z.string().min(1),
  kind: aiAgentPlanStepKindSchema,
  status: aiAgentPlanStepStatusSchema,
  expectedOutput: z.string().min(1),
  tools: z.array(aiAgentToolNameSchema).min(1),
  references: z.array(aiAgentPlanReferenceSchema).optional(),
  isActive: z.boolean().optional(),
  requiresUserApproval: z.boolean(),
  riskLevel: aiAgentPlanRiskLevelSchema,
  rollbackStrategy: z.string().min(1).optional(),
});

export const aiAgentPlanRequestSchema = z.object({
  goal: z.string().trim().min(1),
  context: z.array(aiContextReferenceSchema),
});

export const aiAgentPlanPayloadSchema = z.object({
  steps: z.array(aiTaskPlanStepSchema).min(2).max(6),
});

export const aiAgentClassifyTaskRequestSchema = z.object({
  goal: z.string().trim().min(1),
  context: z.array(aiContextReferenceSchema),
});

export const aiAgentClassifyTaskPayloadSchema = z.object({
  classification: aiAgentTaskClassificationSchema,
  shouldEnterPlanMode: z.boolean(),
  reason: z.string().trim().min(1),
});

export const aiAgentApprovePlanRequestSchema = z.object({
  goal: z.string().trim().min(1),
  steps: z.array(aiTaskPlanStepSchema).min(2).max(6),
});

export const aiAgentApprovePlanPayloadSchema = z.object({
  approvedAt: z.string().min(1),
  stepCount: z.number().int().min(2).max(6),
});

export const aiAgentPermissionStateSchema = z.object({
  level: aiAgentPermissionLevelSchema,
  scope: aiAgentPermissionScopeSchema,
  grantedAt: z.string().min(1),
  expiresAt: z.string().min(1).optional(),
  allowedHighRiskTools: z.array(aiAgentToolNameSchema),
});