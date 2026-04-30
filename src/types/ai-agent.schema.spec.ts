import {
  aiAgentApprovePlanRequestSchema,
  aiAgentSetNetworkPermissionRequestSchema,
  aiAgentStepDetailSchema,
  aiAgentTimelineItemSchema,
  aiAgentRunPayloadSchema,
  aiAgentRunPlanRequestSchema,
  aiAgentPermissionStateSchema,
  aiAgentPlanPayloadSchema,
  aiAgentToolLoopChatPayloadSchema,
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

  it('accepts Rust plan payload with nullable optional fields', () => {
    const parsed = aiAgentPlanPayloadSchema.parse({
      steps: [
        {
          ...createStep(0),
          toolInputs: null,
          references: null,
          isActive: null,
          rollbackStrategy: null,
        },
        {
          ...createStep(1),
          toolInputs: {
            webSearch: null,
            webFetch: null,
            proposePatch: null,
            autoApplyPatch: null,
            runCommand: null,
            stageFile: null,
            createCommit: null,
          },
          references: null,
          isActive: null,
          rollbackStrategy: '只读步骤无需回滚',
        },
      ],
    });

    expect(parsed.steps).toHaveLength(2);
    expect(parsed.steps[0]?.toolInputs).toBeUndefined();
    expect(parsed.steps[0]?.references).toBeUndefined();
    expect(parsed.steps[0]?.isActive).toBeUndefined();
    expect(parsed.steps[0]?.rollbackStrategy).toBeUndefined();
    expect(parsed.steps[1]?.toolInputs?.webSearch).toBeUndefined();
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

  it('仅接受受控的网络权限值', () => {
    const parsed = aiAgentSetNetworkPermissionRequestSchema.parse({
      permission: 'allowed-this-run',
    });

    expect(parsed.permission).toBe('allowed-this-run');
    expect(() =>
      aiAgentSetNetworkPermissionRequestSchema.parse({
        permission: 'always',
      }),
    ).toThrow();
  });

  it('校验 run_plan 请求与 run payload', () => {
    const steps = [createStep(0), createStep(1)];
    const request = aiAgentRunPlanRequestSchema.parse({
      goal: '实现 Step Runtime',
      steps,
    });

    expect(request.steps).toHaveLength(2);

    const payload = aiAgentRunPayloadSchema.parse({
      run: {
        id: 'agent-run-1',
        goal: request.goal,
        status: 'running-plan',
        steps,
        currentStepId: null,
        createdAt: '2026-04-29T10:00:00.000Z',
        updatedAt: '2026-04-29T10:00:00.000Z',
        startedAt: '2026-04-29T10:00:00.000Z',
        completedAt: null,
        errorMessage: null,
      },
    });

    expect(payload.run.status).toBe('running-plan');
  });

  it('校验 step detail 仅包含来源摘要和 ref', () => {
    const parsed = aiAgentStepDetailSchema.parse({
      runId: 'run-1',
      stepId: 'step-1',
      updatedAt: '2026-04-29T10:00:00.000Z',
      webSources: [{
        id: 'web-source-1',
        title: 'Tauri Docs',
        url: 'https://tauri.app/start/',
        sourceType: 'docs',
        status: 'fetched',
        queryPreview: 'Tauri docs',
        fetchedAt: '2026-04-29T10:00:00.000Z',
        textRef: 'web-text:abc',
        excerpt: '短摘要',
      }],
      toolResults: [{
        id: 'tool-result-1',
        runId: 'run-1',
        stepId: 'step-1',
        toolName: 'web_fetch',
        status: 'succeeded',
        summary: '读取 1 个网页正文引用',
        startedAt: '2026-04-29T10:00:00.000Z',
        endedAt: '2026-04-29T10:00:01.000Z',
        outputRef: 'web-text:abc',
      }],
    });

    expect(parsed.webSources[0]?.textRef).toBe('web-text:abc');
  });

  it('校验 timeline item 只保存摘要与 ref', () => {
    const parsed = aiAgentTimelineItemSchema.parse({
      id: 'timeline-tool-1',
      runId: 'run-1',
      stepId: 'step-1',
      type: 'tool-result',
      title: 'web_fetch',
      status: 'succeeded',
      createdAt: '2026-04-29T10:00:01.000Z',
      subtitle: '读取 1 个网页正文引用',
      detailRef: 'web-text:abc',
    });

    expect(parsed.detailRef).toBe('web-text:abc');
    expect(() =>
      aiAgentTimelineItemSchema.parse({
        ...parsed,
        status: 'unknown',
      }),
    ).toThrow();
  });

  it('accepts Rust pending-confirmation payload with nullable option fields', () => {
    const parsed = aiAgentToolLoopChatPayloadSchema.parse({
      content: '',
      model: 'deepseek-v4-pro',
      stopReason: 'tool-confirmation-required',
      turns: 4,
      pendingDecisionKey: 'call_00_h3Afrhbr3X1s3Vrp5HMRvNT3',
      pendingConfirmation: {
        id: 'call_00_h3Afrhbr3X1s3Vrp5HMRvNT3',
        runId: 'agent-tool-loop-1777525705908-6obhnx',
        stepId: 'tool-call-step:propose_patch:call_00_h3Afrhbr3X1s3Vrp5HMRvNT3',
        toolName: 'propose_patch',
        question: '允许 Agent 使用 propose_patch 吗？',
        summary: 'Tool propose_patch requires inline user confirmation.',
        riskLevel: 'medium',
        impact: null,
        reversible: true,
        createdAt: '2026-04-30T12:00:00.000Z',
        options: [{
          id: 'allow-once',
          label: '允许本次',
          tone: null,
        }],
      },
      toolResults: [{
        id: 'agent-tool-loop-1777525705908-6obhnx:tool-call-step:propose_patch:call_00_h3Afrhbr3X1s3Vrp5HMRvNT3:propose_patch',
        runId: 'agent-tool-loop-1777525705908-6obhnx',
        stepId: 'tool-call-step:propose_patch:call_00_h3Afrhbr3X1s3Vrp5HMRvNT3',
        toolName: 'propose_patch',
        status: 'failed',
        requiresUserConfirmation: true,
        summary: 'Tool propose_patch requires inline user confirmation.',
        outputRef: null,
        startedAt: '2026-04-30T12:00:00.000Z',
        endedAt: '2026-04-30T12:00:01.000Z',
      }],
    });

    expect(parsed.pendingConfirmation?.impact).toBeUndefined();
    expect(parsed.pendingConfirmation?.options[0]?.tone).toBeUndefined();
    expect(parsed.toolResults[0]?.outputRef).toBeUndefined();
  });
});
