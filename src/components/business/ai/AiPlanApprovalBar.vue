<script setup lang="ts">
defineProps<{
    isPlanning: boolean;
    isApproving: boolean;
    canApprove: boolean;
}>();

const emit = defineEmits<{
    regenerate: [];
    reset: [];
    approve: [];
}>();
</script>

<template>
    <footer class="ai-plan-approval-bar">
        <button type="button" class="ai-plan-button" :disabled="isPlanning || isApproving" @click="emit('regenerate')">
            重生成
        </button>
        <button type="button" class="ai-plan-button" :disabled="isPlanning || isApproving" @click="emit('reset')">
            清空计划
        </button>
        <button type="button" class="ai-plan-button is-primary" :disabled="!canApprove || isPlanning || isApproving"
            @click="emit('approve')">
            {{ isApproving ? '批准中...' : '批准计划' }}
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