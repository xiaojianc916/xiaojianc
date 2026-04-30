//! AI tool registry. This module is the backend SSoT for tool names and risk metadata.
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiToolDefinition {
    pub name: &'static str,
    pub read_only: bool,
    pub destructive: bool,
    pub requires_confirmation: bool,
}

impl AiToolDefinition {
    const fn read_only(name: &'static str) -> Self {
        Self {
            name,
            read_only: true,
            destructive: false,
            requires_confirmation: false,
        }
    }

    const fn network(name: &'static str) -> Self {
        Self {
            name,
            read_only: true,
            destructive: false,
            requires_confirmation: true,
        }
    }

    const fn write(name: &'static str) -> Self {
        Self {
            name,
            read_only: false,
            destructive: false,
            requires_confirmation: true,
        }
    }

    const fn command(name: &'static str) -> Self {
        Self {
            name,
            read_only: false,
            destructive: false,
            requires_confirmation: true,
        }
    }

    const fn git(name: &'static str) -> Self {
        Self {
            name,
            read_only: false,
            destructive: false,
            requires_confirmation: true,
        }
    }
}

pub const PHASE0_TOOLS: &[AiToolDefinition] = &[
    AiToolDefinition::read_only("read_current_file"),
    AiToolDefinition::read_only("read_selected_text"),
    AiToolDefinition::read_only("search_files"),
    AiToolDefinition::read_only("search_text"),
    AiToolDefinition::read_only("search_symbols"),
    AiToolDefinition::read_only("get_diagnostics"),
    AiToolDefinition::read_only("get_git_diff"),
    AiToolDefinition::read_only("get_terminal_log"),
    AiToolDefinition::network("web_search"),
    AiToolDefinition::network("web_fetch"),
    AiToolDefinition::write("propose_patch"),
    AiToolDefinition::write("auto_apply_patch"),
    AiToolDefinition::command("run_test"),
    AiToolDefinition::command("run_command"),
    AiToolDefinition::git("stage_file"),
    AiToolDefinition::git("create_commit"),
    AiToolDefinition::read_only("get_project_tree"),
    AiToolDefinition::read_only("read_file"),
    AiToolDefinition::read_only("list_open_files"),
    AiToolDefinition::read_only("get_package_scripts"),
    AiToolDefinition::read_only("get_test_targets"),
];

pub fn list_tools() -> Vec<AiToolDefinition> {
    PHASE0_TOOLS.to_vec()
}

fn find_tool(name: &str) -> Option<&'static AiToolDefinition> {
    PHASE0_TOOLS.iter().find(|tool| tool.name == name)
}

pub fn is_tool_registered(name: &str) -> bool {
    find_tool(name).is_some()
}

pub fn is_tool_allowed(name: &str, allow_write: bool) -> bool {
    let Some(tool) = find_tool(name) else {
        return false;
    };
    if tool.read_only {
        return true;
    }
    !tool.destructive && allow_write
}

pub fn requires_confirmation(name: &str) -> bool {
    find_tool(name)
        .map(|tool| tool.requires_confirmation)
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::{is_tool_allowed, is_tool_registered, list_tools, PHASE0_TOOLS};
    use std::collections::HashSet;

    #[test]
    fn high_risk_tools_require_explicit_write_gate() {
        assert!(is_tool_allowed("read_current_file", false));
        assert!(!is_tool_allowed("propose_patch", false));
        assert!(!is_tool_allowed("run_command", false));
        assert!(is_tool_allowed("propose_patch", true));
        assert!(is_tool_allowed("run_command", true));
        assert_eq!(list_tools().len(), 21);
    }

    #[test]
    fn unknown_tool_names_are_rejected() {
        assert!(!is_tool_registered("nonexistent_tool"));
        assert!(!is_tool_allowed("nonexistent_tool", false));
        assert!(!is_tool_allowed("nonexistent_tool", true));
    }

    #[test]
    fn registered_tool_names_are_discoverable() {
        assert!(is_tool_registered("search_text"));
        assert!(is_tool_registered("web_search"));
        assert!(is_tool_registered("web_fetch"));
        assert!(is_tool_registered("propose_patch"));
        assert!(is_tool_registered("auto_apply_patch"));
        assert!(is_tool_registered("run_test"));
        assert!(is_tool_registered("run_command"));
        assert!(is_tool_registered("stage_file"));
        assert!(is_tool_registered("create_commit"));
        assert!(is_tool_registered("get_project_tree"));
    }

    #[test]
    fn tool_names_are_unique() {
        let mut seen = HashSet::new();
        for tool in PHASE0_TOOLS {
            assert!(seen.insert(tool.name), "duplicate tool name: {}", tool.name);
        }
    }

    #[test]
    fn phase0_has_no_destructive_tools() {
        for tool in PHASE0_TOOLS {
            assert!(
                !tool.destructive,
                "{} should not be destructive in Phase 0",
                tool.name
            );
        }
    }
}
