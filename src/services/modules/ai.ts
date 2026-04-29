import { tauriService } from '@/services/tauri';
import type {
  IAiAgentApprovePlanPayload,
  IAiAgentApprovePlanRequest,
  IAiAgentClassifyTaskPayload,
  IAiAgentClassifyTaskRequest,
  IAiAgentPlanPayload,
  IAiAgentPlanRequest,
  IAiApplyPatchPayload,
  IAiApplyPatchRequest,
  IAiBuildIndexPayload,
  IAiBuildIndexRequest,
  IAiChatPayload,
  IAiChatRequest,
  IAiChatStreamEventPayload,
  IAiChatStreamPayload,
  IAiCodeActionRequest,
  IAiCodeActionResult,
  IAiConfigPayload,
  IAiInlineCompletionRequest,
  IAiInlineCompletionResult,
  IAiProposePatchPayload,
  IAiProposePatchRequest,
  IAiProviderConnectionPayload,
  IAiProviderConnectionRequest,
  IAiProviderTestPayload,
  IAiQueryIndexPayload,
  IAiQueryIndexRequest,
  IAiSaveConfigRequest,
  IAiSaveCredentialsRequest,
  IAiToolDefinitionPayload,
} from '@/types/ai';

export const aiService = {
  getConfig(): Promise<IAiConfigPayload> {
    return tauriService.aiGetConfig();
  },
  saveConfig(payload: IAiSaveConfigRequest): Promise<IAiConfigPayload> {
    return tauriService.aiSaveConfig(payload);
  },
  saveCredentials(payload: IAiSaveCredentialsRequest): Promise<IAiConfigPayload> {
    return tauriService.aiSaveCredentials(payload);
  },
  clearCredentials(): Promise<void> {
    return tauriService.aiClearCredentials();
  },
  testProvider(): Promise<IAiProviderTestPayload> {
    return tauriService.aiTestProvider();
  },
  testProviderConfig(payload: IAiProviderConnectionRequest): Promise<IAiProviderTestPayload> {
    return tauriService.aiTestProviderConfig(payload);
  },
  connectProvider(payload: IAiProviderConnectionRequest): Promise<IAiProviderConnectionPayload> {
    return tauriService.aiConnectProvider(payload);
  },
  chat(payload: IAiChatRequest, options: { signal?: AbortSignal } = {}): Promise<IAiChatPayload> {
    return tauriService.aiChat(payload, options);
  },
  chatStream(payload: IAiChatRequest): Promise<IAiChatStreamPayload> {
    return tauriService.aiChatStream(payload);
  },
  cancel(payload: { streamId: string }): Promise<void> {
    return tauriService.aiCancel(payload);
  },
  onChatStream(handler: (payload: IAiChatStreamEventPayload) => void): Promise<() => void> {
    return tauriService.onAiChatStream(handler);
  },
  inlineComplete(payload: IAiInlineCompletionRequest): Promise<IAiInlineCompletionResult> {
    return tauriService.aiInlineComplete(payload);
  },
  codeAction(payload: IAiCodeActionRequest): Promise<IAiCodeActionResult> {
    return tauriService.aiCodeAction(payload);
  },
  classifyTask(payload: IAiAgentClassifyTaskRequest): Promise<IAiAgentClassifyTaskPayload> {
    return tauriService.aiAgentClassifyTask(payload);
  },
  planTask(payload: IAiAgentPlanRequest): Promise<IAiAgentPlanPayload> {
    return tauriService.aiPlanTask(payload);
  },
  approvePlan(payload: IAiAgentApprovePlanRequest): Promise<IAiAgentApprovePlanPayload> {
    return tauriService.aiAgentApprovePlan(payload);
  },
  buildIndex(payload: IAiBuildIndexRequest): Promise<IAiBuildIndexPayload> {
    return tauriService.aiBuildIndex(payload);
  },
  queryIndex(payload: IAiQueryIndexRequest): Promise<IAiQueryIndexPayload> {
    return tauriService.aiQueryIndex(payload);
  },
  proposePatch(payload: IAiProposePatchRequest): Promise<IAiProposePatchPayload> {
    return tauriService.aiProposePatch(payload);
  },
  applyPatch(payload: IAiApplyPatchRequest): Promise<IAiApplyPatchPayload> {
    return tauriService.aiApplyPatch(payload);
  },
  listTools(): Promise<IAiToolDefinitionPayload[]> {
    return tauriService.aiListTools();
  },
};
