<template>
  <AppShellLayout>
    <template #sidebar>
      <AppSidebar
        :document="editorStore.document"
        :logs-count="editorStore.runLogs.length"
        :has-terminal-output="editorStore.terminalOutput.trim().length > 0"
        :is-running="editorStore.isRunning"
      />
    </template>

    <template #header>
      <WorkbenchHeader
        :title="editorStore.documentTitle"
        :is-dirty="editorStore.document.isDirty"
        :encoding="editorStore.document.encoding"
        :executor="editorStore.selectedExecutor"
        :has-environment="editorStore.environment.hasAny"
        :is-desktop-runtime="isDesktopRuntime"
        :is-running="editorStore.isRunning"
        @new="createNewDocument"
        @open="openDocument"
        @save="saveDocument"
        @save-as="saveDocumentAs"
        @run="runScript"
        @chmod="chmodScript"
      />
    </template>

    <div class="h-full p-5">
      <div class="linear-card h-full overflow-hidden">
        <SmartScriptEditor
          ref="editorRef"
          :model-value="editorStore.document.content"
          :theme="appStore.theme"
          @update:model-value="updateContent"
        />
      </div>
    </div>

    <template #terminal>
      <div class="h-full p-5 pt-4">
        <div class="linear-card h-full overflow-hidden">
          <RunPanel
            :terminal-output="editorStore.terminalOutput"
            :run-logs="editorStore.runLogs"
            :last-run-result="editorStore.lastRunResult"
            :is-running="editorStore.isRunning"
          />
        </div>
      </div>
    </template>

    <template #inspector>
      <InspectorPanel
        :encoding="editorStore.document.encoding"
        :executor="editorStore.selectedExecutor"
        :environment="editorStore.environment"
        :theme="appStore.theme"
        :is-desktop-runtime="isDesktopRuntime"
        :command-templates="commandTemplates"
        :comment-templates="commentTemplates"
        @change-encoding="updateEncoding"
        @change-executor="updateExecutor"
        @toggle-theme="toggleTheme"
        @chmod="chmodScript"
        @insert-template="handleInsertTemplate"
        @insert-comment="handleInsertTemplate"
      />
    </template>
  </AppShellLayout>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import SmartScriptEditor from '@/components/editor/SmartScriptEditor.vue';
import AppSidebar from '@/components/workbench/AppSidebar.vue';
import InspectorPanel from '@/components/workbench/InspectorPanel.vue';
import RunPanel from '@/components/workbench/RunPanel.vue';
import WorkbenchHeader from '@/components/workbench/WorkbenchHeader.vue';
import { useWorkbench } from '@/composables/useWorkbench';
import AppShellLayout from '@/layouts/AppShellLayout.vue';
import type { ICommandTemplate } from '@/types/editor';

type TEditorExpose = {
  focusEditor: () => void;
  insertSnippet: (snippet: string) => void;
};

const editorRef = ref<TEditorExpose | null>(null);

  const {
    appStore,
    editorStore,
    isDesktopRuntime,
    commandTemplates,
    commentTemplates,
    initialize,
    createNewDocument,
  openDocument,
  saveDocument,
  saveDocumentAs,
  runScript,
  chmodScript,
  updateContent,
  updateEncoding,
  updateExecutor,
  toggleTheme,
  notifyTemplateInserted,
} = useWorkbench();

const handleInsertTemplate = (template: ICommandTemplate): void => {
  editorRef.value?.insertSnippet(template.snippet);
  editorRef.value?.focusEditor();
  notifyTemplateInserted(template);
};

onMounted(() => {
  initialize();
});
</script>
