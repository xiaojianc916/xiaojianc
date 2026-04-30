<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
    isPlanning: boolean;
    isApproving: boolean;
    canApprove: boolean;
    approvedAt: string | null;
}>();

const emit = defineEmits<{
    regenerate: [];
    reset: [];
    approve: [];
}>();

const approvalLabel = computed(() => {
    if (props.approvedAt) {
        return props.canApprove ? '启动运行' : '已批准';
    }

    return props.isApproving ? '批准中...' : '批准并启动';
});
</script>

<template>
    <footer class="ai-plan-approval-bar">
        <button
            type="button"
            class="ai-plan-button"
            :disabled="isPlanning || isApproving"
            @click="emit('regenerate')"
        >
            重生成
        </button>
        <button
            type="button"
            class="ai-plan-button"
            :disabled="isPlanning || isApproving"
            @click="emit('reset')"
        >
            清空计划
        </button>
        <button
            type="button"
            class="ai-plan-button is-primary"
            :disabled="!canApprove || isPlanning || isApproving"
            @click="emit('approve')"
        >
            {{ approvalLabel }}
        </button>
    </footer>
</template>

<style scoped>
.ai-plan-approval-bar {
    display: flex;
    align-items: center;
    gap: 8px;
}

.ai-plan-button {
    height: 28px;
    border: 1px solid color-mix(in srgb, var(--shell-divider) 88%, transparent);
    border-radius: 6px;
    color: var(--text-secondary);
    font-size: 12px;
    padding: 0 10px;
}

.ai-plan-button.is-primary {
    margin-left: auto;
    border-color: color-mix(in srgb, var(--accent-strong) 35%, var(--shell-divider));
    background: color-mix(in srgb, var(--accent-strong) 16%, transparent);
    color: var(--text-primary);
}

.ai-plan-button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
}
</style>
