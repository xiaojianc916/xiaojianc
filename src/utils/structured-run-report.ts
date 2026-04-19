import type { IRunLogEntry, IRunResult, TExecutorKind } from '@/types/editor';
import { formatTime } from '@/utils/date';

export type TInsightTone = 'neutral' | 'success' | 'warning' | 'error' | 'running';
export type TInsightStepStatus = 'done' | 'running' | 'warning' | 'error';

export interface IStructuredRunStep {
  id: string;
  title: string;
  detail: string;
  status: TInsightStepStatus;
  timestamp: string;
}

export interface IStructuredInsightBadge {
  label: string;
  value: string;
  tone?: TInsightTone;
}

export interface IStructuredRunReport {
  hasContent: boolean;
  steps: IStructuredRunStep[];
  result: {
    tone: TInsightTone;
    title: string;
    summary: string;
    badges: IStructuredInsightBadge[];
    highlights: string[];
  };
  diagnosis: {
    tone: TInsightTone;
    title: string;
    summary: string;
    hints: string[];
    evidence: string[];
  };
  summary: Array<{
    label: string;
    value: string;
  }>;
}

type TBuildStructuredRunReportOptions = {
  terminalOutput: string;
  runLogs: IRunLogEntry[];
  lastRunResult: IRunResult | null;
  isRunning: boolean;
  executor: TExecutorKind;
};

const RUN_START_MARKER = '[sh-editor] Running current script...';
const EXIT_CODE_PATTERN = /\[sh-editor\]\s*Exit code:\s*(-?\d+)/i;
const EXIT_CODE_LINE_PATTERN = /\[sh-editor\]\s*Exit code:\s*-?\d+/i;
const ANSI_PATTERN =
  // eslint-disable-next-line no-control-regex
  /\u001b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][\s\S]*?(?:\u0007|\u001b\\))/g;
const STEP_LINE_PATTERN = /^(?:\[\s*step\s*\]|\[\s*\d+\/\d+\s*\]|step\s*\d+|==>|->)/i;
const COMMAND_PROMPT_PATTERN = /^[\w.-]+@[\w.-]+:.*[$#]\s+/;
const CONTINUATION_PROMPT_PATTERN = /^[\w.-]*>\s*/;
const HEREDOC_START_PATTERN = /cat\s+<<'SH_EDITOR_EOF_\d+'/i;
const HEREDOC_END_PATTERN = /^__SH_EDITOR_EOF_\d+__$/;
const TEMP_SCRIPT_PATTERN = /\.sh-editor-[\w.-]+\.tmp\.sh/i;
const INTERNAL_SCRIPT_PATTERN = /__sh_editor_status|unset\s+__sh_editor_status/i;
const RUN_RELATED_LOG_PATTERN = /执行|运行|终端|失败|成功|error|fail|run|terminal|script|shell/i;

const stripAnsi = (value: string): string => value.replace(ANSI_PATTERN, '');

const normalizeOutput = (value: string): string =>
  stripAnsi(value)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const parseExitCodeFromOutput = (output: string): number | null => {
  const matched = output.match(EXIT_CODE_PATTERN);
  return matched ? Number(matched[1]) : null;
};

const sortLogsAscending = (runLogs: IRunLogEntry[]): IRunLogEntry[] =>
  [...runLogs].sort(
    (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  );

const mapLogLevelToStepStatus = (level: IRunLogEntry['level']): TInsightStepStatus => {
  switch (level) {
    case 'success':
      return 'done';
    case 'error':
      return 'error';
    default:
      return 'running';
  }
};

const findLastRunMarkerIndex = (lines: string[]): number => {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].includes(RUN_START_MARKER)) {
      return index;
    }
  }

  return -1;
};

const extractCanonicalLine = (line: string): string => {
  if (line.includes(RUN_START_MARKER)) {
    return RUN_START_MARKER;
  }

  const exitLine = line.match(EXIT_CODE_LINE_PATTERN);
  if (exitLine) {
    return exitLine[0];
  }

  return line;
};

const shouldSkipLine = (
  line: string,
  inHeredoc: boolean,
): {
  skip: boolean;
  nextInHeredoc: boolean;
} => {
  if (inHeredoc) {
    if (HEREDOC_END_PATTERN.test(line)) {
      return { skip: true, nextInHeredoc: false };
    }
    return { skip: true, nextInHeredoc: true };
  }

  if (HEREDOC_START_PATTERN.test(line)) {
    return { skip: true, nextInHeredoc: true };
  }

  if (line.startsWith('# stdout') || line.startsWith('# stderr')) {
    return { skip: true, nextInHeredoc: false };
  }

  if (HEREDOC_END_PATTERN.test(line)) {
    return { skip: true, nextInHeredoc: false };
  }

  if (line.includes('SH_EDITOR_EOF_')) {
    return { skip: true, nextInHeredoc: false };
  }

  if (TEMP_SCRIPT_PATTERN.test(line) || INTERNAL_SCRIPT_PATTERN.test(line)) {
    return { skip: true, nextInHeredoc: false };
  }

  if (COMMAND_PROMPT_PATTERN.test(line) && line.includes('printf')) {
    return { skip: true, nextInHeredoc: false };
  }

  if (COMMAND_PROMPT_PATTERN.test(line) && line.includes('cat <<')) {
    return { skip: true, nextInHeredoc: false };
  }

  if (CONTINUATION_PROMPT_PATTERN.test(line)) {
    return { skip: true, nextInHeredoc: false };
  }

  return { skip: false, nextInHeredoc: false };
};

const sanitizeExecutionLines = (lines: string[]): string[] => {
  const sanitized: string[] = [];
  let inHeredoc = false;

  for (const originalLine of lines) {
    const trimmedLine = originalLine.trim();
    if (!trimmedLine) {
      continue;
    }

    const hasRunMarker = trimmedLine.includes(RUN_START_MARKER);
    const hasHeredocStart = HEREDOC_START_PATTERN.test(trimmedLine);
    if (hasRunMarker) {
      sanitized.push(RUN_START_MARKER);
      if (hasHeredocStart) {
        inHeredoc = true;
      }
      continue;
    }

    const canonicalLine = extractCanonicalLine(trimmedLine);

    if (EXIT_CODE_LINE_PATTERN.test(canonicalLine)) {
      sanitized.push(canonicalLine);
      continue;
    }

    const skipResult = shouldSkipLine(canonicalLine, inHeredoc);
    inHeredoc = skipResult.nextInHeredoc;
    if (skipResult.skip) {
      continue;
    }

    sanitized.push(canonicalLine);
  }

  return sanitized;
};

const isMetaOutputLine = (line: string): boolean =>
  line === RUN_START_MARKER || EXIT_CODE_LINE_PATTERN.test(line);

const collectExecutionOutputLines = (terminalOutput: string): string[] => {
  const normalizedOutput = normalizeOutput(terminalOutput);
  if (!normalizedOutput) {
    return [];
  }

  const allLines = normalizedOutput
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const lastRunMarkerIndex = findLastRunMarkerIndex(allLines);
  const scopedLines = lastRunMarkerIndex >= 0 ? allLines.slice(lastRunMarkerIndex) : allLines;

  return sanitizeExecutionLines(scopedLines);
};

const collectStepLines = (outputLines: string[]): string[] =>
  outputLines
    .filter((line) => !isMetaOutputLine(line))
    .filter(
      (line) =>
        STEP_LINE_PATTERN.test(line) ||
        /(?:checking|build|deploy|upload|sync|compile|install|test|lint|done|完成|开始|执行|校验|部署|error|fail|hello)/i.test(
          line,
        ),
    )
    .slice(0, 5);

const formatDuration = (durationMs: number | null | undefined): string => {
  if (!durationMs || durationMs <= 0) {
    return '—';
  }

  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  return `${Math.max(1, Math.round(durationMs / 100)) / 10} s`;
};

const resolveCause = (
  text: string,
  exitCode: number | null,
): {
  title: string;
  summary: string;
  hints: string[];
} => {
  const normalizedText = text.toLowerCase();

  if (exitCode === 127 || normalizedText.includes('command not found')) {
    return {
      title: '命令或依赖缺失',
      summary: '终端返回了 command not found，说明脚本依赖的命令在当前执行环境中不可用。',
      hints: ['确认 PATH 中已安装对应命令。', '如果依赖仅存在于特定 shell，请切换到正确执行器。'],
    };
  }

  if (exitCode === 126 || normalizedText.includes('permission denied')) {
    return {
      title: '权限不足',
      summary: '脚本或其依赖资源缺少可执行/可访问权限，导致流程中断。',
      hints: ['检查目标文件是否可执行。', '确认当前用户对涉及目录和文件具备访问权限。'],
    };
  }

  if (normalizedText.includes('no such file or directory')) {
    return {
      title: '路径或文件不存在',
      summary: '脚本引用了不存在的文件、目录或命令路径，需要先校正输入或工作目录。',
      hints: ['确认工作目录是否正确。', '检查脚本中的路径拼接和相对路径是否有效。'],
    };
  }

  if (normalizedText.includes('syntax error') || normalizedText.includes('unexpected token')) {
    return {
      title: '脚本语法错误',
      summary: 'Shell 在解析脚本时遇到了语法问题，当前命令没有被正常执行。',
      hints: ['检查 if/for/case 等语句是否闭合。', '确认引号、括号和 here-doc 分隔符是否完整。'],
    };
  }

  if (normalizedText.includes('unbound variable')) {
    return {
      title: '变量未定义',
      summary: '在严格模式下读取了未声明变量，脚本因此提前退出。',
      hints: ['检查变量默认值。', '在读取参数前先做空值保护。'],
    };
  }

  if (normalizedText.includes('timed out') || normalizedText.includes('超时')) {
    return {
      title: '执行超时或流程阻塞',
      summary: '脚本没有在预期时间内结束，可能在等待输入、网络响应或长耗时任务。',
      hints: ['确认脚本是否需要交互输入。', '排查网络、SSH、远端命令等外部依赖。'],
    };
  }

  return {
    title: '需要人工复核',
    summary: '已捕获异常输出，但暂时无法稳定归类为单一原因，建议结合关键日志逐步定位。',
    hints: ['优先查看下方关键证据。', '从最后一条错误信息向前追溯触发步骤。'],
  };
};

const buildSteps = (
  runLogs: IRunLogEntry[],
  outputLines: string[],
  isRunning: boolean,
): IStructuredRunStep[] => {
  const orderedLogs = sortLogsAscending(runLogs)
    .filter((item) => item.level !== 'info' || RUN_RELATED_LOG_PATTERN.test(item.title))
    .slice(-4);
  const logSteps = orderedLogs.map((item) => ({
    id: item.id,
    title: item.title,
    detail: item.detail,
    status: mapLogLevelToStepStatus(item.level),
    timestamp: formatTime(item.createdAt),
  }));

  const outputSteps = collectStepLines(outputLines).map((line, index) => ({
    id: `output-step-${index}`,
    title: index === 0 ? '终端关键输出' : `终端反馈 ${index + 1}`,
    detail: line,
    status: isRunning ? 'running' : 'done',
    timestamp: '实时',
  }));

  const metaSteps = outputLines
    .filter((line) => line === RUN_START_MARKER)
    .slice(0, 2)
    .map((line, index) => ({
      id: `meta-step-${index}`,
      title: '执行阶段',
      detail: line,
      status: isRunning ? 'running' : 'done',
      timestamp: '实时',
    }));

  const steps = [...metaSteps, ...outputSteps, ...logSteps];
  if (steps.length > 0) {
    return steps;
  }

  if (isRunning) {
    return [
      {
        id: 'pending-run',
        title: '执行已发起',
        detail: '终端正在接收脚本并等待更多运行反馈。',
        status: 'running',
        timestamp: '实时',
      },
    ];
  }

  return [
    {
      id: 'idle-step',
      title: '暂无执行日志',
      detail: '运行脚本后，这里会自动整理执行步骤与关键信息。',
      status: 'done',
      timestamp: '—',
    },
  ];
};

const buildResult = (
  lastRunResult: IRunResult | null,
  exitCodeFromOutput: number | null,
  outputLines: string[],
  isRunning: boolean,
  executor: TExecutorKind,
): IStructuredRunReport['result'] => {
  const highlights = outputLines
    .filter((line) => !EXIT_CODE_LINE_PATTERN.test(line))
    .filter((line) => line === RUN_START_MARKER || line.length > 0)
    .slice(-4);

  if (isRunning) {
    return {
      tone: 'running',
      title: '执行进行中',
      summary: '脚本已经发往终端，正在等待更多输出与结束状态。',
      badges: [
        { label: '执行器', value: executor.toUpperCase() },
        { label: '状态', value: '执行中', tone: 'running' },
      ],
      highlights,
    };
  }

  if (lastRunResult) {
    return {
      tone: lastRunResult.success ? 'success' : 'error',
      title: lastRunResult.success ? '执行完成' : '执行失败',
      summary: lastRunResult.success
        ? '脚本已完成执行，关键输出已整理为可读结论。'
        : '脚本执行过程中出现异常，建议优先查看下方错误归因与关键证据。',
      badges: [
        {
          label: '退出码',
          value: String(lastRunResult.exitCode ?? '未知'),
          tone: lastRunResult.success ? 'success' : 'error',
        },
        { label: '执行器', value: lastRunResult.executorLabel },
        { label: '耗时', value: formatDuration(lastRunResult.durationMs) },
      ],
      highlights,
    };
  }

  if (exitCodeFromOutput !== null) {
    return {
      tone: exitCodeFromOutput === 0 ? 'success' : 'error',
      title: exitCodeFromOutput === 0 ? '终端执行完成' : '终端执行异常结束',
      summary:
        exitCodeFromOutput === 0
          ? '已从终端实时输出中识别到脚本结束状态。'
          : '已从终端输出中识别到非零退出码，请结合异常诊断继续排查。',
      badges: [
        {
          label: '退出码',
          value: String(exitCodeFromOutput),
          tone: exitCodeFromOutput === 0 ? 'success' : 'error',
        },
        { label: '执行器', value: executor.toUpperCase() },
      ],
      highlights,
    };
  }

  return {
    tone: 'neutral',
    title: '等待执行结果',
    summary: '当前尚未捕获到完整的退出状态，可以继续查看步骤流或终端实时输出。',
    badges: [{ label: '执行器', value: executor.toUpperCase() }],
    highlights,
  };
};

const buildDiagnosis = (
  lastRunResult: IRunResult | null,
  exitCodeFromOutput: number | null,
  outputLines: string[],
): IStructuredRunReport['diagnosis'] => {
  const errorSource = [
    lastRunResult?.stderr ?? '',
    lastRunResult?.combinedOutput ?? '',
    outputLines.join('\n'),
  ]
    .filter(Boolean)
    .join('\n')
    .trim();

  if (!errorSource) {
    return {
      tone: 'neutral',
      title: '暂无异常信号',
      summary: '当前没有识别到明显错误输出，执行链路整体保持稳定。',
      hints: ['如果你需要更细粒度排查，可以继续观察后续终端输出。'],
      evidence: [],
    };
  }

  const evidence = errorSource
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) =>
        Boolean(line) &&
        /error|failed|denied|not found|no such file|syntax|traceback|exception|未找到|失败|错误|异常/i.test(
          line,
        ),
    )
    .slice(0, 4);

  if ((lastRunResult?.success ?? false) && evidence.length === 0) {
    return {
      tone: 'success',
      title: '未发现影响执行的异常',
      summary: '虽然存在终端输出，但没有识别到会影响结果的错误模式。',
      hints: ['如果结果仍不符合预期，建议检查业务输出是否完整。'],
      evidence: [],
    };
  }

  const cause = resolveCause(errorSource, lastRunResult?.exitCode ?? exitCodeFromOutput);
  return {
    tone: 'error',
    title: cause.title,
    summary: cause.summary,
    hints: cause.hints,
    evidence,
  };
};

const buildSummary = (
  lastRunResult: IRunResult | null,
  exitCodeFromOutput: number | null,
  runLogs: IRunLogEntry[],
  outputLines: string[],
  executor: TExecutorKind,
): IStructuredRunReport['summary'] => {
  const orderedLogs = sortLogsAscending(runLogs);
  const lastLog = orderedLogs.length > 0 ? orderedLogs[orderedLogs.length - 1] : undefined;

  return [
    {
      label: '当前执行器',
      value: lastRunResult?.executorLabel ?? executor.toUpperCase(),
    },
    {
      label: '退出状态',
      value:
        lastRunResult?.exitCode !== null && lastRunResult?.exitCode !== undefined
          ? String(lastRunResult.exitCode)
          : exitCodeFromOutput !== null
            ? String(exitCodeFromOutput)
            : '待确认',
    },
    {
      label: '执行耗时',
      value: formatDuration(lastRunResult?.durationMs),
    },
    {
      label: '最近反馈',
      value: lastRunResult?.finishedAt
        ? formatTime(lastRunResult.finishedAt)
        : lastLog
          ? formatTime(lastLog.createdAt)
          : '—',
    },
    {
      label: '输出行数',
      value: String(outputLines.length),
    },
  ];
};

export const buildStructuredRunReport = ({
  terminalOutput,
  runLogs,
  lastRunResult,
  isRunning,
  executor,
}: TBuildStructuredRunReportOptions): IStructuredRunReport => {
  const safeRunLogs = Array.isArray(runLogs) ? runLogs : [];
  const safeOutput = typeof terminalOutput === 'string' ? terminalOutput : '';
  const outputLines = collectExecutionOutputLines(safeOutput);
  const exitCodeFromOutput = parseExitCodeFromOutput(outputLines.join('\n'));
  const steps = buildSteps(safeRunLogs, outputLines, isRunning);
  const result = buildResult(lastRunResult, exitCodeFromOutput, outputLines, isRunning, executor);
  const diagnosis = buildDiagnosis(lastRunResult, exitCodeFromOutput, outputLines);
  const summary = buildSummary(
    lastRunResult,
    exitCodeFromOutput,
    safeRunLogs,
    outputLines,
    executor,
  );

  return {
    hasContent:
      safeRunLogs.length > 0 ||
      outputLines.length > 0 ||
      Boolean(lastRunResult) ||
      Boolean(isRunning),
    steps,
    result,
    diagnosis,
    summary,
  };
};
