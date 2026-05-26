import type { IAiAgentRun, IAiTaskPlanStep, IAiToolConfirmationRequest } from '@/types/ai/agent';
import type { IAiAgentPatchSummary } from '@/types/ai/patch';
import type { TAiAgentToolName } from '@/types/ai/tools';

export const AI_TOOL_ACTIVITY_STATES = [
  'starting',
  'running',
  'waiting-confirmation',
  'succeeded',
  'failed',
  'cancelled',
] as const;

export const AI_AGENT_STREAM_END_REASONS = [
  'completed',
  'cancelled',
  'failed',
  'max_turns',
] as const;

export type TAiToolActivityState = (typeof AI_TOOL_ACTIVITY_STATES)[number];

export type TAiAgentStreamEndReason = (typeof AI_AGENT_STREAM_END_REASONS)[number];

export interface IAiToolActivityInline {
  id: string;
  stepId: string;
  toolName: TAiAgentToolName;
  state: TAiToolActivityState;
  label: string;
  targetPreview?: string;
  startedAt: string;
  elapsedMs?: number;
}

export interface IAiAgentStreamErrorPayload {
  code: string;
  message: string;
  scope: string;
  traceId: string;
  timestamp: string;
}

export type TAiAgentStreamEvent =
  | {
      event: 'chat.delta';
      seq: number;
      runId: string;
      messageId: string;
      delta: string;
    }
  | {
      event: 'agent.run';
      seq: number;
      runId: string;
      run: IAiAgentRun;
    }
  | {
      event: 'agent.step';
      seq: number;
      runId: string;
      step: IAiTaskPlanStep;
    }
  | {
      event: 'tool.activity';
      seq: number;
      runId: string;
      activity: IAiToolActivityInline;
    }
  | {
      event: 'tool.confirmation';
      seq: number;
      runId: string;
      confirmation: IAiToolConfirmationRequest;
    }
  | {
      event: 'patch.summary';
      seq: number;
      runId: string;
      summary: IAiAgentPatchSummary;
    }
  | {
      event: 'stream.error';
      seq: number;
      runId: string;
      error: IAiAgentStreamErrorPayload;
    }
  | {
      event: 'stream.end';
      seq: number;
      runId: string;
      reason: TAiAgentStreamEndReason;
    };
