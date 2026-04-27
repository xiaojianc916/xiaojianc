#[derive(Default)]
pub(super) struct WslHostOutputFilter {
    strip_startup_controls: bool,
}

impl WslHostOutputFilter {
    pub(super) fn sanitize(&mut self, value: &str) -> String {
        let mut output = strip_known_wsl_host_sequences(value);
        if !self.strip_startup_controls {
            output = strip_leading_ansi_controls(&output);
            if output.chars().any(|character| !character.is_control()) {
                self.strip_startup_controls = true;
            }
        }
        output
    }
}

fn strip_known_wsl_host_sequences(value: &str) -> String {
    let mut output = value
        .replace("\x1b[6n", "")
        .replace("\x1b[?9001h", "")
        .replace("\x1b[?9001l", "")
        .replace("\x1b[?1004h", "")
        .replace("\x1b[?1004l", "");

    loop {
        let Some(start) = output.find("\x1b]0;") else {
            break;
        };
        let Some(end_offset) = output[start..].find('\x07') else {
            break;
        };
        let end = start + end_offset + '\x07'.len_utf8();
        if output[start..end].to_ascii_lowercase().contains("wsl.exe") {
            output.replace_range(start..end, "");
        } else {
            break;
        }
    }

    output
}

fn strip_leading_ansi_controls(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != 0x1b {
            break;
        }
        if index + 1 >= bytes.len() {
            break;
        }
        match bytes[index + 1] {
            b'[' => {
                let mut end = index + 2;
                while end < bytes.len() {
                    let byte = bytes[end];
                    end += 1;
                    if (0x40..=0x7e).contains(&byte) {
                        index = end;
                        break;
                    }
                }
                if end >= bytes.len() && index != end {
                    break;
                }
            }
            b']' => {
                let Some(relative_end) = value[index..].find('\x07') else {
                    break;
                };
                index += relative_end + '\x07'.len_utf8();
            }
            _ => break,
        }
    }
    value[index..].to_string()
}
