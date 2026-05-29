<script setup lang="ts">
import { CopilotChatSuggestionView, useFrontendTool } from '@copilotkit/vue';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { z } from 'zod';
import Checkpoint from '@/components/ai-elements/checkpoint/Checkpoint.vue';
import CheckpointIcon from '@/components/ai-elements/checkpoint/CheckpointIcon.vue';
import CheckpointTrigger from '@/components/ai-elements/checkpoint/CheckpointTrigger.vue';
import { Loader } from '@/components/ai-elements/loader';
import AiChatThread from '@/components/business/ai/chat/AiChatThread.vue';
import AiPromptInput from '@/components/business/ai/chat/AiPromptInput.vue';
import AiPatchPreview from '@/components/business/ai/edit/AiPatchPreview.vue';
import AiPlanConfirmationMessage from '@/components/business/ai/plan/AiPlanConfirmationMessage.vue';
import AiPlanModePanel from '@/components/business/ai/plan/AiPlanModePanel.vue';
import AiProviderIcon from '@/components/business/ai/provider/AiProviderIcon.vue';
import AiProviderSettings from '@/components/business/ai/provider/AiProviderSettings.vue';
import {
  buildAgentFlowToolCalls,
  buildPlanRunF