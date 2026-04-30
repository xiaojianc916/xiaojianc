import { z } from 'zod';

import {
  AI_AGENT_PERMISSION_SCOPES,
  AI_AGENT_NETWORK_PERMISSIONS,
  AI_AGENT_PLAN_REFERENCE_TYPES,
  AI_AGENT_PLAN_RISK_LEVELS,
  AI_AGENT_PLAN_STEP_KINDS,
  AI_AGENT_PLAN_STEP_STATUSES,
  AI_AGENT_RUN_STATUSES,
  AI_AGENT_TIMELINE_ITEM_STATUSES,
  AI_AGENT_TIMELINE_ITEM_TYPES,
  AI_AGENT_TASK_CLASSIFICATIONS,
  AI_TOOL_CONFIRMATION_DECISIONS,
  AI_TOOL_CONFIRMATION_OPTION_IDS,
  AI_TOOL_CONFIRMATION_OPTION_TONES,
} from '@/types/ai-agent';
import { aiContextReferenceSchema } from '@/types/ai-context.schema';
import {
  AI_AGENT_PERMISSION_LEVELS,
  AI_AGENT_TOOL_NAMES,
} from '@/types/ai-tools';
import { aiWebSourceEntryStatusSchema, aiWebSourceTypeSchema } from '@/types/ai-web.schema';

export const aiAgentToolNameSchema = z.enum(AI_AGENT_TOOL_NAMES);

export const aiAgentPermissionLevelSchema = z.enum(AI_AGENT_PERMISSION_LEVELS);

export const aiAgentPlanStepKindSchema = z.enum(AI_AGENT_PLAN_STEP_KINDS);

export const aiAgentPlanStepStatusSchema = z.enum(AI_AGENT_PLAN_STEP_STATUSES);

export const aiAgentPlanReferenceTypeSchema = z.enum(AI_AGENT_PLAN_REFERENCE_TYPES);

export const aiAgentPlanRiskLevelSchema = z.enum(AI_AGENT_PLAN_RISK_LEVELS);

export const aiAgentTaskClassificationSchema = z.enum(AI_AGENT_TASK_CLASSIFICATIONS);

export const aiAgentPermissionScopeSchema = z.enum(AI_AGENT_PERMISSION_SCOPES);

export const aiAgentNetworkPermissionSchema = z.enum(AI_AGENT_NETWORK_PERMISSIONS);

export const aiAgentRunStatusSchema = z.enum(AI_AGENT_RUN_STATUSES);

export const aiAgentTimelineItemTypeSchema = z.enum(AI_AGENT_TIMELINE_ITEM_TYPES);

export const aiAgentTimelineItemStatusSchema = z.enum(AI_AGENT_TIMELINE_ITEM_STATUSES);

export const aiToolConfirmationOptionIdSchema = z.enum(AI_TOOL_CONFIRMATION_OPTION_IDS);

export const aiToolConfirmationDecisionSchema = z.enum(AI_TOOL_CONFIRMATION_DECISIONS);

export const aiToolConfirmationOptionToneSchema = z.enum(AI_TOOL_CONFIRMATION_OPTION_TONES);

export const aiAgentPlanReferenceSchema = z.object({
  type: aiAgentPlanReferenceTypeSchema,
  label: z.string().min(1),
  uri: z.string().min(1),
});

export const aiRunCommandToolInputSchema = z.object({
  command: z.string().trim().min(1),
  reason: z.string().trim().min(1),
  cwdPolicy: z.literal('workspace-root'),
  timeoutMs: z.number().int().min(1_000).max(120_000).optional(),
});

export const aiStageFileToolInputSchema = z.object({
  paths: z.array(z.string().trim().min(1)).min(1).max(32),
  reason: z.string().trim().min(1),
});

export const aiCreateCommitToolInputSchema = z.object({
  message: z.string().trim().min(1).max(500),
  reason: z.string().trim().min(1),
  allowEmpty: z.boolean().optional(),
});

export const aiAgentToolInputsSchema = z.object({
  runCommand: aiRunCommandToolInputSchema.optional(),
  stageFile: aiStageFileToolInputSchema.optional(),
  createCommit: aiCreateCommitToolInputSchema.optional(),
}).optional();

export const aiTaskPlanStepSchema = z.object({
  id: z.string().min(1),
  index: z.number().int().nonnegative(),
  title: z.string().min(1),
  goal: z.string().min(1),
  kind: aiAgentPlanStepKindSchema,
  status: aiAgentPlanStepStatusSchema,
  expectedOutput: z.string().min(1),
  tools: z.array(aiAgentToolNameSchema).min(1),
  toolInputs: aiAgentToolInputsSchema,
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

export const aiAgentRunSchema = z.object({
  id: z.string().min(1),
  goal: z.string().min(1),
  status: aiAgentRunStatusSchema,
  steps: z.array(aiTaskPlanStepSchema).min(2).max(6),
  currentStepId: z.string().min(1).nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  startedAt: z.string().min(1).nullable(),
  completedAt: z.string().min(1).nullable(),
  errorMessage: z.string().min(1).nullable(),
});

export const aiAgentRunPlanRequestSchema = z.object({
  goal: z.string().trim().min(1),
  steps: z.array(aiTaskPlanStepSchema).min(2).max(6),
  context: z.array(aiContextReferenceSchema).default([]),
});

export const aiAgentRunStepRequestSchema = z.object({
  runId: z.string().trim().min(1),
  stepId: z.string().trim().min(1).optional(),
});

export const aiAgentRunIdRequestSchema = z.object({
  runId: z.string().trim().min(1),
});

export const aiAgentRunPayloadSchema = z.object({
  run: aiAgentRunSchema,
});

export const aiAgentListRunsPayloadSchema = z.object({
  runs: z.array(aiAgentRunSchema),
});

export const aiAgentStepWebSourceSummarySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  url: z.string().url(),
  sourceType: aiWebSourceTypeSchema,
  status: aiWebSourceEntryStatusSchema,
  queryPreview: z.string(),
  fetchedAt: z.string().min(1),
  textRef: z.string().min(1).optional(),
  excerpt: z.string().optional(),
});

export const aiAgentStepToolResultSummarySchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  stepId: z.string().min(1),
  toolName: aiAgentToolNameSchema,
  status: z.enum(['succeeded', 'failed']),
  summary: z.string().min(1),
  startedAt: z.string().min(1),
  endedAt: z.string().min(1),
  outputRef: z.string().min(1).optional(),
});

export const aiAgentStepDetailSchema = z.object({
  runId: z.string().min(1),
  stepId: z.string().min(1),
  webSources: z.array(aiAgentStepWebSourceSummarySchema),
  toolResults: z.array(aiAgentStepToolResultSummarySchema),
  updatedAt: z.string().min(1),
});

export const aiAgentTimelineItemSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  stepId: z.string().min(1),
  type: aiAgentTimelineItemTypeSchema,
  title: z.string().min(1),
  status: aiAgentTimelineItemStatusSchema,
  createdAt: z.string().min(1),
  subtitle: z.string().min(1).optional(),
  detailRef: z.string().min(1).optional(),
});

export const aiAgentSetNetworkPermissionRequestSchema = z.object({
  permission: aiAgentNetworkPermissionSchema,
});

export const aiAgentNetworkPermissionPayloadSchema = z.object({
  permission: aiAgentNetworkPermissionSchema,
});

export const aiAgentPermissionStateSchema = z.object({
  level: aiAgentPermissionLevelSchema,
  scope: aiAgentPermissionScopeSchema,
  grantedAt: z.string().min(1),
  expiresAt: z.string().min(1).optional(),
  allowedHighRiskTools: z.array(aiAgentToolNameSchema),
});

export const aiToolConfirmationOptionSchema = z.object({
  id: aiToolConfirmationOptionIdSchema,
  label: z.string().min(1),
  tone: aiToolConfirmationOptionToneSchema.optional(),
});

export const aiToolConfirmationRequestSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  stepId: z.string().min(1),
  toolName: aiAgentToolNameSchema,
  question: z.string().min(1),
  summary: z.string().min(1),
  riskLevel: aiAgentPlanRiskLevelSchema,
  impact: z.string().min(1).optional(),
  reversible: z.boolean(),
  createdAt: z.string().min(1),
  options: z.array(aiToolConfirmationOptionSchema).min(1),
});

export const aiAgentResolveToolConfirmationRequestSchema = z.object({
  runId: z.string().trim().min(1),
  confirmationId: z.string().trim().min(1),
  decision: aiToolConfirmationDecisionSchema,
});
