import type { ICommandTemplate, TDocumentEncoding, TExecutorKind } from '@/types/editor';

export const DEFAULT_SCRIPT = `#!/usr/bin/env bash

set -euo pipefail

main() {
  echo "Hello SH Editor"
}

main "$@"
`;

export const ENCODING_OPTIONS: Array<{ label: string; value: TDocumentEncoding }> = [
  { label: 'UTF-8', value: 'utf-8' },
  { label: 'UTF-8 BOM', value: 'utf-8-bom' },
  { label: 'GBK', value: 'gbk' },
  { label: 'GB18030', value: 'gb18030' },
  { label: 'UTF-16 LE', value: 'utf-16le' },
  { label: 'UTF-16 BE', value: 'utf-16be' },
];

export const EXECUTOR_OPTIONS: Array<{ label: string; value: TExecutorKind }> = [
  { label: '自动选择', value: 'auto' },
  { label: 'WSL', value: 'wsl' },
  { label: 'Git Bash / sh', value: 'git-bash' },
  { label: 'Windows Bash', value: 'bash' },
];

export const COMMAND_TEMPLATES: ICommandTemplate[] = [
  {
    id: 'safe-header',
    title: '安全头部',
    category: '基础模板',
    description: '快速插入 bash 安全执行头与主函数骨架。',
    snippet: DEFAULT_SCRIPT,
  },
  {
    id: 'for-loop',
    title: 'for 循环',
    category: '流程控制',
    description: '批量遍历目录或参数时的常用循环骨架。',
    snippet: `for item in "$@"; do
  echo "processing: \${item}"
done
`,
  },
  {
    id: 'if-check',
    title: 'if 判断',
    category: '流程控制',
    description: '文件存在校验与错误退出模板。',
    snippet: `if [[ ! -f "$1" ]]; then
  echo "文件不存在: $1" >&2
  exit 1
fi
`,
  },
  {
    id: 'scp-upload',
    title: 'SCP 上传',
    category: '远程操作',
    description: '常用部署上传脚本片段。',
    snippet: `REMOTE_HOST="user@example.com"
LOCAL_FILE="./dist/package.tar.gz"
REMOTE_DIR="/opt/deploy"

scp "$LOCAL_FILE" "$REMOTE_HOST:$REMOTE_DIR/"
`,
  },
  {
    id: 'journal-tail',
    title: '日志跟踪',
    category: '运维排查',
    description: '跟踪 systemd 服务日志并过滤关键字。',
    snippet: `SERVICE_NAME="nginx"
journalctl -u "$SERVICE_NAME" -f | grep --line-buffered -i "error"
`,
  },
  {
    id: 'backup-dir',
    title: '目录备份',
    category: '文件处理',
    description: '按时间戳打包目录并保留日志。',
    snippet: `SOURCE_DIR="/data/app"
BACKUP_DIR="/data/backup"
STAMP="$(date +%Y%m%d_%H%M%S)"

mkdir -p "$BACKUP_DIR"
tar -czf "$BACKUP_DIR/app_\${STAMP}.tar.gz" "$SOURCE_DIR"
echo "backup done: $BACKUP_DIR/app_\${STAMP}.tar.gz"
`,
  },
];

export const COMMENT_TEMPLATES: ICommandTemplate[] = [
  {
    id: 'script-comment',
    title: '脚本说明块',
    category: '备注模板',
    description: '脚本级说明，适合写用途、作者和运行方式。',
    snippet: `# ==========================================
# 脚本名称：
# 用途说明：
# 运行环境：
# 输入参数：
# 输出结果：
# 维护人：
# ==========================================
`,
  },
  {
    id: 'function-comment',
    title: '函数说明块',
    category: '备注模板',
    description: '函数用途、参数和返回说明。',
    snippet: `# 函数名：
# 用途：
# 参数：
# 返回：
`,
  },
  {
    id: 'step-comment',
    title: '步骤分隔线',
    category: '备注模板',
    description: '为复杂脚本增加阶段性说明。',
    snippet: `# ---------- 第一步：环境校验 ----------
`,
  },
];
