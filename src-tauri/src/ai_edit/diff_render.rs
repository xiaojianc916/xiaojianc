//! AED 行级 diff 与 hunk 反向应用工具。
//!
//! 设计要点：
//! - `render_patch_hunks` 基于 LCS 生成稳定的 hunk 序列，连续的增删聚合为一个 hunk。
//! - `apply_reverse_hunk` 在严格内容校验通过后，将单个 hunk 反向作用到「应用后」文本上。
//! - 多 hunk 反向请使用 `apply_reverse_hunks`（内部按 `new_start` 逆序作用），
//!   避免前一个 hunk 的撤销改变后续 hunk 的行偏移。
//! - 行号约定：1-based；`old_lines = 0` 表示纯插入，`new_lines = 0` 表示纯删除。

use crate::commands::contracts::AiPatchHunkPayload;

#[derive(Debug, Clone)]
pub struct RenderedDiff {
    pub additions: u32,
    pub deletions: u32,
    pub hunks: Vec<AiPatchHunkPayload>,
}

#[derive(Debug, Clone)]
enum DiffStep {
    Equal,
    Delete(String),
    Insert(String),
}

/// 渲染 before → after 的行级 diff，按 Equal 切分聚合 hunk。
pub fn render_patch_hunks(before: &str, after: &str) -> RenderedDiff {
    let before_lines = split_text_lines(before);
    let after_lines = split_text_lines(after);
    let steps = build_diff_steps(&before_lines, &after_lines);

    let mut additions = 0u32;
    let mut deletions = 0u32;
    let mut hunks = Vec::new();
    let mut old_line = 1u32;
    let mut new_line = 1u32;
    let mut cursor = 0usize;

    while cursor < steps.len() {
        match &steps[cursor] {
            DiffStep::Equal => {
                old_line += 1;
                new_line += 1;
                cursor += 1;
            }
            DiffStep::Delete(_) | DiffStep::Insert(_) => {
                let old_start = old_line;
                let new_start = new_line;
                let mut old_lines = 0u32;
                let mut new_lines = 0u32;
                let mut lines = Vec::new();

                while cursor < steps.len() {
                    match &steps[cursor] {
                        DiffStep::Equal => break,
                        DiffStep::Delete(line) => {
                            deletions += 1;
                            old_lines += 1;
                            old_line += 1;
                            lines.push(format!("-{line}"));
                        }
                        DiffStep::Insert(line) => {
                            additions += 1;
                            new_lines += 1;
                            new_line += 1;
                            lines.push(format!("+{line}"));
                        }
                    }
                    cursor += 1;
                }

                hunks.push(AiPatchHunkPayload {
                    old_start,
                    old_lines,
                    new_start,
                    new_lines,
                    lines,
                });
            }
        }
    }

    RenderedDiff {
        additions,
        deletions,
        hunks,
    }
}

/// 将单个 hunk 反向作用到「应用后」文本上，恢复对应区段为 before 状态。
///
/// 严格校验：当前文件 `[new_start, new_start + new_lines)` 区段必须与 hunk
/// 中的 `+` 行完全一致，否则报错而不是静默写坏。
pub fn apply_reverse_hunk(after: &str, hunk: &AiPatchHunkPayload) -> Result<String, String> {
    let mut lines = split_text_lines(after);
    let start = hunk.new_start.saturating_sub(1) as usize;
    let new_lines_count = hunk.new_lines as usize;
    let end = start.saturating_add(new_lines_count);

    if start > lines.len() {
        return Err(format!("hunk 起点越界：start={start}, len={}", lines.len()));
    }
    if end > lines.len() {
        return Err(format!(
            "hunk 范围越界：start={start}, end={end}, len={}",
            lines.len()
        ));
    }

    let expected_new_lines = hunk
        .lines
        .iter()
        .filter_map(|line| line.strip_prefix('+').map(ToOwned::to_owned))
        .collect::<Vec<_>>();

    if expected_new_lines.len() != new_lines_count {
        return Err(format!(
            "hunk 自身不一致：new_lines={new_lines_count}，但 + 行数={}",
            expected_new_lines.len()
        ));
    }

    let current_segment = &lines[start..end];
    if current_segment != expected_new_lines.as_slice() {
        return Err("当前文件片段与目标 hunk 不一致。".to_string());
    }

    let restored_lines = hunk
        .lines
        .iter()
        .filter_map(|line| line.strip_prefix('-').map(ToOwned::to_owned))
        .collect::<Vec<_>>();

    lines.splice(start..end, restored_lines);
    Ok(lines.join("\n"))
}

/// 将一组 hunk 一次性反向作用到「应用后」文本上。
///
/// 内部按 `new_start` 降序应用，保证前一次撤销不会污染后续 hunk 的行偏移。
/// 任意 hunk 失败会立即返回，且不会保留半成品（在副本上构建）。
pub fn apply_reverse_hunks(after: &str, hunks: &[AiPatchHunkPayload]) -> Result<String, String> {
    let mut ordered: Vec<&AiPatchHunkPayload> = hunks.iter().collect();
    ordered.sort_by(|a, b| b.new_start.cmp(&a.new_start));

    let mut current = after.to_string();
    for hunk in ordered {
        current = apply_reverse_hunk(&current, hunk)?;
    }
    Ok(current)
}

fn split_text_lines(value: &str) -> Vec<String> {
    if value.is_empty() {
        return Vec::new();
    }
    value.split('\n').map(ToOwned::to_owned).collect()
}

fn build_diff_steps(before: &[String], after: &[String]) -> Vec<DiffStep> {
    let before_len = before.len();
    let after_len = after.len();
    let mut lcs = vec![vec![0usize; after_len + 1]; before_len + 1];

    for before_index in (0..before_len).rev() {
        for after_index in (0..after_len).rev() {
            lcs[before_index][after_index] = if before[before_index] == after[after_index] {
                lcs[before_index + 1][after_index + 1] + 1
            } else {
                lcs[before_index + 1][after_index].max(lcs[before_index][after_index + 1])
            };
        }
    }

    let mut before_index = 0usize;
    let mut after_index = 0usize;
    let mut steps = Vec::new();

    while before_index < before_len && after_index < after_len {
        if before[before_index] == after[after_index] {
            steps.push(DiffStep::Equal);
            before_index += 1;
            after_index += 1;
            continue;
        }
        if lcs[before_index + 1][after_index] >= lcs[before_index][after_index + 1] {
            steps.push(DiffStep::Delete(before[before_index].clone()));
            before_index += 1;
        } else {
            steps.push(DiffStep::Insert(after[after_index].clone()));
            after_index += 1;
        }
    }
    while before_index < before_len {
        steps.push(DiffStep::Delete(before[before_index].clone()));
        before_index += 1;
    }
    while after_index < after_len {
        steps.push(DiffStep::Insert(after[after_index].clone()));
        after_index += 1;
    }
    steps
}

#[cfg(test)]
mod tests {
    use super::{apply_reverse_hunk, apply_reverse_hunks, render_patch_hunks};

    #[test]
    fn render_patch_hunks_splits_multiple_change_groups() {
        let rendered = render_patch_hunks(
            "line-1\nline-2\nline-3\nline-4",
            "line-1\nline-2-updated\nline-3\nline-4-updated",
        );
        assert_eq!(rendered.hunks.len(), 2);
        assert_eq!(rendered.additions, 2);
        assert_eq!(rendered.deletions, 2);
        assert_eq!(rendered.hunks[0].old_start, 2);
        assert_eq!(rendered.hunks[1].old_start, 4);
    }

    #[test]
    fn apply_reverse_hunk_restores_selected_segment() {
        let rendered = render_patch_hunks("a\nb\nc", "a\nB\nc");
        let reverted =
            apply_reverse_hunk("a\nB\nc", &rendered.hunks[0]).expect("reverse hunk should apply");
        assert_eq!(reverted, "a\nb\nc");
    }

    #[test]
    fn empty_before_pure_insert_round_trip() {
        let before = "";
        let after = "a\nb";
        let rendered = render_patch_hunks(before, after);
        assert_eq!(rendered.additions, 2);
        assert_eq!(rendered.deletions, 0);

        let reverted = apply_reverse_hunks(after, &rendered.hunks).expect("reverse ok");
        assert_eq!(reverted, before);
    }

    #[test]
    fn pure_delete_to_empty_round_trip() {
        let before = "a\nb";
        let after = "";
        let rendered = render_patch_hunks(before, after);
        assert_eq!(rendered.additions, 0);
        assert_eq!(rendered.deletions, 2);

        let reverted = apply_reverse_hunks(after, &rendered.hunks).expect("reverse ok");
        assert_eq!(reverted, before);
    }

    #[test]
    fn trailing_newline_is_preserved() {
        let before = "a\nb\n";
        let after = "a\nB\n";
        let rendered = render_patch_hunks(before, after);
        let reverted = apply_reverse_hunks(after, &rendered.hunks).expect("reverse ok");
        assert_eq!(reverted, before);
    }

    #[test]
    fn reverse_hunks_applied_in_reverse_order() {
        let before = "l1\nl2\nl3\nl4\nl5";
        let after = "l1\nL2\nl3\nL4\nl5";
        let rendered = render_patch_hunks(before, after);
        assert_eq!(rendered.hunks.len(), 2);

        // 调用方即便按正序传入，apply_reverse_hunks 内部也会逆序处理。
        let reverted = apply_reverse_hunks(after, &rendered.hunks).expect("reverse ok");
        assert_eq!(reverted, before);
    }

    #[test]
    fn apply_reverse_hunk_detects_drift() {
        let rendered = render_patch_hunks("a\nb\nc", "a\nB\nc");
        // 文件已经被进一步改动，应该拒绝撤销而不是静默写坏。
        let drifted = "a\nX\nc";
        let err = apply_reverse_hunk(drifted, &rendered.hunks[0])
            .expect_err("should refuse to apply on drifted file");
        assert!(err.contains("不一致"));
    }

    #[test]
    fn pure_insertion_hunk_reverse() {
        let before = "a\nc";
        let after = "a\nb\nc";
        let rendered = render_patch_hunks(before, after);
        assert_eq!(rendered.hunks.len(), 1);
        assert_eq!(rendered.hunks[0].old_lines, 0);
        assert_eq!(rendered.hunks[0].new_lines, 1);

        let reverted = apply_reverse_hunks(after, &rendered.hunks).expect("reverse ok");
        assert_eq!(reverted, before);
    }

    #[test]
    fn pure_deletion_hunk_reverse() {
        let before = "a\nb\nc";
        let after = "a\nc";
        let rendered = render_patch_hunks(before, after);
        assert_eq!(rendered.hunks.len(), 1);
        assert_eq!(rendered.hunks[0].old_lines, 1);
        assert_eq!(rendered.hunks[0].new_lines, 0);

        let reverted = apply_reverse_hunks(after, &rendered.hunks).expect("reverse ok");
        assert_eq!(reverted, before);
    }

    #[test]
    fn out_of_bounds_hunk_is_rejected() {
        let mut rendered = render_patch_hunks("a\nb\nc", "a\nB\nc");
        // 故意把 new_start 推到越界位置。
        rendered.hunks[0].new_start = 999;
        let err = apply_reverse_hunk("a\nB\nc", &rendered.hunks[0])
            .expect_err("should reject out-of-bounds");
        assert!(err.contains("越界"));
    }
}
