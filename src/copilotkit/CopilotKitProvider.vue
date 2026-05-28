<template>
  <CopilotKit :self-managed-agents="(agents as unknown as Record<string, AbstractAgent>)" :show-dev-console="showDevConsole">
    <slot />
  </CopilotKit>
</template>

<script setup lang="ts">
import type { AbstractAgent } from '@ag-ui/client';
import { CopilotKit } from '@copilotkit/vue';
import { onBeforeUnmount, onMounted, shallowRef } from 'vue';
import { SidecarAgent } from '@/copilotkit/sidecar-agent';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface Props {
  /** Force dev console visibility. Defaults to import.meta.env.DEV. */
  showDevConsole?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  showDevConsole: import.meta.env.DEV,
});

// ---------------------------------------------------------------------------
// Agent registry
// ---------------------------------------------------------------------------
const agents = shallowRef<Record<string, SidecarAgent>>({});

const buildAgents = (): Record<string, SidecarAgent> => {
  try {
    return {
      default: new SidecarAgent({
        agentId: 'default',
        description: 'Mastra-powered coding agent',
      }),
    };
  } catch (err) {
    console.error('[CopilotKitProvider] failed to initialise default agent:', err);
    return {};
  }
};

// In SSR, defer instantiation to onMounted; in CSR-only apps this fires
// synchronously after mount so the first render still gets agents on time
// (CopilotKit subscribes reactively to `agents`).
if (typeof window !== 'undefined') {
  agents.value = buildAgents();
} else {
  onMounted(() => {
    agents.value = buildAgents();
  });
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------
onBeforeUnmount(() => {
  for (const agent of Object.values(agents.value)) {
    try {
      agent.abortRun();
    } catch (err) {
      console.error(`[CopilotKitProvider] abortRun failed:`, err);
    }
  }
});

// ---------------------------------------------------------------------------
// Expose for tests / parent components
// ---------------------------------------------------------------------------
defineExpose({
  agents,
});
</script>