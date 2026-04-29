<script setup lang="ts">
import AppDropdownMenu from '@/components/common/AppDropdownMenu.vue';
import { useAiAutoApply } from '@/composables/useAiAutoApply';
import type { TAiEditAuthLevel } from '@/types/ai-edit';
import { computed, onMounted } from 'vue';

const autoApply = useAiAutoApply();

const toneClass = computed(() => {
    switch (autoApply.authLevel.value) {
        case 'per_task':
            return 'is-task';
        case 'session':
            return 'is-session';
        default:
            return 'is-manual';
    }
});

const modeLabel = computed(() => {
    switch (autoApply.authLevel.value) {
        case 'per_task':
            return 'Auto-apply: per-task';
        case 'session':
            return 'Auto-apply: session';
        default:
            return 'Auto-apply: manual';
    }
});

const menuItems = computed(() => [
    {
        key: 'manual',
        label: '手动审批',
        description: '每次 patch 仍需用户确认',
        selected: autoApply.authLevel.value === 'manual',
    },
    {
        key: 'per_task',
        label: '任务内自动应用',
        description: '本轮 Agent Task 内自动写盘',
        selected: autoApply.authLevel.value === 'per_task',
    },
    {
        key: 'session',
        label: '会话内自动应用',
        description: '当前进程会话持续自动写盘',
        selected: autoApply.authLevel.value === 'session',
    },
]);

const setAuthLevel = async (level: TAiEditAuthLevel): Promise<void> => {
    await autoApply.setAuthLevel({ level });
};

const handleSelect = (key: string): void => {
    if (key === 'manual' || key === 'per_task' || key === 'session') {
        void setAuthLevel(key);
    }
};

onMounted(() => {
    autoApply.loadAuthState().catch(() => undefined);
);
</script>

<template>
    <AppDropdownMenu :items="menuItems" align="right" :min-width="248" @select="handleSelect">
        <template #trigger>
            <button type="button" class="ai-auto-apply-badge" :class="toneClass" :aria-label="modeLabel">
                <span class="ai-auto-apply-dot" aria-hidden="true"></span>
                <span class="ai-auto-apply-label">{{ modeLabel }}</span>
            </button>
        </template>
    </AppDropdownMenu>
</template>

<style scoped>
.ai-auto-apply-badge {
    display: inline-flex;
    height: 22px;
    align-items: center;
    gap: 6px;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--shell-divider) 72%, transparent);
    background: color-mix(in srgb, var(--shell-elevated) 78%, transparent);
    padding: 0 10px;
    color: var(--text-secondary);
    transition: background-color 160ms ease, border-color 160ms ease, color 160ms ease;
}

.ai-auto-apply-badge:hover {
    background: color-mix(in srgb, var(--shell-elevated) 88%, transparent);
}

.ai-auto-apply-dot {
    width: 7px;
    height: 7px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--text-tertiary) 88%, transparent);
}

.ai-auto-apply-label {
    white-space: nowrap;
    font-size: 11px;
    font-weight: 600;
}

.ai-auto-apply-badge.is-manual {
    border-color: color-mix(in srgb, var(--shell-divider) 82%, transparent);
}

.ai-auto-apply-badge.is-manual .ai-auto-apply-dot {
    background: color-mix(in srgb, #8da0bf 72%, transparent);
}

.ai-auto-apply-badge.is-task {
    border-color: color-mix(in srgb, #56a8ff 36%, var(--shell-divider));
    background: color-mix(in srgb, #56a8ff 12%, var(--shell-elevated));
    color: #dcecff;
}

.ai-auto-apply-badge.is-task .ai-auto-apply-dot {
    background: #56a8ff;
}

.ai-auto-apply-badge.is-session {
    border-color: color-mix(in srgb, #f59e0b 42%, var(--shell-divider));
    background: color-mix(in srgb, #f59e0b 14%, var(--shell-elevated));
    color: #fff1cf;
}

.ai-auto-apply-badge.is-session .ai-auto-apply-dot {
    background: #f59e0b;
}
</style>