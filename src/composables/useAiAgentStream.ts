import { getCurrentScope, onScopeDispose, readonly, ref } from 'vue';

import { aiService } from '@/services/modules/ai';
import { useAiAgentStore } from '@/store/aiAgent';

import type { TAiAgentStreamEvent } from '@/types/ai';

export const useAiAgentStream = () => {
  const store = useAiAgentStore();
  const isListening = ref(false);
  let unlistenAgentStream: (() => void) | null = null;

  const handleEvent = (event: TAiAgentStreamEvent): void => {
    switch (event.event) {
      case 'agent.run':
        store.upsertRun(event.run);
        break;
      case 'agent.step':
        store.upsertRunStep(event.runId, event.step);
        break;
      case 'tool.activity':
        store.appendToolActivity(event.runId, event.activity);
        if (event.activity.state === 'succeeded' || event.activity.state === 'failed') {
          store.appendStepToolResults(event.runId, event.activity.stepId, [{
            id: event.activity.id,
            runId: event.runId,
            stepId: event.activity.stepId,
            toolName: event.activity.toolName,
            status: event.activity.state,
            summary: event.activity.label,
            startedAt: event.activity.startedAt,
            endedAt: new Date().toISOString(),
          }]);
        }
        break;
      case 'tool.confirmation':
        store.setPendingToolConfirmation(event.confirmation);
        store.appendToolActivity(event.runId, {
          id: `${event.confirmation.id}:waiting`,
          stepId: event.confirmation.stepId,
          toolName: event.confirmation.toolName,
          state: 'waiting-confirmation',
          label: event.confirmation.question,
          targetPreview: event.confirmation.summary,
          startedAt: event.confirmation.createdAt,
        });
        break;
      case 'patch.summary':
        store.appendPatchSummary(event.summary);
        break;
      case 'stream.error':
        store.errorMessage = event.error.message;
        break;
      case 'stream.end':
        store.clearPendingToolConfirmation();
        break;
      case 'chat.delta':
        break;
    }
  };

  const stop = (): void => {
    unlistenAgentStream?.();
    unlistenAgentStream = null;
    isListening.value = false;
  };

  const start = async (): Promise<void> => {
    if (isListening.value) {
      return;
    }

    const nextUnlisten = await aiService.onAgentStream(handleEvent);

    unlistenAgentStream = nextUnlisten;
    isListening.value = true;
  };

  if (getCurrentScope()) {
    onScopeDispose(stop);
  }

  return {
    isListening: readonly(isListening),
    handleEvent,
    start,
    stop,
  };
};
