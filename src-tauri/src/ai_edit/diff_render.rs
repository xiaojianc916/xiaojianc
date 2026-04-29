//! AED 行级 diff 与 hunk 反向应用工具。

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

pub fn render_patch_hunks(before: &str, after: &str) -> RenderedDiff {
	let before_lines = split_text_lines(before);
	let after_lines = split_text_lines(after);
	let steps = build_diff_steps(&before_lines, &after_lines);

	let mut additions = 0;
	let mut deletions = 0;
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

pub fn apply_reverse_hunk(after: &str, hunk: &AiPatchHunkPayload) -> Result<String, String> {
	let mut lines = split_text_lines(after);
	let start = hunk.new_start.saturating_sub(1) as usize;
	let end = start.saturating_add(hunk.new_lines as usize);

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
	let current_segment = lines[start..end].to_vec();
	if current_segment != expected_new_lines {
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
	use super::{apply_reverse_hunk, render_patch_hunks};

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
		let reverted = apply_reverse_hunk("a\nB\nc", &rendered.hunks[0])
			.expect("reverse hunk should apply");

		assert_eq!(reverted, "a\nb\nc");
	}
}