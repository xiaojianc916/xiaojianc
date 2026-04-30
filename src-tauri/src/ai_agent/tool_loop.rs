use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use git2::{Repository, Signature, Status, StatusOptions};
use ignore::WalkBuilder;

use crate::ai::errors;
use crate::ai_security::command_classifier::{classify_command, CommandClass};
use crate::ai_tools::registry;
use crate::commands::contracts::{AiContextReferencePayload, AiTaskPlanStepPayload};
use crate::commands::{
    configure_std_command_for_background, find_command_path, resolve_workspace_root,
};

const MAX_SCAN_FILES: usize = 800;
const MAX_TEXT_FILE_BYTES: u64 = 512 * 1024;
const MAX_TOOL_OUTPUT_BYTES: usize = 64 * 1024;
const TOOL_OUTPUT_HEAD_BYTES: usize = 12 * 1024;
const TOOL_OUTPUT_TAIL_BYTES: usize = 12 * 1024;
const RUN_TEST_TIMEOUT: Duration = Duration::from_secs(120);
const RUN_COMMAND_DEFAULT_TIMEOUT: Duration = Duration::from_secs(60);
const RUN_COMMAND_MIN_TIMEOUT_MS: u64 = 1_000;
const RUN_COMMAND_MAX_TIMEOUT_MS: u64 = 120_000;
const RUN_COMMAND_PREVIEW_CHARS: usize = 160;

static TOOL_OUTPUT_REFS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

fn tool_output_refs() -> &'static Mutex<HashMap<String, String>> {
    TOOL_OUTPUT_REFS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Debug, Clone)]
pub struct AgentToolUseContext {
    pub run_id: String,
    pub step_id: String,
    pub permission_level: String,
    pub workspace_root: Option<String>,
    pub references: Vec<AiContextReferencePayload>,
    pub tool_decisions: HashMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentToolResultMessage {
    pub id: String,
    pub run_id: String,
    pub step_id: String,
    pub tool_name: String,
    pub status: String,
    pub summary: String,
    pub output_ref: Option<String>,
    pub started_at: String,
    pub ended_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentRunMessage {
    ToolResult(AgentToolResultMessage),
}

pub fn validate_step_tools(step: &AiTaskPlanStepPayload) -> Result<(), String> {
    if step.tools.is_empty() {
        return Err(errors::error(
            "AI_AGENT_PLAN_INVALID",
            "Agent step must declare at least one registered tool.",
        ));
    }

    for tool_name in &step.tools {
        if !registry::is_tool_registered(tool_name) {
            return Err(errors::error(
                "AI_AGENT_TOOL_NOT_ALLOWED",
                "Agent step contains an unregistered tool and was rejected.",
            ));
        }
    }

    Ok(())
}

pub fn build_tool_result_messages(
    context: &AgentToolUseContext,
    step: &AiTaskPlanStepPayload,
) -> Result<Vec<AgentRunMessage>, String> {
    validate_step_tools(step)?;
    let workspace_root = resolve_workspace_root(context.workspace_root.clone())?;

    Ok(step
        .tools
        .iter()
        .map(|tool_name| execute_registered_tool(context, step, tool_name, &workspace_root))
        .collect())
}

fn execute_registered_tool(
    context: &AgentToolUseContext,
    step: &AiTaskPlanStepPayload,
    tool_name: &str,
    workspace_root: &Path,
) -> AgentRunMessage {
    let started_at = chrono::Utc::now().to_rfc3339();
    let execution = if registry::requires_confirmation(tool_name) {
        match context.tool_decisions.get(tool_name).map(String::as_str) {
            Some("skip") => ToolExecutionSummary {
                status: "succeeded".to_string(),
                summary: format!("已按用户选择跳过 {tool_name}，未执行高风险动作。"),
                output_ref: None,
            },
            Some("allow-once") | Some("allow-run") => {
                execute_confirmed_high_risk_tool(tool_name, step, workspace_root)
            }
            Some("stop") => ToolExecutionSummary {
                status: "failed".to_string(),
                summary: format!("用户已停止 {tool_name}，工具未执行。"),
                output_ref: None,
            },
            _ => ToolExecutionSummary {
                status: "failed".to_string(),
                summary: format!("Tool {tool_name} requires inline user confirmation."),
                output_ref: None,
            },
        }
    } else {
        match tool_name {
            "read_current_file" => {
                execute_context_reference(tool_name, &context.references, &["current-file"])
            }
            "read_selected_text" => {
                execute_context_reference(tool_name, &context.references, &["selection"])
            }
            "read_file" => execute_read_file(step, &context.references, workspace_root),
            "get_diagnostics" => {
                execute_context_reference(tool_name, &context.references, &["diagnostics"])
            }
            "get_terminal_log" => {
                execute_context_reference(tool_name, &context.references, &["terminal-log"])
            }
            "search_text" => execute_search_text(step, workspace_root),
            "search_files" => execute_search_files(step, workspace_root),
            "search_symbols" => execute_search_symbols(step, workspace_root),
            "get_git_diff" => execute_get_git_diff(workspace_root),
            "web_search" | "web_fetch" => execute_network_gate(tool_name),
            "propose_patch" | "auto_apply_patch" => execute_patch_gate(tool_name),
            "run_test" => execute_run_test_gate(workspace_root),
            "run_command" => execute_confirmation_gate(
                tool_name,
                "command input and user confirmation are required",
            ),
            "stage_file" => {
                execute_confirmation_gate(tool_name, "file paths and Git confirmation are required")
            }
            "create_commit" => execute_confirmation_gate(
                tool_name,
                "commit message and Git confirmation are required",
            ),
            "get_project_tree" => execute_project_tree(workspace_root),
            "list_open_files" => execute_list_open_files(&context.references),
            "get_package_scripts" => execute_package_scripts(workspace_root),
            "get_test_targets" => execute_test_targets(workspace_root),
            _ => ToolExecutionSummary {
                status: "failed".to_string(),
                summary: format!("Tool {tool_name} is registered but has no executor."),
                output_ref: None,
            },
        }
    };
    let ended_at = chrono::Utc::now().to_rfc3339();

    AgentRunMessage::ToolResult(AgentToolResultMessage {
        id: format!(
            "{}:{}:{}:{}",
            context.run_id, context.step_id, tool_name, execution.status
        ),
        run_id: context.run_id.clone(),
        step_id: context.step_id.clone(),
        tool_name: tool_name.to_string(),
        status: execution.status,
        summary: execution.summary,
        output_ref: execution.output_ref,
        started_at,
        ended_at,
    })
}

fn execute_context_reference(
    tool_name: &str,
    references: &[AiContextReferencePayload],
    kinds: &[&str],
) -> ToolExecutionSummary {
    let matches = references
        .iter()
        .filter(|reference| kinds.contains(&reference.kind.as_str()))
        .collect::<Vec<_>>();

    if matches.is_empty() {
        return ToolExecutionSummary {
            status: "failed".to_string(),
            summary: format!("Tool {tool_name} did not receive required frontend context."),
            output_ref: None,
        };
    }

    let preview_chars = matches
        .iter()
        .map(|reference| reference.content_preview.chars().count())
        .sum::<usize>();
    let labels = matches
        .iter()
        .take(3)
        .map(|reference| reference.label.as_str())
        .collect::<Vec<_>>()
        .join(", ");

    ToolExecutionSummary {
        status: "succeeded".to_string(),
        summary: format!(
            "Read {} context references ({preview_chars} preview chars): {labels}.",
            matches.len()
        ),
        output_ref: Some(format!("agent-tool-result:{tool_name}:context")),
    }
}

fn execute_read_file(
    step: &AiTaskPlanStepPayload,
    references: &[AiContextReferencePayload],
    workspace_root: &Path,
) -> ToolExecutionSummary {
    let candidate = references
        .iter()
        .find(|reference| reference.kind == "current-file" || reference.kind == "selection")
        .and_then(|reference| reference.path.as_deref())
        .or_else(|| {
            step.references
                .as_ref()
                .and_then(|references| {
                    references
                        .iter()
                        .find(|reference| reference.r#type == "file")
                })
                .map(|reference| reference.uri.as_str())
        });

    let Some(raw_path) = candidate else {
        return ToolExecutionSummary {
            status: "failed".to_string(),
            summary: "read_file requires a file reference.".to_string(),
            output_ref: None,
        };
    };

    let path = Path::new(raw_path);
    let file_path = if path.is_absolute() {
        path.to_path_buf()
    } else {
        workspace_root.join(path)
    };

    if !file_path.starts_with(workspace_root) {
        return ToolExecutionSummary {
            status: "failed".to_string(),
            summary: "read_file rejected a path outside workspace.".to_string(),
            output_ref: None,
        };
    }

    let Ok(metadata) = fs::metadata(&file_path) else {
        return ToolExecutionSummary {
            status: "failed".to_string(),
            summary: "read_file target does not exist.".to_string(),
            output_ref: None,
        };
    };

    ToolExecutionSummary {
        status: "succeeded".to_string(),
        summary: format!(
            "Read file metadata for {} ({} bytes).",
            relative_path(workspace_root, &file_path),
            metadata.len()
        ),
        output_ref: Some(format!(
            "agent-tool-result:{}:read_file",
            relative_path(workspace_root, &file_path)
        )),
    }
}

fn execute_search_symbols(
    step: &AiTaskPlanStepPayload,
    workspace_root: &Path,
) -> ToolExecutionSummary {
    let query = derive_query(step).to_lowercase();
    let mut scanned = 0usize;
    let mut matched = 0usize;

    for entry in WalkBuilder::new(workspace_root)
        .standard_filters(true)
        .hidden(false)
        .follow_links(false)
        .build()
        .filter_map(Result::ok)
    {
        if scanned >= MAX_SCAN_FILES {
            break;
        }
        if !entry
            .file_type()
            .is_some_and(|file_type| file_type.is_file())
        {
            continue;
        }
        let path = entry.into_path();
        if !is_small_text_candidate(&path) {
            continue;
        }
        scanned += 1;
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        for line in content.lines() {
            let normalized = line.trim().to_lowercase();
            if (normalized.starts_with("fn ")
                || normalized.starts_with("function ")
                || normalized.starts_with("const ")
                || normalized.starts_with("export const ")
                || normalized.contains("function "))
                && normalized.contains(&query)
            {
                matched += 1;
            }
        }
    }

    ToolExecutionSummary {
        status: "succeeded".to_string(),
        summary: format!("Scanned {scanned} text files for symbol-like lines; matched {matched}."),
        output_ref: Some("agent-tool-result:search_symbols".to_string()),
    }
}

fn execute_confirmed_high_risk_tool(
    tool_name: &str,
    step: &AiTaskPlanStepPayload,
    workspace_root: &Path,
) -> ToolExecutionSummary {
    match tool_name {
        "web_search" | "web_fetch" => execute_network_gate(tool_name),
        "propose_patch" | "auto_apply_patch" => execute_patch_gate(tool_name),
        "run_test" => execute_run_test_gate(workspace_root),
        "run_command" => execute_run_command_gate(step, workspace_root),
        "stage_file" => execute_stage_file_gate(step, workspace_root),
        "create_commit" => execute_create_commit_gate(step, workspace_root),
        _ => ToolExecutionSummary {
            status: "failed".to_string(),
            summary: format!(
                "Tool {tool_name} has no confirmed executor for step {}.",
                step.id
            ),
            output_ref: None,
        },
    }
}

fn execute_network_gate(tool_name: &str) -> ToolExecutionSummary {
    ToolExecutionSummary {
        status: "failed".to_string(),
        summary: format!(
            "Tool {tool_name} is implemented by the audited web pipeline and requires an explicit query/url plus network permission."
        ),
        output_ref: None,
    }
}

fn execute_patch_gate(tool_name: &str) -> ToolExecutionSummary {
    ToolExecutionSummary {
        status: "failed".to_string(),
        summary: format!(
            "Tool {tool_name} requires a concrete patch payload and AED approval before execution."
        ),
        output_ref: None,
    }
}

fn execute_confirmation_gate(tool_name: &str, reason: &str) -> ToolExecutionSummary {
    ToolExecutionSummary {
        status: "failed".to_string(),
        summary: format!("Tool {tool_name} was not executed: {reason}."),
        output_ref: None,
    }
}

fn execute_run_command_gate(
    step: &AiTaskPlanStepPayload,
    workspace_root: &Path,
) -> ToolExecutionSummary {
    let Some(input) = extract_run_command_payload(step) else {
        let classification = classify_command("");
        return ToolExecutionSummary {
            status: "failed".to_string(),
            summary: format!(
                "run_command was not executed: missing schema-validated command payload. {}",
                classification.reason
            ),
            output_ref: None,
        };
    };

    if input.cwd_policy != "workspace-root" {
        return ToolExecutionSummary {
            status: "failed".to_string(),
            summary: "run_command was not executed: cwdPolicy must be workspace-root.".to_string(),
            output_ref: None,
        };
    }

    if input.reason.trim().is_empty() {
        return ToolExecutionSummary {
            status: "failed".to_string(),
            summary: "run_command was not executed: reason is required.".to_string(),
            output_ref: None,
        };
    }

    let command = input.command.trim();
    let classification = classify_command(command);
    match classification.class {
        CommandClass::Blocked => ToolExecutionSummary {
            status: "failed".to_string(),
            summary: format!(
                "run_command blocked: {}{}",
                classification.reason,
                classification
                    .destructive_pattern
                    .map(|pattern| format!(" matched pattern: {pattern}."))
                    .unwrap_or_default()
            ),
            output_ref: None,
        },
        CommandClass::ReadOnly | CommandClass::Test => {
            let timeout = match resolve_run_command_timeout(input.timeout_ms) {
                Ok(timeout) => timeout,
                Err(error) => {
                    return ToolExecutionSummary {
                        status: "failed".to_string(),
                        summary: error,
                        output_ref: None,
                    };
                }
            };
            let parsed = match parse_command_for_execution(command) {
                Ok(parsed) => parsed,
                Err(error) => {
                    return ToolExecutionSummary {
                        status: "failed".to_string(),
                        summary: format!("run_command was not executed: {error}"),
                        output_ref: None,
                    };
                }
            };
            let Some(executable) = resolve_agent_command_executable(&parsed.executable) else {
                return ToolExecutionSummary {
                    status: "failed".to_string(),
                    summary: format!(
                        "run_command was not executed: executable '{}' was not found.",
                        parsed.executable
                    ),
                    output_ref: None,
                };
            };
            let args = parsed.args.iter().map(String::as_str).collect::<Vec<_>>();
            match run_command_with_timeout(&executable, &args, workspace_root, timeout) {
                Ok(result) => {
                    let output_ref = store_tool_output_ref("run_command", &result.output);
                    let status = if result.exit_code == Some(0) {
                        "succeeded"
                    } else {
                        "failed"
                    };
                    ToolExecutionSummary {
                        status: status.to_string(),
                        summary: format!(
                            "run_command executed Level {} command `{}`; exit={}; output={} bytes{}.",
                            classification.level,
                            command_preview(command),
                            result
                                .exit_code
                                .map(|code| code.to_string())
                                .unwrap_or_else(|| "timeout".to_string()),
                            result.output.len(),
                            if result.truncated { " (truncated/ref)" } else { "" }
                        ),
                        output_ref: Some(output_ref),
                    }
                }
                Err(error) => ToolExecutionSummary {
                    status: "failed".to_string(),
                    summary: format!(
                        "run_command failed to execute `{}`: {error}",
                        command_preview(command)
                    ),
                    output_ref: None,
                },
            }
        }
        CommandClass::ProjectScript | CommandClass::RequiresConfirmation => ToolExecutionSummary {
            status: "failed".to_string(),
            summary: format!(
                "run_command refused to execute Level {} command `{}`. {}",
                classification.level,
                command_preview(command),
                classification.reason
            ),
            output_ref: None,
        },
    }
}

fn extract_run_command_payload(
    step: &AiTaskPlanStepPayload,
) -> Option<&crate::commands::contracts::AiRunCommandToolInputPayload> {
    step.tool_inputs.as_ref()?.run_command.as_ref()
}

fn resolve_run_command_timeout(timeout_ms: Option<u64>) -> Result<Duration, String> {
    let Some(timeout_ms) = timeout_ms else {
        return Ok(RUN_COMMAND_DEFAULT_TIMEOUT);
    };

    if !(RUN_COMMAND_MIN_TIMEOUT_MS..=RUN_COMMAND_MAX_TIMEOUT_MS).contains(&timeout_ms) {
        return Err(format!(
            "run_command was not executed: timeoutMs must be between {RUN_COMMAND_MIN_TIMEOUT_MS} and {RUN_COMMAND_MAX_TIMEOUT_MS}."
        ));
    }

    Ok(Duration::from_millis(timeout_ms))
}

fn parse_command_for_execution(command: &str) -> Result<ParsedAgentCommand, String> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return Err("command is empty.".to_string());
    }

    if trimmed.chars().any(is_disallowed_shell_character) {
        return Err(
            "shell syntax is not supported; provide a simple executable plus arguments."
                .to_string(),
        );
    }

    let tokens = trimmed
        .split_whitespace()
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    let Some(executable) = tokens.first() else {
        return Err("command could not be tokenized.".to_string());
    };

    if executable.contains('/') || executable.contains('\\') || executable.contains(':') {
        return Err("executable must be resolved from PATH, not a direct path.".to_string());
    }

    Ok(ParsedAgentCommand {
        executable: executable.to_string(),
        args: tokens.into_iter().skip(1).collect(),
    })
}

fn is_disallowed_shell_character(character: char) -> bool {
    matches!(
        character,
        '|' | '&' | ';' | '<' | '>' | '`' | '$' | '(' | ')' | '{' | '}' | '"' | '\'' | '\n' | '\r'
    )
}

fn resolve_agent_command_executable(executable: &str) -> Option<std::path::PathBuf> {
    if executable.eq_ignore_ascii_case("pnpm") {
        return resolve_pnpm_command();
    }

    command_executable_candidates(executable)
        .into_iter()
        .find_map(|candidate| find_command_path(&candidate, &[]))
}

fn command_executable_candidates(executable: &str) -> Vec<String> {
    let name = executable.trim();
    if !cfg!(windows) || name.contains('.') {
        return vec![name.to_string()];
    }

    vec![
        format!("{name}.exe"),
        format!("{name}.cmd"),
        name.to_string(),
    ]
}

fn command_preview(command: &str) -> String {
    let normalized = command.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.chars().count() <= RUN_COMMAND_PREVIEW_CHARS {
        return normalized;
    }

    let preview = normalized
        .chars()
        .take(RUN_COMMAND_PREVIEW_CHARS)
        .collect::<String>();
    format!("{preview}...")
}

struct ParsedAgentCommand {
    executable: String,
    args: Vec<String>,
}
fn execute_stage_file_gate(
    step: &AiTaskPlanStepPayload,
    workspace_root: &Path,
) -> ToolExecutionSummary {
    let Some(input) = step
        .tool_inputs
        .as_ref()
        .and_then(|items| items.stage_file.as_ref())
    else {
        return ToolExecutionSummary {
            status: "failed".to_string(),
            summary: "stage_file was not executed: missing schema-validated file paths payload."
                .to_string(),
            output_ref: None,
        };
    };

    if input.reason.trim().is_empty() || input.paths.is_empty() || input.paths.len() > 32 {
        return ToolExecutionSummary {
            status: "failed".to_string(),
            summary:
                "stage_file was not executed: reason is required and paths must contain 1~32 items."
                    .to_string(),
            output_ref: None,
        };
    }

    let repository = match Repository::discover(workspace_root) {
        Ok(repository) => repository,
        Err(error) => {
            return ToolExecutionSummary {
                status: "failed".to_string(),
                summary: format!("stage_file failed to discover Git repository: {error}"),
                output_ref: None,
            };
        }
    };

    let workdir = repository.workdir().unwrap_or(workspace_root);
    let mut git_paths = Vec::new();
    for path in &input.paths {
        let path = match validate_stage_path(path, workspace_root, workdir) {
            Ok(path) => path,
            Err(error) => {
                return ToolExecutionSummary {
                    status: "failed".to_string(),
                    summary: format!("stage_file was not executed: {error}"),
                    output_ref: None,
                };
            }
        };
        git_paths.push(path);
    }

    let mut index = match repository.index() {
        Ok(index) => index,
        Err(error) => {
            return ToolExecutionSummary {
                status: "failed".to_string(),
                summary: format!("stage_file failed to open Git index: {error}"),
                output_ref: None,
            };
        }
    };

    for path in &git_paths {
        if let Err(error) = index.add_path(path) {
            return ToolExecutionSummary {
                status: "failed".to_string(),
                summary: format!("stage_file failed to stage {}: {error}", path.display()),
                output_ref: None,
            };
        }
    }

    if let Err(error) = index.write() {
        return ToolExecutionSummary {
            status: "failed".to_string(),
            summary: format!("stage_file failed to write Git index: {error}"),
            output_ref: None,
        };
    }

    ToolExecutionSummary {
        status: "succeeded".to_string(),
        summary: format!(
            "stage_file staged {} file(s): {}.",
            git_paths.len(),
            git_paths
                .iter()
                .take(5)
                .map(|path| path.to_string_lossy().replace('\\', "/"))
                .collect::<Vec<_>>()
                .join(", ")
        ),
        output_ref: Some("agent-tool-result:stage-file".to_string()),
    }
}

fn execute_create_commit_gate(
    step: &AiTaskPlanStepPayload,
    workspace_root: &Path,
) -> ToolExecutionSummary {
    let Some(input) = step
        .tool_inputs
        .as_ref()
        .and_then(|items| items.create_commit.as_ref())
    else {
        return ToolExecutionSummary {
            status: "failed".to_string(),
            summary: "create_commit was not executed: missing schema-validated commit payload."
                .to_string(),
            output_ref: None,
        };
    };

    let message = input.message.trim();
    if message.is_empty() || input.reason.trim().is_empty() {
        return ToolExecutionSummary {
            status: "failed".to_string(),
            summary: "create_commit was not executed: message and reason are required.".to_string(),
            output_ref: None,
        };
    }

    let repository = match Repository::discover(workspace_root) {
        Ok(repository) => repository,
        Err(error) => {
            return ToolExecutionSummary {
                status: "failed".to_string(),
                summary: format!("create_commit failed to discover Git repository: {error}"),
                output_ref: None,
            };
        }
    };

    let mut index = match repository.index() {
        Ok(index) => index,
        Err(error) => {
            return ToolExecutionSummary {
                status: "failed".to_string(),
                summary: format!("create_commit failed to open Git index: {error}"),
                output_ref: None,
            };
        }
    };

    if index.is_empty() {
        return ToolExecutionSummary {
            status: "failed".to_string(),
            summary: "create_commit was not executed: Git index is empty.".to_string(),
            output_ref: None,
        };
    }

    let tree_id = match index.write_tree() {
        Ok(tree_id) => tree_id,
        Err(error) => {
            return ToolExecutionSummary {
                status: "failed".to_string(),
                summary: format!("create_commit failed to write tree: {error}"),
                output_ref: None,
            };
        }
    };
    let tree = match repository.find_tree(tree_id) {
        Ok(tree) => tree,
        Err(error) => {
            return ToolExecutionSummary {
                status: "failed".to_string(),
                summary: format!("create_commit failed to load tree: {error}"),
                output_ref: None,
            };
        }
    };

    let parent = repository
        .head()
        .ok()
        .and_then(|head| head.target())
        .and_then(|oid| repository.find_commit(oid).ok());
    if parent
        .as_ref()
        .is_some_and(|commit| commit.tree_id() == tree_id)
        && input.allow_empty != Some(true)
    {
        return ToolExecutionSummary {
            status: "failed".to_string(),
            summary: "create_commit was not executed: staged tree has no changes.".to_string(),
            output_ref: None,
        };
    }

    let signature = match repository
        .signature()
        .or_else(|_| Signature::now("AI Agent", "ai-agent@localhost"))
    {
        Ok(signature) => signature,
        Err(error) => {
            return ToolExecutionSummary {
                status: "failed".to_string(),
                summary: format!("create_commit failed to create signature: {error}"),
                output_ref: None,
            };
        }
    };
    let parents = parent.iter().collect::<Vec<_>>();
    let commit_id = match repository.commit(
        Some("HEAD"),
        &signature,
        &signature,
        message,
        &tree,
        &parents,
    ) {
        Ok(commit_id) => commit_id,
        Err(error) => {
            return ToolExecutionSummary {
                status: "failed".to_string(),
                summary: format!("create_commit failed: {error}"),
                output_ref: None,
            };
        }
    };

    ToolExecutionSummary {
        status: "succeeded".to_string(),
        summary: format!(
            "create_commit created local commit {} with message `{}`.",
            commit_id,
            command_preview(message)
        ),
        output_ref: Some(format!("agent-tool-result:create-commit:{commit_id}")),
    }
}

fn validate_stage_path(
    value: &str,
    workspace_root: &Path,
    git_workdir: &Path,
) -> Result<PathBuf, String> {
    let trimmed = value.trim().replace('\\', "/");
    if trimmed.is_empty() {
        return Err("path is empty.".to_string());
    }
    let relative = Path::new(&trimmed);
    if relative.is_absolute()
        || relative.components().any(|item| {
            matches!(
                item,
                Component::ParentDir | Component::Prefix(_) | Component::RootDir
            )
        })
    {
        return Err(format!(
            "path `{trimmed}` must be a relative workspace path."
        ));
    }
    if relative
        .components()
        .any(|item| matches!(item, Component::Normal(name) if name == ".git"))
    {
        return Err(format!("path `{trimmed}` targets .git and is not allowed."));
    }

    let absolute = workspace_root.join(relative);
    let canonical = absolute
        .canonicalize()
        .map_err(|error| format!("path `{trimmed}` must exist before staging: {error}"))?;
    let canonical_root = workspace_root
        .canonicalize()
        .unwrap_or_else(|_| workspace_root.to_path_buf());
    if !canonical.starts_with(&canonical_root) {
        return Err(format!("path `{trimmed}` is outside workspace."));
    }
    if canonical.is_dir() {
        return Err(format!(
            "path `{trimmed}` is a directory; stage files explicitly."
        ));
    }

    let canonical_git_workdir = git_workdir
        .canonicalize()
        .unwrap_or_else(|_| git_workdir.to_path_buf());
    canonical
        .strip_prefix(canonical_git_workdir)
        .map(Path::to_path_buf)
        .map_err(|_| format!("path `{trimmed}` is outside Git worktree."))
}
fn execute_run_test_gate(workspace_root: &Path) -> ToolExecutionSummary {
    let scripts = package_scripts(workspace_root);
    let test_scripts = scripts
        .iter()
        .filter(|script| script.0.contains("test"))
        .collect::<Vec<_>>();

    if test_scripts.is_empty() {
        return ToolExecutionSummary {
            status: "failed".to_string(),
            summary: "run_test found no package.json test script.".to_string(),
            output_ref: None,
        };
    }

    let selected = test_scripts
        .iter()
        .find(|script| script.0 == "test")
        .copied()
        .unwrap_or(test_scripts[0]);
    let command_ref = format!("pnpm run {}", selected.0);
    let Some(pnpm_path) = resolve_pnpm_command() else {
        return ToolExecutionSummary {
            status: "failed".to_string(),
            summary: format!("{command_ref} 未执行：未找到 pnpm。"),
            output_ref: None,
        };
    };

    let execution = run_command_with_timeout(
        &pnpm_path,
        &["run", selected.0.as_str()],
        workspace_root,
        RUN_TEST_TIMEOUT,
    );

    match execution {
        Ok(result) => {
            let output_ref = store_tool_output_ref("run_test", &result.output);
            let status = if result.exit_code == Some(0) {
                "succeeded"
            } else {
                "failed"
            };
            ToolExecutionSummary {
                status: status.to_string(),
                summary: format!(
                    "{command_ref} 执行完成，exit={}，输出 {} bytes{}。",
                    result
                        .exit_code
                        .map(|code| code.to_string())
                        .unwrap_or_else(|| "unknown".to_string()),
                    result.output.len(),
                    if result.truncated {
                        "（已截断保存）"
                    } else {
                        ""
                    }
                ),
                output_ref: Some(output_ref),
            }
        }
        Err(error) => ToolExecutionSummary {
            status: "failed".to_string(),
            summary: format!("{command_ref} 执行失败：{error}"),
            output_ref: None,
        },
    }
}

fn execute_project_tree(workspace_root: &Path) -> ToolExecutionSummary {
    let mut files = 0usize;
    let mut directories = 0usize;
    if let Ok(entries) = fs::read_dir(workspace_root) {
        for entry in entries.flatten() {
            if entry.file_type().is_ok_and(|file_type| file_type.is_dir()) {
                directories += 1;
            } else {
                files += 1;
            }
        }
    }

    ToolExecutionSummary {
        status: "succeeded".to_string(),
        summary: format!("Project tree root has {directories} directories and {files} files."),
        output_ref: Some("agent-tool-result:project-tree-root".to_string()),
    }
}

fn execute_list_open_files(references: &[AiContextReferencePayload]) -> ToolExecutionSummary {
    let files = references
        .iter()
        .filter_map(|reference| reference.path.as_deref())
        .filter(|path| !path.trim().is_empty())
        .collect::<std::collections::BTreeSet<_>>();

    ToolExecutionSummary {
        status: "succeeded".to_string(),
        summary: format!("Detected {} open/attached file references.", files.len()),
        output_ref: Some("agent-tool-result:open-files".to_string()),
    }
}

fn execute_package_scripts(workspace_root: &Path) -> ToolExecutionSummary {
    let scripts = package_scripts(workspace_root);
    ToolExecutionSummary {
        status: "succeeded".to_string(),
        summary: format!("Found {} package scripts.", scripts.len()),
        output_ref: Some("agent-tool-result:package-scripts".to_string()),
    }
}

fn execute_test_targets(workspace_root: &Path) -> ToolExecutionSummary {
    let scripts = package_scripts(workspace_root);
    let test_count = scripts
        .iter()
        .filter(|script| script.0.contains("test"))
        .count();
    ToolExecutionSummary {
        status: "succeeded".to_string(),
        summary: format!("Found {test_count} test-related package scripts."),
        output_ref: Some("agent-tool-result:test-targets".to_string()),
    }
}

fn package_scripts(workspace_root: &Path) -> Vec<(String, String)> {
    let package_json = workspace_root.join("package.json");
    let Ok(content) = fs::read_to_string(package_json) else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&content) else {
        return Vec::new();
    };
    let Some(scripts) = value.get("scripts").and_then(serde_json::Value::as_object) else {
        return Vec::new();
    };

    scripts
        .iter()
        .filter_map(|(name, command)| {
            command
                .as_str()
                .map(|command| (name.clone(), command.to_string()))
        })
        .collect()
}

fn resolve_pnpm_command() -> Option<std::path::PathBuf> {
    if cfg!(windows) {
        find_command_path("pnpm.cmd", &[])
            .or_else(|| find_command_path("pnpm.exe", &[]))
            .or_else(|| find_command_path("pnpm", &[]))
    } else {
        find_command_path("pnpm", &[])
    }
}

fn run_command_with_timeout(
    executable: &Path,
    args: &[&str],
    cwd: &Path,
    timeout: Duration,
) -> Result<CommandExecution, String> {
    let mut command = Command::new(executable);
    command
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_std_command_for_background(&mut command);

    let mut child = command
        .spawn()
        .map_err(|error| format!("启动命令失败：{error}"))?;
    let started_at = Instant::now();

    loop {
        match child.try_wait() {
            Ok(Some(_status)) => {
                break;
            }
            Ok(None) => {
                if started_at.elapsed() >= timeout {
                    let _ = child.kill();
                    let output = child
                        .wait_with_output()
                        .map_err(|error| format!("读取超时命令输出失败：{error}"))?;
                    let (output, truncated) =
                        normalize_command_output(output.stdout, output.stderr);
                    return Ok(CommandExecution {
                        exit_code: None,
                        output,
                        truncated,
                    });
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(error) => return Err(format!("等待命令失败：{error}")),
        }
    }

    let output = child
        .wait_with_output()
        .map_err(|error| format!("读取命令输出失败：{error}"))?;
    let exit_code = output.status.code();
    let (output, truncated) = normalize_command_output(output.stdout, output.stderr);

    Ok(CommandExecution {
        exit_code,
        output,
        truncated,
    })
}

fn normalize_command_output(stdout: Vec<u8>, stderr: Vec<u8>) -> (String, bool) {
    let mut output = String::new();
    if !stdout.is_empty() {
        output.push_str("[stdout]\n");
        output.push_str(&String::from_utf8_lossy(&stdout));
    }
    if !stderr.is_empty() {
        if !output.is_empty() {
            output.push('\n');
        }
        output.push_str("[stderr]\n");
        output.push_str(&String::from_utf8_lossy(&stderr));
    }

    truncate_head_tail(&output, MAX_TOOL_OUTPUT_BYTES)
}

fn truncate_head_tail(value: &str, max_bytes: usize) -> (String, bool) {
    if value.len() <= max_bytes {
        return (value.to_string(), false);
    }

    let head = take_prefix_at_char_boundary(value, TOOL_OUTPUT_HEAD_BYTES);
    let tail_start = value
        .len()
        .saturating_sub(TOOL_OUTPUT_TAIL_BYTES)
        .min(value.len());
    let tail_start = next_char_boundary(value, tail_start);
    let tail = &value[tail_start..];

    (
        format!(
            "{head}\n\n--- output truncated: {} bytes omitted ---\n\n{tail}",
            value.len().saturating_sub(head.len() + tail.len())
        ),
        true,
    )
}

fn take_prefix_at_char_boundary(value: &str, max_bytes: usize) -> &str {
    let end = previous_char_boundary(value, max_bytes.min(value.len()));
    &value[..end]
}

fn previous_char_boundary(value: &str, index: usize) -> usize {
    let mut cursor = index.min(value.len());
    while cursor > 0 && !value.is_char_boundary(cursor) {
        cursor -= 1;
    }
    cursor
}

fn next_char_boundary(value: &str, index: usize) -> usize {
    let mut cursor = index.min(value.len());
    while cursor < value.len() && !value.is_char_boundary(cursor) {
        cursor += 1;
    }
    cursor
}

fn store_tool_output_ref(tool_name: &str, output: &str) -> String {
    let id = format!(
        "agent-tool-output:{tool_name}:{}",
        chrono::Utc::now().timestamp_micros()
    );
    if let Ok(mut guard) = tool_output_refs().lock() {
        guard.insert(id.clone(), output.to_string());
    }
    id
}

struct CommandExecution {
    exit_code: Option<i32>,
    output: String,
    truncated: bool,
}

struct ToolExecutionSummary {
    status: String,
    summary: String,
    output_ref: Option<String>,
}

fn execute_search_files(
    step: &AiTaskPlanStepPayload,
    workspace_root: &Path,
) -> ToolExecutionSummary {
    let query = derive_query(step);
    let normalized_query = query.to_lowercase();
    let mut scanned = 0usize;
    let mut matched = 0usize;

    for entry in WalkBuilder::new(workspace_root)
        .standard_filters(true)
        .hidden(false)
        .follow_links(false)
        .build()
        .filter_map(Result::ok)
    {
        if scanned >= MAX_SCAN_FILES {
            break;
        }
        if !entry
            .file_type()
            .is_some_and(|file_type| file_type.is_file())
        {
            continue;
        }

        scanned += 1;
        let relative = relative_path(workspace_root, &entry.into_path());
        if relative.to_lowercase().contains(&normalized_query) {
            matched += 1;
        }
    }

    ToolExecutionSummary {
        status: "succeeded".to_string(),
        summary: format!("Scanned {scanned} file names; query '{query}' matched {matched} files."),
        output_ref: Some(format!(
            "agent-tool-result:{}:{}:search_files",
            step.id, scanned
        )),
    }
}

fn execute_search_text(
    step: &AiTaskPlanStepPayload,
    workspace_root: &Path,
) -> ToolExecutionSummary {
    let query = derive_query(step);
    let normalized_query = query.to_lowercase();
    let mut scanned = 0usize;
    let mut matched_files = 0usize;
    let mut matched_lines = 0usize;

    for entry in WalkBuilder::new(workspace_root)
        .standard_filters(true)
        .hidden(false)
        .follow_links(false)
        .build()
        .filter_map(Result::ok)
    {
        if scanned >= MAX_SCAN_FILES {
            break;
        }
        if !entry
            .file_type()
            .is_some_and(|file_type| file_type.is_file())
        {
            continue;
        }

        let path = entry.into_path();
        if !is_small_text_candidate(&path) {
            continue;
        }
        scanned += 1;

        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };

        let mut file_matched = false;
        for line in content.lines() {
            if line.to_lowercase().contains(&normalized_query) {
                matched_lines += 1;
                file_matched = true;
            }
        }
        if file_matched {
            matched_files += 1;
        }
    }

    ToolExecutionSummary {
        status: "succeeded".to_string(),
        summary: format!(
            "Scanned {scanned} text files; query '{query}' matched {matched_files} files / {matched_lines} lines."
        ),
        output_ref: Some(format!(
            "agent-tool-result:{}:{}:search_text",
            step.id, scanned
        )),
    }
}

fn execute_get_git_diff(workspace_root: &Path) -> ToolExecutionSummary {
    let repository = match Repository::discover(workspace_root) {
        Ok(repository) => repository,
        Err(error) => {
            return ToolExecutionSummary {
                status: "failed".to_string(),
                summary: format!("Failed to read Git status: {error}"),
                output_ref: None,
            };
        }
    };

    let mut options = StatusOptions::new();
    options
        .include_untracked(true)
        .include_ignored(false)
        .include_unmodified(false)
        .recurse_untracked_dirs(true);

    let statuses = match repository.statuses(Some(&mut options)) {
        Ok(statuses) => statuses,
        Err(error) => {
            return ToolExecutionSummary {
                status: "failed".to_string(),
                summary: format!("Failed to read Git diff summary: {error}"),
                output_ref: None,
            };
        }
    };

    let mut staged = 0usize;
    let mut unstaged = 0usize;
    let mut untracked = 0usize;
    let mut conflicted = 0usize;

    for entry in statuses.iter() {
        let status = entry.status();
        if status.contains(Status::CONFLICTED) {
            conflicted += 1;
            continue;
        }
        if status.contains(Status::WT_NEW) && !status.contains(Status::INDEX_NEW) {
            untracked += 1;
            continue;
        }
        if status.intersects(
            Status::INDEX_NEW
                | Status::INDEX_MODIFIED
                | Status::INDEX_DELETED
                | Status::INDEX_RENAMED
                | Status::INDEX_TYPECHANGE,
        ) {
            staged += 1;
        }
        if status.intersects(
            Status::WT_MODIFIED | Status::WT_DELETED | Status::WT_RENAMED | Status::WT_TYPECHANGE,
        ) {
            unstaged += 1;
        }
    }

    ToolExecutionSummary {
        status: "succeeded".to_string(),
        summary: format!(
            "Git workspace summary: staged {staged}, unstaged {unstaged}, untracked {untracked}, conflicted {conflicted}."
        ),
        output_ref: Some("agent-tool-result:git-diff-summary".to_string()),
    }
}

fn derive_query(step: &AiTaskPlanStepPayload) -> String {
    let source = if step.title.trim().is_empty() {
        step.goal.as_str()
    } else {
        step.title.as_str()
    };
    let mut query = source
        .chars()
        .filter(|character| {
            character.is_alphanumeric() || matches!(character, '_' | '-' | '/' | '.')
        })
        .take(48)
        .collect::<String>();

    if query.trim().is_empty() {
        query = "agent".to_string();
    }

    query
}

fn is_small_text_candidate(path: &Path) -> bool {
    let Ok(metadata) = fs::metadata(path) else {
        return false;
    };
    if metadata.len() > MAX_TEXT_FILE_BYTES {
        return false;
    }

    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_lowercase());

    matches!(
        extension.as_deref(),
        Some(
            "rs" | "ts"
                | "tsx"
                | "js"
                | "jsx"
                | "vue"
                | "json"
                | "md"
                | "toml"
                | "yaml"
                | "yml"
                | "css"
                | "html"
                | "sh"
                | "bash"
        )
    )
}

fn relative_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::{
        build_tool_result_messages, truncate_head_tail, validate_step_tools, AgentRunMessage,
        AgentToolUseContext,
    };
    use crate::commands::contracts::{
        AiAgentToolInputsPayload, AiCreateCommitToolInputPayload, AiRunCommandToolInputPayload,
        AiStageFileToolInputPayload, AiTaskPlanStepPayload,
    };
    use std::collections::HashMap;
    use std::fs;

    fn step_with_tools(tools: Vec<&str>) -> AiTaskPlanStepPayload {
        AiTaskPlanStepPayload {
            id: "step-1".to_string(),
            index: 0,
            title: "check tools".to_string(),
            goal: "check tools".to_string(),
            kind: "inspect".to_string(),
            status: "running".to_string(),
            expected_output: "tool validation result".to_string(),
            tools: tools.into_iter().map(ToOwned::to_owned).collect(),
            tool_inputs: None,
            references: None,
            is_active: Some(true),
            requires_user_approval: false,
            risk_level: "low".to_string(),
            rollback_strategy: None,
        }
    }

    fn step_with_run_command(command: &str) -> AiTaskPlanStepPayload {
        let mut step = step_with_tools(vec!["run_command"]);
        step.tool_inputs = Some(AiAgentToolInputsPayload {
            run_command: Some(AiRunCommandToolInputPayload {
                command: command.to_string(),
                reason: "unit test command execution".to_string(),
                cwd_policy: "workspace-root".to_string(),
                timeout_ms: Some(30_000),
            }),
            stage_file: None,
            create_commit: None,
        });
        step
    }

    fn step_with_stage_file(paths: Vec<&str>) -> AiTaskPlanStepPayload {
        let mut step = step_with_tools(vec!["stage_file"]);
        step.tool_inputs = Some(AiAgentToolInputsPayload {
            run_command: None,
            stage_file: Some(AiStageFileToolInputPayload {
                paths: paths.into_iter().map(ToOwned::to_owned).collect(),
                reason: "unit test staging".to_string(),
            }),
            create_commit: None,
        });
        step
    }

    fn step_with_create_commit(message: &str) -> AiTaskPlanStepPayload {
        let mut step = step_with_tools(vec!["create_commit"]);
        step.tool_inputs = Some(AiAgentToolInputsPayload {
            run_command: None,
            stage_file: None,
            create_commit: Some(AiCreateCommitToolInputPayload {
                message: message.to_string(),
                reason: "unit test commit".to_string(),
                allow_empty: None,
            }),
        });
        step
    }

    #[test]
    fn rejects_unknown_tool_before_execution() {
        let step = step_with_tools(vec!["unknown_tool"]);

        let error = validate_step_tools(&step).expect_err("unknown tool should be rejected");

        assert!(error.contains("AI_AGENT_TOOL_NOT_ALLOWED"));
    }

    #[test]
    fn creates_ref_only_tool_result_messages() {
        let step = step_with_tools(vec!["search_text"]);
        let context = AgentToolUseContext {
            run_id: "run-1".to_string(),
            step_id: "step-1".to_string(),
            permission_level: "standard".to_string(),
            workspace_root: None,
            references: Vec::new(),
            tool_decisions: HashMap::new(),
        };

        let messages = build_tool_result_messages(&context, &step).expect("messages");

        assert_eq!(messages.len(), 1);
        let serialized = format!("{messages:?}");
        assert!(serialized.contains("search_text"));
        assert!(!serialized.contains("```"));
    }

    #[test]
    fn confirmed_run_test_reaches_real_executor_gate() {
        let workspace_root = std::env::temp_dir().join(format!(
            "calamex-agent-run-test-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        fs::create_dir_all(&workspace_root).expect("workspace should be created");
        let step = step_with_tools(vec!["run_test"]);
        let mut tool_decisions = HashMap::new();
        tool_decisions.insert("run_test".to_string(), "allow-once".to_string());
        let context = AgentToolUseContext {
            run_id: "run-1".to_string(),
            step_id: "step-1".to_string(),
            permission_level: "standard".to_string(),
            workspace_root: Some(workspace_root.to_string_lossy().to_string()),
            references: Vec::new(),
            tool_decisions,
        };

        let messages = build_tool_result_messages(&context, &step).expect("messages");

        let _ = fs::remove_dir_all(&workspace_root);
        let AgentRunMessage::ToolResult(result) = &messages[0];
        assert_eq!(result.tool_name, "run_test");
        assert!(result.summary.contains("package.json test script"));
        assert!(!result.summary.contains("requires inline user confirmation"));
    }

    #[test]
    fn head_tail_truncation_keeps_utf8_boundaries() {
        let content = "测".repeat(30_000);

        let (truncated, was_truncated) = truncate_head_tail(&content, 1024);

        assert!(was_truncated);
        assert!(truncated.is_char_boundary(truncated.len()));
        assert!(truncated.contains("output truncated"));
    }

    #[test]
    fn confirmed_run_command_requires_structured_payload() {
        let step = step_with_tools(vec!["run_command"]);
        let mut tool_decisions = HashMap::new();
        tool_decisions.insert("run_command".to_string(), "allow-once".to_string());
        let context = AgentToolUseContext {
            run_id: "run-1".to_string(),
            step_id: "step-1".to_string(),
            permission_level: "standard".to_string(),
            workspace_root: None,
            references: Vec::new(),
            tool_decisions,
        };

        let messages = build_tool_result_messages(&context, &step).expect("messages");

        let AgentRunMessage::ToolResult(result) = &messages[0];
        assert_eq!(result.tool_name, "run_command");
        assert_eq!(result.status, "failed");
        assert!(result.summary.contains("schema"));
        assert!(!result.summary.contains("静默成功"));
    }
    #[test]
    fn confirmed_run_command_blocks_destructive_payload() {
        let step = step_with_run_command("git reset --hard HEAD");
        let mut tool_decisions = HashMap::new();
        tool_decisions.insert("run_command".to_string(), "allow-once".to_string());
        let context = AgentToolUseContext {
            run_id: "run-1".to_string(),
            step_id: "step-1".to_string(),
            permission_level: "standard".to_string(),
            workspace_root: None,
            references: Vec::new(),
            tool_decisions,
        };

        let messages = build_tool_result_messages(&context, &step).expect("messages");

        let AgentRunMessage::ToolResult(result) = &messages[0];
        assert_eq!(result.tool_name, "run_command");
        assert_eq!(result.status, "failed");
        assert!(result.summary.contains("blocked"));
        assert!(result.output_ref.is_none());
    }

    #[test]
    fn confirmed_run_command_executes_level_two_command() {
        let workspace_root = std::env::temp_dir().join(format!(
            "calamex-agent-run-command-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        fs::create_dir_all(&workspace_root).expect("workspace should be created");
        let step = step_with_run_command("cargo test --help");
        let mut tool_decisions = HashMap::new();
        tool_decisions.insert("run_command".to_string(), "allow-once".to_string());
        let context = AgentToolUseContext {
            run_id: "run-1".to_string(),
            step_id: "step-1".to_string(),
            permission_level: "standard".to_string(),
            workspace_root: Some(workspace_root.to_string_lossy().to_string()),
            references: Vec::new(),
            tool_decisions,
        };

        let messages = build_tool_result_messages(&context, &step).expect("messages");

        let _ = fs::remove_dir_all(&workspace_root);
        let AgentRunMessage::ToolResult(result) = &messages[0];
        assert_eq!(result.tool_name, "run_command");
        assert!(result.summary.contains("Level 2"));
        assert!(result.output_ref.is_some());
        assert!(!result.summary.contains("[stdout]"));
    }
    #[test]
    fn confirmed_stage_file_stages_existing_workspace_file() {
        let workspace_root = std::env::temp_dir().join(format!(
            "calamex-agent-stage-file-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        fs::create_dir_all(&workspace_root).expect("workspace should be created");
        let repository = git2::Repository::init(&workspace_root).expect("repo should init");
        fs::write(workspace_root.join("tracked.txt"), "hello").expect("file should be written");
        let step = step_with_stage_file(vec!["tracked.txt"]);
        let mut tool_decisions = HashMap::new();
        tool_decisions.insert("stage_file".to_string(), "allow-once".to_string());
        let context = AgentToolUseContext {
            run_id: "run-1".to_string(),
            step_id: "step-1".to_string(),
            permission_level: "standard".to_string(),
            workspace_root: Some(workspace_root.to_string_lossy().to_string()),
            references: Vec::new(),
            tool_decisions,
        };

        let messages = build_tool_result_messages(&context, &step).expect("messages");

        let index = repository.index().expect("index should open");
        let _ = fs::remove_dir_all(&workspace_root);
        let AgentRunMessage::ToolResult(result) = &messages[0];
        assert_eq!(result.tool_name, "stage_file");
        assert_eq!(result.status, "succeeded", "{}", result.summary);
        assert!(result.summary.contains("staged 1"));
        assert_eq!(index.len(), 1);
    }

    #[test]
    fn confirmed_create_commit_creates_local_commit_from_staged_file() {
        let workspace_root = std::env::temp_dir().join(format!(
            "calamex-agent-create-commit-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        fs::create_dir_all(&workspace_root).expect("workspace should be created");
        let repository = git2::Repository::init(&workspace_root).expect("repo should init");
        fs::write(workspace_root.join("tracked.txt"), "hello").expect("file should be written");
        let mut index = repository.index().expect("index should open");
        index
            .add_path(std::path::Path::new("tracked.txt"))
            .expect("file should stage");
        index.write().expect("index should write");
        let step = step_with_create_commit("test: agent commit");
        let mut tool_decisions = HashMap::new();
        tool_decisions.insert("create_commit".to_string(), "allow-once".to_string());
        let context = AgentToolUseContext {
            run_id: "run-1".to_string(),
            step_id: "step-1".to_string(),
            permission_level: "standard".to_string(),
            workspace_root: Some(workspace_root.to_string_lossy().to_string()),
            references: Vec::new(),
            tool_decisions,
        };

        let messages = build_tool_result_messages(&context, &step).expect("messages");

        let head = repository.head().expect("head should exist after commit");
        let _ = fs::remove_dir_all(&workspace_root);
        let AgentRunMessage::ToolResult(result) = &messages[0];
        assert_eq!(result.tool_name, "create_commit");
        assert_eq!(result.status, "succeeded");
        assert!(result.summary.contains("created local commit"));
        assert!(head.target().is_some());
    }
}
