import type { IAiContextReference } from './ai-context';
import type { TAiAgentPermissionLevel, TAiAgentToolName } from './ai-tools';

export const AI_AGENT_PLAN_STEP_KINDS = [
  'inspect',
  'search',
  'design',
  'edit',
  'verify',
  'summarize',
] as const;

export const AI_AGENT_PLAN_STEP_STATUSES = [
  'pending',
  'running',
  'done',
  'failed',
  'skipped',
  'cancelled',
] as const;

export const AI_AGENT_PLAN_REFERENCE_TYPES = [
  'file',
  'symbol',
  'diagnostic',
  'web',
  'snapshot',
  'diff',
] as const;

export const AI_AGENT_PLAN_RISK_LEVELS = ['low', 'medium', 'high'] as const;

export const AI_AGENT_TASK_CLASSIFICATIONS = ['simple', 'complex'] as const;

export const AI_AGENT_PERMISSION_SCOPES = ['run', 'session'] as const;

export type TAiAgentPlanStepKind = (typeof AI_AGENT_PLAN_STEP_KINDS)[number];
export type TAiAgentPlanStepStatus = (typeof AI_AGENT_PLAN_STEP_STATUSES)[number];
export type TAiAgentPlanReferenceType = (typeof AI_AGENT_PLAN_REFERENCE_TYPES)[number];
export type TAiAgentPlanRiskLevel = (typeof AI_AGENT_PLAN_RISK_LEVELS)[number];
export type TAiAgentTaskClassification = (typeof AI_AGENT_TASK_CLASSIFICATIONS)[number];
export type TAiAgentPermissionScope = (typeof AI_AGENT_PERMISSION_SCOPES)[number];

export interface IAiAgentPlanReference {
  type: TAiAgentPlanReferenceType;
  label: string;
  uri: string;
}

export interface IAiTaskPlanStep {
  id: string;
  index: number;
  title: string;
  goal: string;
  kind: TAiAgentPlanStepKind;
  status: TAiAgentPlanStepStatus;
  expectedOutput: string;
  tools: TAiAgentToolName[];
  references?: IAiAgentPlanReference[];
  isActive?: boolean;
  requiresUserApproval: boolean;
  riskLevel: TAiAgentPlanRiskLevel;
  rollbackStrategy?: string;
}

export interface IAiAgentPlanRequest {
  goal: string;
  context: IAiContextReference[];
}

export interface IAiAgentPlanPayload {
  steps: IAiTaskPlanStep[];
}

export interface IAiAgentClassifyTaskRequest {
  goal: string;
  context: IAiContextReference[];
}

export interface IAiAgentClassifyTaskPayload {
  classification: TAiAgentTaskClassification;
  shouldEnterPlanMode: boolean;
  reason: string;
}

export interface IAiAgentApprovePlanRequest {
  goal: string;
  steps: IAiTaskPlanStep[];
}

export interface IAiAgentApprovePlanPayload {
  approvedAt: string;
  stepCount: number;
}

export interface IAiAgentPermissionState {
  level: TAiAgentPermissionLevel;
  scope: TAiAgentPermissionScope;
  grantedAt: string;
  expiresAt?: string;
  allowedHighRiskTools: TAiAgentToolName[];
}