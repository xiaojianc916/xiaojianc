import type { TAgentUiEvent } from '@/types/agent-sidecar';
import type {
    IActivityNote,
    IAiNarratorChangedFile,
    IAiNarratorFacts,
    IAiNarratorReadFile,
    IAiNarratorResponse,
    IAiNarratorSearchSummary,
    IAiToolCall,
    TActivityNoteTone,
    TActivityNoteTrigger,
} from '@/types/ai';
import { buildActivityFeedBlocks } from '@/utils/agent-activity-feed';
import { getActionKind } from '@/utils/agent-activity-inline-catalog';
import { normalizeText, parseTarget } from '@/utils/agent-activity-inline-formatters';

interface IActivityNarrationCandidate {
    trigger: TActivityNoteTrigger;
    facts: IAiNarratorFacts;
    relatedActionIds: string[];
    hasError: boolean;
}

interface IShouldNarrateParams {
    trigger: TActivityNoteTrigger;
    hasImportantFact: boolean;
    lastNarrationAt: number;
    narrationCount: number;
    facts: IAiNarratorFacts;
    hasError?: boolean;
    now?: number;
}

const NARRATION_INTERVAL_MS = 8_000;
const NARRATION_LIMIT = 8;

const MAX_RECENT_ACTIONS = 8;
const MAX_CHANGED_FILES = 6;
const MAX_READ_FILES = 6;
const MAX_PREVIOUS_NARRATIONS = 4;

const RESULT_COUNT_PATTERNS: readonly RegExp[] = [
    /(\d+)\s*个(?:结果|命中|文件|组件|变更|错误)/iu,
    /(?:结果|命中|文件|组件|变更|错误|results?|matches?|files?|components?|changes?|errors?)\s*[:：=]?\s*(\d+)/iu,
    /(\d+)\s*(?:results?|matches?|files?|components?|changes?|errors?)/iu,
];

const DIFF_PLUS_MINUS_PATTERN = /\+(\d+)\s*(?:\/|,|;|\s)?\s*[-−]\s*(\d+)/u;

const DIFF_ADDITION_PATTERNS: readonly RegExp[] = [
    /(?:新增|增加|adds?|added|additions?)\s*[:：=]?\s*(\d+)/iu,
    /(\d+)\s*(?:新增|增加|adds?|added|additions?)/iu,
];

const DIFF_DELETION_PATTERNS: readonly RegExp[] = [
    /(?:删除|移除|removes?|removed|deleted|deletions?)\s*[:：=]?\s*(\d+)/iu,
    /(\d+)\s*(?:删除|移除|removes?|removed|deleted|deletions?)/iu,
];

const MUTATION_ACTION_KINDS = new Set<string>(['patch', 'applyPatch']);
const VERIFICATION_ACTION_KINDS = new Set<string>(['execute', 'verify']);
const READ_ACTION_KINDS = new Set<string>(['read']);
const SEARCH_ACTION_KINDS = new Set<string>(['fileSearch', 'symbolSearch', 'web', 'webFetch']);

const TIME_SENSITIVE_GOAL_PATTERN = /(最新|今天|最近|日志|时间|日期|时区|当前)/u;
const VERIFICATION_COMMAND_PATTERN = /(test|vitest|jest|lint|eslint|typecheck|vue-tsc|tsc|build|cargo\s+check|cargo\s+test|pytest|playwright|验证|检查|构建)/iu;
const GIT_STATE_SIGNAL_PATTERN = /(\d+\s*个(?:变更|文件)|dirty|脏工作区|冲突|ahead|behind|unstaged|staged)/iu;

const TOOL_TO_NARRATION_TRIGGER: Readonly<Record<string, TActivityNoteTrigger | null>> = {
    search_files: 'search_done',
    search_text: 'search_done',
    search_symbols: 'search_done',
    search_project_files: 'search_done',
    search_project_symbols: 'search_done',

    directory_tree: 'context_checked',
    list_directory: 'context_checked',
    list_directory_with_sizes: 'context_checked',
    list_project_files: 'context_checked',
    list_allowed_directories: 'context_checked',
    get_project_tree: 'context_checked',
    get_file_info: 'context_checked',

    read_text_file: null,
    read_media_file: null,
    read_current_file: null,
    read_selected_text: null,
    read_file: null,
    read_project_file: null,
    read_multiple_files: 'files_read',
    open_nodes: 'files_read',

    web_search: 'web_search_done',
    web_fetch: 'web_search_done',
    tavily_search: 'web_search_done',
    tavily_extract: 'web_search_done',
    tavily_crawl: 'web_search_done',
    tavily_map: 'web_search_done',
    tavily_research: 'web_search_done',

    get_current_time: 'time_checked',
    convert_time: 'time_checked',

    edit_file: 'edit_done',
    write_file: 'edit_done',
    move_file: 'edit_done',
    auto_apply_patch: 'edit_done',
    create_directory: null,

    git_status: 'git_checked',
    git_branch: 'git_checked',
    git_log: 'git_checked',
    git_show: 'git_checked',

    git_diff: 'git_diff_ready',
    git_diff_unstaged: 'git_diff_ready',
    git_diff_staged: 'git_diff_ready',
    get_git_diff: 'git_diff_ready',

    git_add: 'git_done',
    git_commit: 'git_done',
    git_create_branch: 'git_done',
    git_checkout: 'git_done',
    git_reset: 'git_done',
    git_init: 'git_done',

    sequentialthinking: 'plan_ready',
};

export const DEFAULT_NARRATOR_TRIGGERS = new Set<TActivityNoteTrigger>([
    'run_started',
    'plan_ready',
    'plan_approved',
    'context_checked',
    'search_done',
    'files_read',
    'file_batch_read',
    'web_search_done',
    'edit_done',
    'edit_batch_done',
    'patch_failed',
    'verification_started',
    'verification_failed',
    'test_failed',
    'verification_done',
    'git_diff_ready',
    'git_commit_ready',
    'git_done',
    'final_summary',
]);

const LEGACY_TRIGGER_ALIASES: Readonly<Record<string, TActivityNoteTrigger>> = {
    file_batch_read: 'files_read',
    edit_batch_done: 'edit_done',
    test_failed: 'verification_failed',
};

const normalizeNarrationText = (value: string | null | undefined): string =>
    normalizeText(value ?? '').replace(/\s+/gu, ' ').trim();

const toNonNegativeInteger = (value: string | undefined): number | undefined => {
    if (!value) {
        return undefined;
    }

    const parsed = Number.parseInt(value, 10);

    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

const matchFirstInteger = (text: string, patterns: readonly RegExp[]): number | undefined => {
    for (const pattern of patterns) {
        const match = text.match(pattern);
        const parsed = toNonNegativeInteger(match?.[1]);

        if (parsed !== undefined) {
            return parsed;
        }
    }

    return undefined;
};

const uniqueStrings = (values: readonly string[]): string[] => {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const value of values) {
        const normalized = normalizeNarrationText(value);

        if (!normalized || seen.has(normalized)) {
            continue;
        }

        seen.add(normalized);
        result.push(normalized);
    }

    return result;
};

const uniqueByKey = <T>(
    values: readonly T[],
    getKey: (value: T) => string,
): T[] => {
    const seen = new Set<string>();
    const result: T[] = [];

    for (const value of values) {
        const key = normalizeNarrationText(getKey(value));

        if (!key || seen.has(key)) {
            continue;
        }

        seen.add(key);
        result.push(value);
    }

    return result;
};

const normalizeToolName = (toolName: string): string =>
    normalizeNarrationText(toolName).toLowerCase().replace(/-/gu, '_');

const normalizeTrigger = (trigger: TActivityNoteTrigger): TActivityNoteTrigger =>
    LEGACY_TRIGGER_ALIASES[trigger] ?? trigger;

const getToolCallActionKind = (toolCall: IAiToolCall): string =>
    getActionKind(toolCall.name);

const getMappedTriggerForToolName = (toolName: string): TActivityNoteTrigger | null | undefined =>
    TOOL_TO_NARRATION_TRIGGER[normalizeToolName(toolName)];

const isSettledToolCall = (toolCall: IAiToolCall): boolean =>
    toolCall.status !== 'pending';

const isSucceededToolCall = (toolCall: IAiToolCall): boolean =>
    toolCall.status === 'succeeded';

const getCompactActionLines = (toolCalls: readonly IAiToolCall[]): string[] => {
    const blocks = buildActivityFeedBlocks({ toolCalls });

    return blocks
        .flatMap((block) => block.kind === 'action_group'
            ? block.group.rows.map((row) => row.compactLine)
            : [])
        .map(normalizeNarrationText)
        .filter(Boolean)
        .slice(-MAX_RECENT_ACTIONS);
};

const parseDiff = (toolCall: IAiToolCall): { additions?: number; deletions?: number } => {
    const joined = [
        toolCall.summary,
        ...(toolCall.detailItems ?? []),
        toolCall.targetPreview ?? '',
    ]
        .map(normalizeNarrationText)
        .filter(Boolean)
        .join('\n');

    const plusMinusMatch = joined.match(DIFF_PLUS_MINUS_PATTERN);
    const plusMinusAdditions = toNonNegativeInteger(plusMinusMatch?.[1]);
    const plusMinusDeletions = toNonNegativeInteger(plusMinusMatch?.[2]);

    if (plusMinusAdditions !== undefined || plusMinusDeletions !== undefined) {
        return {
            ...(plusMinusAdditions !== undefined ? { additions: plusMinusAdditions } : {}),
            ...(plusMinusDeletions !== undefined ? { deletions: plusMinusDeletions } : {}),
        };
    }

    const additions = matchFirstInteger(joined, DIFF_ADDITION_PATTERNS);
    const deletions = matchFirstInteger(joined, DIFF_DELETION_PATTERNS);

    return {
        ...(additions !== undefined ? { additions } : {}),
        ...(deletions !== undefined ? { deletions } : {}),
    };
};

const getParsedTargetPath = (toolCall: IAiToolCall): {
    path: string;
    range?: string;
} | null => {
    const target = normalizeNarrationText(toolCall.targetPreview);
    const parsed = parseTarget(target);
    const path = normalizeNarrationText(parsed.target || target);

    if (!path) {
        return null;
    }

    return {
        path,
        ...(parsed.lineRange ? { range: parsed.lineRange } : {}),
    };
};

const toChangedFile = (toolCall: IAiToolCall): IAiNarratorChangedFile | null => {
    const parsedTarget = getParsedTargetPath(toolCall);

    if (!parsedTarget) {
        return null;
    }

    const diff = parseDiff(toolCall);

    return {
        path: parsedTarget.path,
        ...(diff.additions !== undefined ? { additions: diff.additions } : {}),
        ...(diff.deletions !== undefined ? { deletions: diff.deletions } : {}),
    };
};

const toReadFile = (toolCall: IAiToolCall): IAiNarratorReadFile | null => {
    const parsedTarget = getParsedTargetPath(toolCall);

    if (!parsedTarget) {
        return null;
    }

    return {
        path: parsedTarget.path,
        ...(parsedTarget.range ? { range: parsedTarget.range } : {}),
    };
};

const toSearchSummary = (toolCall: IAiToolCall): IAiNarratorSearchSummary | undefined => {
    const query = normalizeNarrationText(toolCall.targetPreview || toolCall.summary);

    if (!query) {
        return undefined;
    }

    const resultCount = matchFirstInteger(
        [toolCall.summary, ...(toolCall.detailItems ?? [])]
            .map(normalizeNarrationText)
            .filter(Boolean)
            .join('\n'),
        RESULT_COUNT_PATTERNS,
    );

    return {
        query,
        ...(resultCount !== undefined ? { resultCount } : {}),
    };
};

const getLatestToolCall = (toolCalls: readonly IAiToolCall[]): IAiToolCall | null =>
    [...toolCalls].reverse().find(isSettledToolCall) ?? null;

const getLatestSucceededToolCallByKinds = (
    toolCalls: readonly IAiToolCall[],
    actionKinds: ReadonlySet<string>,
): IAiToolCall | undefined =>
    [...toolCalls]
        .reverse()
        .find((toolCall) =>
            isSucceededToolCall(toolCall)
            && actionKinds.has(getToolCallActionKind(toolCall)),
        );

const isVerificationToolCall = (toolCall: IAiToolCall): boolean => {
    if (!VERIFICATION_ACTION_KINDS.has(getToolCallActionKind(toolCall))) {
        return false;
    }

    const commandContext = [
        toolCall.name,
        toolCall.summary,
        toolCall.targetPreview ?? '',
        ...(toolCall.detailItems ?? []),
    ]
        .map(normalizeNarrationText)
        .filter(Boolean)
        .join('\n');

    return VERIFICATION_COMMAND_PATTERN.test(commandContext);
};

const isGitCommitApprovalRequest = (event: Extract<TAgentUiEvent, { type: 'approval_required' }>): boolean => {
    const normalizedToolName = normalizeToolName(event.request.toolName);

    return normalizedToolName === 'git_commit'
        || normalizedToolName === 'create_commit';
};

const getCompletedTriggerForToolCall = (
    toolCall: IAiToolCall,
    toolCalls: readonly IAiToolCall[],
): TActivityNoteTrigger | null => {
    if (isVerificationToolCall(toolCall)) {
        return 'verification_done';
    }

    if (READ_ACTION_KINDS.has(getToolCallActionKind(toolCall))) {
        const succeededReadCalls = toolCalls.filter((candidate) =>
            isSucceededToolCall(candidate)
            && READ_ACTION_KINDS.has(getToolCallActionKind(candidate)),
        );

        return succeededReadCalls.length >= 2 || normalizeToolName(toolCall.name) === 'read_multiple_files'
            ? 'files_read'
            : null;
    }

    const mappedTrigger = getMappedTriggerForToolName(toolCall.name);

    return mappedTrigger ?? null;
};

const isToolCompletionEvent = (event: TAgentUiEvent): boolean =>
    event.type === 'tool_result'
    || (event.type === 'agent_event' && event.event.type === 'agent.tool.completed');

const detectTrigger = (
    events: readonly TAgentUiEvent[],
    latestToolCall: IAiToolCall | null,
    toolCalls: readonly IAiToolCall[],
): { trigger: TActivityNoteTrigger; hasError: boolean } | null => {
    const lastEvent = events.at(-1);

    if (!lastEvent) {
        return null;
    }

    if (lastEvent.type === 'plan_ready') {
        return { trigger: 'plan_ready', hasError: false };
    }

    if (lastEvent.type === 'approval_required' && isGitCommitApprovalRequest(lastEvent)) {
        return { trigger: 'git_commit_ready', hasError: false };
    }

    if (lastEvent.type === 'done') {
        return { trigger: 'final_summary', hasError: false };
    }

    if (lastEvent.type === 'agent_event' && lastEvent.event.type === 'agent.run.started') {
        return { trigger: 'run_started', hasError: false };
    }

    if (!latestToolCall) {
        return null;
    }

    const actionKind = getToolCallActionKind(latestToolCall);
    const isError = lastEvent.type === 'error' || latestToolCall.status === 'failed';

    if (isError) {
        if (MUTATION_ACTION_KINDS.has(actionKind)) {
            return { trigger: 'patch_failed', hasError: true };
        }

        if (isVerificationToolCall(latestToolCall)) {
            return { trigger: 'verification_failed', hasError: true };
        }

        return null;
    }

    if (
        (lastEvent.type === 'tool_start'
            || (lastEvent.type === 'agent_event' && lastEvent.event.type === 'agent.tool.started'))
        && latestToolCall.status === 'running'
        && isVerificationToolCall(latestToolCall)
    ) {
        return { trigger: 'verification_started', hasError: false };
    }

    if (isToolCompletionEvent(lastEvent) && isSucceededToolCall(latestToolCall)) {
        const completedTrigger = getCompletedTriggerForToolCall(latestToolCall, toolCalls);

        if (completedTrigger) {
            return { trigger: completedTrigger, hasError: false };
        }
    }

    return null;
};

const getCurrentFinding = (latestToolCall: IAiToolCall | null): string | undefined => {
    if (!latestToolCall) {
        return undefined;
    }

    const finding = normalizeNarrationText(latestToolCall.summary || latestToolCall.targetPreview);

    return finding || undefined;
};

const getNextAction = (
    trigger: TActivityNoteTrigger,
    recentActions: readonly string[],
): string | undefined => {
    if (normalizeTrigger(trigger) !== 'run_started') {
        return undefined;
    }

    return recentActions[0];
};

const getErrorSummary = (
    events: readonly TAgentUiEvent[],
    latestToolCall: IAiToolCall | null,
): string | undefined => {
    const lastEvent = events.at(-1);

    if (lastEvent?.type === 'error') {
        const message = normalizeNarrationText(lastEvent.message);

        return message || undefined;
    }

    if (latestToolCall?.status === 'failed') {
        const summary = normalizeNarrationText(latestToolCall.summary);

        return summary || undefined;
    }

    return undefined;
};

export const buildActivityNarrationCandidate = (params: {
    userGoal: string;
    events: readonly TAgentUiEvent[];
    toolCalls: readonly IAiToolCall[];
    previousNarrations: readonly string[];
}): IActivityNarrationCandidate | null => {
    const latestToolCall = getLatestToolCall(params.toolCalls);
    const triggerMeta = detectTrigger(params.events, latestToolCall, params.toolCalls);

    if (!triggerMeta) {
        return null;
    }

    const recentActions = uniqueStrings(getCompactActionLines(params.toolCalls));

    const changedFiles = uniqueByKey(
        params.toolCalls
            .filter((toolCall) =>
                isSucceededToolCall(toolCall)
                && MUTATION_ACTION_KINDS.has(getToolCallActionKind(toolCall)),
            )
            .map(toChangedFile)
            .filter((item): item is IAiNarratorChangedFile => Boolean(item)),
        (item) => `${item.path}:${item.additions ?? ''}:${item.deletions ?? ''}`,
    );

    const readFiles = uniqueByKey(
        params.toolCalls
            .filter((toolCall) =>
                isSucceededToolCall(toolCall)
                && READ_ACTION_KINDS.has(getToolCallActionKind(toolCall)),
            )
            .map(toReadFile)
            .filter((item): item is IAiNarratorReadFile => Boolean(item)),
        (item) => `${item.path}:${item.range ?? ''}`,
    );

    const searchToolCall = getLatestSucceededToolCallByKinds(
        params.toolCalls,
        SEARCH_ACTION_KINDS,
    );

    const resolvedSearchSummary = searchToolCall
        ? toSearchSummary(searchToolCall)
        : undefined;

    const errorSummary = getErrorSummary(params.events, latestToolCall);
    const currentFinding = getCurrentFinding(latestToolCall);
    const nextAction = getNextAction(triggerMeta.trigger, recentActions);

    const facts: IAiNarratorFacts = {
        userGoal: normalizeNarrationText(params.userGoal),
        trigger: triggerMeta.trigger,
        recentActions,
        changedFiles: changedFiles.slice(-MAX_CHANGED_FILES),
        readFiles: readFiles.slice(-MAX_READ_FILES),
        ...(resolvedSearchSummary ? { searchSummary: resolvedSearchSummary } : {}),
        ...(errorSummary ? { errorSummary } : {}),
        ...(currentFinding ? { currentFinding } : {}),
        ...(nextAction ? { nextAction } : {}),
        previousNarrations: uniqueStrings(params.previousNarrations).slice(-MAX_PREVIOUS_NARRATIONS),
    };

    const canonicalTrigger = normalizeTrigger(triggerMeta.trigger);

    return {
        trigger: canonicalTrigger,
        facts,
        relatedActionIds: params.toolCalls
            .filter((toolCall) => {
                if (canonicalTrigger === 'edit_done') {
                    return isSucceededToolCall(toolCall)
                        && MUTATION_ACTION_KINDS.has(getToolCallActionKind(toolCall));
                }

                if (canonicalTrigger === 'files_read') {
                    return isSucceededToolCall(toolCall)
                        && READ_ACTION_KINDS.has(getToolCallActionKind(toolCall));
                }

                return latestToolCall ? toolCall.id === latestToolCall.id : false;
            })
            .map((toolCall) => toolCall.id)
            .slice(-6),
        hasError: triggerMeta.hasError,
    };
};

const stableSerialize = (value: unknown): string => {
    if (value === undefined) {
        return 'undefined';
    }

    if (value === null) {
        return 'null';
    }

    if (typeof value === 'number') {
        return Number.isFinite(value) ? JSON.stringify(value) : 'null';
    }

    if (typeof value === 'string' || typeof value === 'boolean') {
        return JSON.stringify(value);
    }

    if (typeof value === 'bigint') {
        return `bigint:${value.toString()}`;
    }

    if (typeof value === 'symbol' || typeof value === 'function') {
        return JSON.stringify(String(value));
    }

    if (Array.isArray(value)) {
        return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
    }

    const record = value as Record<string, unknown>;

    return `{${Object.keys(record)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
        .join(',')}}`;
};

export const buildActivityFactsHash = (facts: IAiNarratorFacts): string => {
    const serialized = stableSerialize({
        trigger: facts.trigger,
        recentActions: facts.recentActions.slice(-MAX_RECENT_ACTIONS),
        changedFiles: facts.changedFiles,
        readFiles: facts.readFiles,
        searchSummary: facts.searchSummary,
        errorSummary: facts.errorSummary,
        currentFinding: facts.currentFinding,
        nextAction: facts.nextAction,
    });

    let hash = 5381;

    for (const char of serialized) {
        hash = ((hash << 5) + hash + char.charCodeAt(0)) >>> 0;
    }

    return `facts:${hash.toString(36)}`;
};

export const shouldNarrateActivity = (params: IShouldNarrateParams): boolean => {
    const now = params.now ?? Date.now();
    const normalizedTrigger = normalizeTrigger(params.trigger);

    if (params.narrationCount >= NARRATION_LIMIT) {
        return false;
    }

    if (params.hasError) {
        return true;
    }

    if (normalizedTrigger === 'time_checked') {
        if (!TIME_SENSITIVE_GOAL_PATTERN.test(params.facts.userGoal)) {
            return false;
        }
    }

    if (normalizedTrigger === 'git_checked') {
        const gitSignals = [
            params.facts.currentFinding,
            params.facts.errorSummary,
            ...params.facts.recentActions,
        ]
            .map(normalizeNarrationText)
            .filter(Boolean)
            .join('\n');

        if (!GIT_STATE_SIGNAL_PATTERN.test(gitSignals)) {
            return false;
        }
    }

    if (!DEFAULT_NARRATOR_TRIGGERS.has(normalizedTrigger)
        && normalizedTrigger !== 'time_checked'
        && normalizedTrigger !== 'git_checked') {
        return false;
    }

    if (!params.hasImportantFact) {
        return false;
    }

    if (params.narrationCount === 0) {
        return true;
    }

    if (normalizedTrigger === 'run_started' || normalizedTrigger === 'plan_ready') {
        return now - params.lastNarrationAt > NARRATION_INTERVAL_MS;
    }

    return now - params.lastNarrationAt > NARRATION_INTERVAL_MS;
};

export const hasImportantNarrationFact = (facts: IAiNarratorFacts): boolean =>
    (facts.changedFiles?.length ?? 0) > 0
    || (facts.readFiles?.length ?? 0) > 0
    || (facts.recentActions?.length ?? 0) > 0
    || Boolean(facts.searchSummary)
    || Boolean(facts.errorSummary)
    || Boolean(facts.currentFinding)
    || Boolean(facts.nextAction);

export const createNarratorActivityNote = (params: {
    response: Pick<IAiNarratorResponse, 'runId' | 'trigger' | 'sequence' | 'factsHash' | 'text' | 'tone'>;
    relatedActionIds: readonly string[];
    status?: IActivityNote['status'];
    createdAt?: number;
}): IActivityNote => ({
    id: `narrator:${params.response.runId}:${params.response.trigger}:${params.response.sequence}`,
    runId: params.response.runId,
    source: 'narrator',
    trigger: params.response.trigger,
    text: normalizeNarrationText(params.response.text),
    tone: params.response.tone as TActivityNoteTone,
    status: params.status ?? 'completed',
    relatedActionIds: [...params.relatedActionIds],
    factsHash: params.response.factsHash,
    createdAt: params.createdAt ?? Date.now(),
});