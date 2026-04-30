use crate::ai_security::destructive_patterns::find_destructive_pattern;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CommandClass {
    ReadOnly,
    Test,
    ProjectScript,
    RequiresConfirmation,
    Blocked,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandClassification {
    pub class: CommandClass,
    pub level: u8,
    pub reason: String,
    pub destructive_pattern: Option<String>,
}

pub fn classify_command(command: &str) -> CommandClassification {
    let normalized = normalize_command(command);

    if normalized.is_empty() {
        return blocked("命令为空。", None);
    }

    if let Some(pattern) = find_destructive_pattern(&normalized) {
        return blocked("命中破坏性命令模式。", Some(pattern.to_string()));
    }

    if let Some(seconds) = standalone_sleep_seconds(&normalized) {
        if seconds > 2 {
            return blocked(
                "standalone sleep 超过 2 秒，应使用后台观察或轮询工具。",
                None,
            );
        }
        return CommandClassification {
            class: CommandClass::ReadOnly,
            level: 1,
            reason: "短 sleep 用于轻量等待。".to_string(),
            destructive_pattern: None,
        };
    }

    let tokens = tokenize_command(&normalized);
    let Some(first) = tokens.first().map(String::as_str) else {
        return blocked("命令无法解析。", None);
    };

    if is_read_only_command(first, &tokens) {
        return CommandClassification {
            class: CommandClass::ReadOnly,
            level: 1,
            reason: "识别为只读/搜索/列表命令。".to_string(),
            destructive_pattern: None,
        };
    }

    if is_test_command(first, &tokens) {
        return CommandClassification {
            class: CommandClass::Test,
            level: 2,
            reason: "识别为测试/检查命令，第一版允许在确认后执行。".to_string(),
            destructive_pattern: None,
        };
    }

    if is_project_script_command(first, &tokens) {
        return CommandClassification {
            class: CommandClass::ProjectScript,
            level: 3,
            reason: "识别为项目脚本命令，第一版 run_command 不直接执行。".to_string(),
            destructive_pattern: None,
        };
    }

    CommandClassification {
        class: CommandClass::RequiresConfirmation,
        level: 4,
        reason: "未知命令需要更高权限；第一版 run_command 不执行任意命令。".to_string(),
        destructive_pattern: None,
    }
}

fn blocked(reason: &str, destructive_pattern: Option<String>) -> CommandClassification {
    CommandClassification {
        class: CommandClass::Blocked,
        level: 4,
        reason: reason.to_string(),
        destructive_pattern,
    }
}

fn normalize_command(command: &str) -> String {
    command.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn tokenize_command(command: &str) -> Vec<String> {
    command
        .split_whitespace()
        .map(|token| {
            token
                .trim_matches('"')
                .trim_matches('\'')
                .to_ascii_lowercase()
        })
        .collect()
}

fn standalone_sleep_seconds(command: &str) -> Option<u64> {
    let tokens = tokenize_command(command);
    if tokens.len() != 2 || tokens.first().map(String::as_str) != Some("sleep") {
        return None;
    }

    tokens.get(1)?.parse::<u64>().ok()
}

fn is_read_only_command(first: &str, tokens: &[String]) -> bool {
    matches!(
        first,
        "rg" | "grep" | "find" | "cat" | "head" | "tail" | "ls" | "tree" | "pwd" | "wc"
    ) || (first == "git"
        && tokens
            .get(1)
            .is_some_and(|sub| matches!(sub.as_str(), "status" | "diff" | "log" | "show")))
}

fn is_test_command(first: &str, tokens: &[String]) -> bool {
    if first == "cargo" {
        return tokens
            .get(1)
            .is_some_and(|sub| matches!(sub.as_str(), "test" | "check" | "clippy"));
    }

    if matches!(first, "pnpm" | "npm" | "yarn") {
        return tokens.iter().any(|token| token.contains("test"))
            || tokens
                .iter()
                .any(|token| token == "typecheck" || token == "lint");
    }

    false
}

fn is_project_script_command(first: &str, tokens: &[String]) -> bool {
    matches!(first, "pnpm" | "npm" | "yarn")
        && tokens
            .get(1)
            .is_some_and(|sub| matches!(sub.as_str(), "run" | "exec"))
}

#[cfg(test)]
mod tests {
    use super::{classify_command, CommandClass};

    #[test]
    fn classifies_read_only_commands() {
        let result = classify_command("rg Agent src");

        assert_eq!(result.class, CommandClass::ReadOnly);
        assert_eq!(result.level, 1);
    }

    #[test]
    fn classifies_test_commands_as_level_2() {
        let result = classify_command("pnpm run test");

        assert_eq!(result.class, CommandClass::Test);
        assert_eq!(result.level, 2);
    }

    #[test]
    fn blocks_long_standalone_sleep() {
        let result = classify_command("sleep 5");

        assert_eq!(result.class, CommandClass::Blocked);
        assert!(result.reason.contains("sleep"));
    }

    #[test]
    fn blocks_destructive_commands() {
        let result = classify_command("git reset --hard HEAD");

        assert_eq!(result.class, CommandClass::Blocked);
        assert_eq!(
            result.destructive_pattern.as_deref(),
            Some("git reset --hard")
        );
    }
}
