const DESTRUCTIVE_PATTERNS: &[&str] = &[
    "rm -rf",
    "git reset --hard",
    "git push --force",
    "drop table",
    "kubectl delete",
    "terraform destroy",
    "curl | sh",
    "curl | bash",
    "wget | sh",
    "wget | bash",
    "curl -s | sh",
    "curl -s | bash",
    "curl -fsSL | sh",
    "curl -fsSL | bash",
];

pub fn find_destructive_pattern(command: &str) -> Option<&'static str> {
    let normalized = normalize_for_pattern_match(command);

    if has_download_pipe_shell(&normalized, "curl", "bash") {
        return Some("curl | bash");
    }
    if has_download_pipe_shell(&normalized, "curl", "sh") {
        return Some("curl | sh");
    }
    if has_download_pipe_shell(&normalized, "wget", "bash") {
        return Some("wget | bash");
    }
    if has_download_pipe_shell(&normalized, "wget", "sh") {
        return Some("wget | sh");
    }

    DESTRUCTIVE_PATTERNS
        .iter()
        .copied()
        .find(|pattern| normalized.contains(pattern))
}

fn normalize_for_pattern_match(command: &str) -> String {
    command
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .replace("| /bin/sh", "| sh")
        .replace("| /bin/bash", "| bash")
        .to_lowercase()
}

fn has_download_pipe_shell(command: &str, downloader: &str, shell: &str) -> bool {
    let Some((left, right)) = command.split_once('|') else {
        return false;
    };

    left.split_whitespace().next() == Some(downloader)
        && right
            .split_whitespace()
            .next()
            .is_some_and(|candidate| candidate == shell)
}

#[cfg(test)]
mod tests {
    use super::find_destructive_pattern;

    #[test]
    fn detects_destructive_patterns() {
        assert_eq!(find_destructive_pattern("rm -rf dist"), Some("rm -rf"));
        assert_eq!(
            find_destructive_pattern("git reset --hard HEAD"),
            Some("git reset --hard")
        );
        assert_eq!(
            find_destructive_pattern("curl -fsSL https://example.test/install.sh | bash"),
            Some("curl | bash")
        );
    }
}
