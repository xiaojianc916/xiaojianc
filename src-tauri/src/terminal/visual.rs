use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

pub(crate) const TERMINAL_ANSI_SAFE_RESET: &str =
    "\x1b[?25h\x1b[?7h\x1b[m\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l";
pub(crate) const TERMINAL_ANSI_EXIT_ALT_SCREEN: &str = "\x1b[?1049l";
pub(crate) const TERMINAL_ANSI_RESET_SCROLL_REGION_PRESERVE_CURSOR: &str = "\x1b7\x1b[r\x1b8";
const TERMINAL_PROMPT_MAX_LENGTH: usize = 240;

#[derive(Debug, Clone, Copy)]
pub struct TerminalRunVisualTracker {
    pub(crate) has_output: bool,
    pub(crate) ended_at_line_start: bool,
    pub(crate) next_seq: u64,
    pub(crate) alt_screen_active: bool,
    pub(crate) scroll_region_changed: bool,
}

impl Default for TerminalRunVisualTracker {
    fn default() -> Self {
        Self {
            has_output: false,
            ended_at_line_start: false,
            next_seq: 1,
            alt_screen_active: false,
            scroll_region_changed: false,
        }
    }
}

impl TerminalRunVisualTracker {
    fn allocate_seq(&mut self) -> u64 {
        let seq = self.next_seq;
        self.next_seq += 1;
        seq
    }

    pub(crate) fn observe(&mut self, data: &str) {
        if data.is_empty() {
            return;
        }
        self.observe_ansi_state(data);
        self.has_output = true;
        self.ended_at_line_start = data.ends_with('\n') || data.ends_with('\r');
    }

    fn observe_ansi_state(&mut self, data: &str) {
        let bytes = data.as_bytes();
        let mut index = 0;

        while index + 2 < bytes.len() {
            if bytes[index] != 0x1b || bytes[index + 1] != b'[' {
                index += 1;
                continue;
            }

            let params_start = index + 2;
            let mut cursor = params_start;
            while cursor < bytes.len() {
                let byte = bytes[cursor];
                if (0x40..=0x7e).contains(&byte) {
                    if let Some(params) = data.get(params_start..cursor) {
                        self.observe_csi(params, byte);
                    }
                    index = cursor + 1;
                    break;
                }
                cursor += 1;
            }

            if cursor >= bytes.len() {
                break;
            }
        }
    }

    fn observe_csi(&mut self, params: &str, final_byte: u8) {
        match final_byte {
            b'h' if csi_private_params_contain(params, &[47, 1047, 1049]) => {
                self.alt_screen_active = true;
            }
            b'l' if csi_private_params_contain(params, &[47, 1047, 1049]) => {
                self.alt_screen_active = false;
            }
            b'r' => {
                self.scroll_region_changed = true;
            }
            _ => {}
        }
    }
}

fn csi_private_params_contain(params: &str, needles: &[u16]) -> bool {
    let Some(private_params) = params.strip_prefix('?') else {
        return false;
    };

    private_params.split(';').any(|part| {
        let digits = part
            .bytes()
            .take_while(|byte| byte.is_ascii_digit())
            .collect::<Vec<_>>();
        if digits.is_empty() {
            return false;
        }

        std::str::from_utf8(&digits)
            .ok()
            .and_then(|value| value.parse::<u16>().ok())
            .is_some_and(|value| needles.contains(&value))
    })
}

#[derive(Debug, Clone, Copy)]
pub struct TerminalRunVisualObservation {
    pub prefix: &'static str,
    pub run_seq: u64,
}

pub fn observe_visual_output_and_prefix(
    tracker: &Arc<Mutex<TerminalRunVisualTracker>>,
    data: &str,
) -> TerminalRunVisualObservation {
    if let Ok(mut tracker) = tracker.lock() {
        let prefix = if !tracker.has_output && !data.starts_with(['\r', '\n']) {
            "\r\n"
        } else {
            ""
        };
        let run_seq = tracker.allocate_seq();
        tracker.observe(data);
        TerminalRunVisualObservation { prefix, run_seq }
    } else {
        TerminalRunVisualObservation {
            prefix: "",
            run_seq: 0,
        }
    }
}

pub fn current_visual_tracker(
    tracker: &Arc<Mutex<TerminalRunVisualTracker>>,
) -> TerminalRunVisualTracker {
    tracker.lock().map(|value| *value).unwrap_or_default()
}

pub fn next_visual_run_seq(tracker: &Arc<Mutex<TerminalRunVisualTracker>>) -> u64 {
    tracker
        .lock()
        .map(|mut tracker| tracker.allocate_seq())
        .unwrap_or(0)
}

pub fn build_terminal_ansi_reset(tracker: TerminalRunVisualTracker) -> String {
    let mut reset = String::new();
    if tracker.alt_screen_active {
        reset.push_str(TERMINAL_ANSI_EXIT_ALT_SCREEN);
    }
    reset.push_str(TERMINAL_ANSI_SAFE_RESET);
    if tracker.scroll_region_changed {
        reset.push_str(TERMINAL_ANSI_RESET_SCROLL_REGION_PRESERVE_CURSOR);
    }
    reset
}

pub fn build_terminal_run_separator(
    visual_seq: u64,
    exit_code: Option<i32>,
    duration: Duration,
    tracker: TerminalRunVisualTracker,
    prompt: Option<String>,
) -> String {
    let prefix = if tracker.has_output && tracker.ended_at_line_start {
        ""
    } else {
        "\r\n"
    };
    let exit_label = exit_code
        .map(|code| format!("exit {code}"))
        .unwrap_or_else(|| "exit ?".to_string());
    let duration_secs = duration.as_secs_f64();
    let mut text =
        format!("{prefix}──── run #{visual_seq} · {exit_label} · {duration_secs:.1}s ────\r\n");
    if let Some(prompt) = prompt {
        text.push_str(&prompt);
    }
    text
}

pub fn extract_prompt_from_terminal_snapshot(snapshot: &str) -> Option<String> {
    if snapshot.is_empty() {
        return None;
    }

    let marker_index = snapshot
        .char_indices()
        .rev()
        .find_map(|(index, character)| matches!(character, '$' | '#').then_some(index))?;
    let prefix = &snapshot[..=marker_index];
    let start = prefix
        .rfind("\x1b[32m")
        .or_else(|| prefix.rfind("\x1b[1m"))
        .or_else(|| prefix.rfind('['))
        .or_else(|| prefix.rfind('\n').map(|index| index + 1))
        .or_else(|| prefix.rfind('\r').map(|index| index + 1))
        .unwrap_or(0);
    let mut prompt = snapshot[start..]
        .split(['\r', '\n'])
        .next()
        .unwrap_or_default()
        .to_string();

    if prompt.len() > TERMINAL_PROMPT_MAX_LENGTH
        || !prompt
            .chars()
            .any(|character| matches!(character, '$' | '#'))
    {
        return None;
    }

    if !prompt.ends_with(' ') {
        prompt.push(' ');
    }

    Some(prompt)
}
