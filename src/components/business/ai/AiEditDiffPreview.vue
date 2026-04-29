<script setup lang="ts">
import type { IAiEditGetDiffPayload } from '@/types/ai-edit';

withDefaults(
    defineProps<{
        diff: IAiEditGetDiffPayload | null;
        isLoading?: boolean;
        isReverting?: boolean;
        activeHunkIndex?: number | null;
        canRevertFile?: boolean;
        canRevertHunk?: boolean;
    }>(),
    {
        isLoading: false,
        isReverting: false,
        activeHunkIndex: null,
        canRevertFile: false,
        canRevertHunk: false,
    },
);

const emit = defineEmits<{
    revertFile: [];
    revertHunk: [hunkIndex: number];
}>();

const countPrefixedLines = (lines: string[], prefix: '+' | '-'): number =>
    lines.filter((line) => line.startsWith(prefix)).length;

const lineKind = (line: string): 'add' | 'del' | 'context' => {
    if (line.startsWith('+')) {
        return 'add';
    }
    if (line.startsWith('-')) {
        return 'del';
    }
    return 'context';
};
</script>

<template>
    <section class="ai-edit-diff-preview" aria-label="AED Diff Preview">
        <div class="ai-edit-diff-preview__header">
            <div>
                <strong>Diff Preview</strong>
                <p v-if="diff">{{ diff.path }} · +{{ diff.additions }} / -{{ diff.deletions }}</p>
                <p v-else-if="isLoading">正在读取 AED diff…</p>
                <p v-else>当前条目暂无可预览的 diff。</p>
            </div>
            <button
type="button" class="ai-edit-diff-preview__file-button"
                :disabled="!diff || !canRevertFile || isReverting" @click="emit('revertFile')">
                {{ isReverting ? '回滚中…' : '回滚整个文件' }}
            </button>
        </div>

        <div v-if="isLoading" class="ai-edit-diff-preview__empty">
            <strong>正在生成 diff</strong>
            <p>会按当前任务最近一条有效 AED 编辑生成文件级预览。</p>
        </div>

        <div v-else-if="diff && diff.hunks.length > 0" class="ai-edit-diff-preview__hunks">
            <article
v-for="hunk in diff.hunks" :key="`${diff.operationId}:${hunk.hunkIndex}`"
                class="ai-edit-diff-preview__hunk">
                <div class="ai-edit-diff-preview__hunk-meta">
                    <div>
                        <strong>Hunk #{{ hunk.hunkIndex + 1 }}</strong>
                        <p>-{{ countPrefixedLines(hunk.lines, '-') }} / +{{ countPrefixedLines(hunk.lines, '+') }}</p>
                    </div>
                    <button
type="button" class="ai-edit-diff-preview__hunk-button"
                        :disabled="!canRevertHunk || isReverting || diff.kind !== 'modify'"
                        @click="emit('revertHunk', hunk.hunkIndex)">
                        {{ activeHunkIndex === hunk.hunkIndex && isReverting ? '回滚中…' : '↶ Revert hunk' }}
                    </button>
                </div>
                <pre class="ai-edit-diff-preview__code"><code><span
v-for="(line, lineIndex) in hunk.lines"
                            :key="`${diff.operationId}:${hunk.hunkIndex}:${lineIndex}`" class="ai-edit-diff-preview__line"
                            :class="`is-${lineKind(line)}`">{{ line || ' ' }}
</span></code></pre>
            </article>
        </div>

        <div v-else class="ai-edit-diff-preview__empty">
            <strong>当前文件没有剩余 diff</strong>
            <p>这通常表示该文件已经回到最近一条 AED 编辑之前的状态。</p>
        </div>
    </section>
</template>

<style scoped>
.ai-edit-diff-preview {
    display: grid;
    gap: 10px;
    border-radius: 14px;
    border: 1px solid color-mix(in srgb, var(--shell-divider) 80%, transparent);
    background: color-mix(in srgb, var(--shell-elevated) 78%, transparent);
    padding: 12px;
}

.ai-edit-diff-preview__header,
.ai-edit-diff-preview__hunk-meta {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
}

.ai-edit-diff-preview__header strong,
.ai-edit-diff-preview__hunk-meta strong {
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 700;
}

.ai-edit-diff-preview__header p,
.ai-edit-diff-preview__hunk-meta p,
.ai-edit-diff-preview__empty p {
    margin-top: 4px;
    color: var(--text-secondary);
    font-size: 11px;
    line-height: 1.5;
}

.ai-edit-diff-preview__file-button,
.ai-edit-diff-preview__hunk-button {
    border-radius: 10px;
    border: 1px solid color-mix(in srgb, var(--shell-divider) 84%, transparent);
    background: transparent;
    padding: 6px 10px;
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 600;
}

.ai-edit-diff-preview__file-button:disabled,
.ai-edit-diff-preview__hunk-button:disabled {
    cursor: not-allowed;
    opacity: 0.42;
}

.ai-edit-diff-preview__hunks {
    display: grid;
    gap: 10px;
}

.ai-edit-diff-preview__hunk {
    display: grid;
    gap: 8px;
}

.ai-edit-diff-preview__code {
    overflow: auto;
    margin: 0;
    border-radius: 12px;
    background: color-mix(in srgb, var(--panel-bg) 84%, transparent);
    padding: 10px;
}

.ai-edit-diff-preview__line {
    display: block;
    white-space: pre;
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.6;
}

.ai-edit-diff-preview__line.is-add {
    background: color-mix(in srgb, var(--success) 12%, transparent);
}

.ai-edit-diff-preview__line.is-del {
    background: color-mix(in srgb, var(--danger) 12%, transparent);
}

.ai-edit-diff-preview__empty {
    display: grid;
    gap: 4px;
    border-radius: 12px;
    border: 1px dashed color-mix(in srgb, var(--shell-divider) 78%, transparent);
    padding: 12px;
}

.ai-edit-diff-preview__empty strong {
    color: var(--text-primary);
    font-size: 12px;
}
</style>