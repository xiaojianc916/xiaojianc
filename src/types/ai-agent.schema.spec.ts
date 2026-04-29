import {
  aiAgentApprovePlanRequestSchema,
  aiAgentPermissionStateSchema,
  aiAgentPlanPayloadSchema,
} from '@/types/ai-agent.schema';
import { describe, expect, it } from 'vitest';

const createStep = (index: number) => ({
  id: `step-${index}`,
  index,
  title: `步骤 ${index + 1}`,
  goal: `完成步骤 ${index + 1}`,
  kind: index === 0 ? 'inspect' : 'verify',
  status: 'pending',
  expectedOutput: `产物 ${index + 1}`,
  tools: index === 0 ? ['search_text'] : ['run_test'],
  requiresUserApproval: index > 0,
  riskLevel: index === 0 ? 'low' : 'medium',
});

describe('AI agent schema', () => {
  it('接受 2~6 步的计划', () => {
    const parsed = aiAgentPlanPayloadSchema.parse({
      steps: [createStep(0), createStep(1)],
    });

    expect(parsed.steps).toHaveLength(2);
    expect(parsed.steps[0]?.tools).toEqual(['search_text']);
  });

  it('拒绝少于 2 步的计划', () => {
    expect(() =>
      aiAgentPlanPayloadSchema.parse({
        steps: [createStep(0)],
      }),
    ).toThrow();
  });

  it('拒绝未知工具名', () => {
    expect(() =>
      aiAgentApprovePlanRequestSchema.parse({
        goal: '补齐 Plan Mode 契约',
        steps: [{
          ...createStep(0),
          tools: ['unknown_tool'],
        }],
      }),
    ).toThrow();
  });

  it('校验权限状态仅接受受控高风险工具', () => {
    const parsed = aiAgentPermissionStateSchema.parse({
      level: 'elevated',
      scope: 'run',
      grantedAt: '2026-04-29T10:00:00.000Z',
      allowedHighRiskTools: ['run_command', 'create_commit'],
    });

    expect(parsed.allowedHighRiskTools).toEqual(['run_command', 'create_commit']);
  });
});