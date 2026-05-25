use vte::{Params, Perform, Parser};

/// 通过 vte 解析器从 ANSI 数据流中检测特定 CSI 事件。
/// 基于 Alacritty 使用的 vte crate 提供符合 ECMA-48 标准的 CSI 解析。

#[derive(Debug, Clone, Copy, Default)]
pub struct AnsiCsiEvents {
    pub alt_screen_switched: bool,
    pub alt_screen_active: bool,
    pub scroll_region_changed: bool,
    pub cursor_position_query: bool,
}

pub fn scan_ansi_csi_events(data: &str) -> AnsiCsiEvents {
    if data.is_empty() {
        return AnsiCsiEvents::default();
    }

    let mut detector = CsiDetector::default();
    let mut parser = Parser::new();
    for byte in data.as_bytes() {
        parser.advance(&mut detector, &[*byte]);
    }

    AnsiCsiEvents {
        alt_screen_switched: detector.alt_screen_switched,
        alt_screen_active: detector.alt_screen_active,
        scroll_region_changed: detector.scroll_region_changed,
        cursor_position_query: detector.cursor_position_query,
    }
}

pub fn has_cursor_position_query(data: &str) -> bool {
    let mut detector = CsiDetector::default();
    let mut parser = Parser::new();
    for byte in data.as_bytes() {
        parser.advance(&mut detector, &[*byte]);
    }
    detector.cursor_position_query
}

#[derive(Debug, Default)]
struct CsiDetector {
    private_mode: bool,
    alt_screen_switched: bool,
    alt_screen_active: bool,
    scroll_region_changed: bool,
    cursor_position_query: bool,
}

impl Perform for CsiDetector {
    fn print(&mut self, _c: char) {}

    fn execute(&mut self, _byte: u8) {}

    fn hook(&mut self, _params: &Params, _intermediates: &[u8], _ignore: bool, _action: char) {}

    fn put(&mut self, _byte: u8) {}

    fn unhook(&mut self) {}

    fn osc_dispatch(&mut self, _params: &[&[u8]], _bell_terminated: bool) {}

    fn csi_dispatch(&mut self, params: &Params, intermediates: &[u8], _ignore: bool, action: char) {
        self.private_mode = intermediates.first() == Some(&b'?');

        match action {
            'h' | 'l' if self.private_mode => {
                let entering = action == 'h';
                let flat: Vec<u16> = params.iter().map(|p| p[0]).collect();
                if flat.as_slice() == [47] || flat.as_slice() == [1047] || flat.as_slice() == [1049] {
                    self.alt_screen_switched = true;
                    self.alt_screen_active = entering;
                }
            }
            'r' if !self.private_mode => {
                self.scroll_region_changed = true;
            }
            'n' if !self.private_mode => {
                let flat: Vec<u16> = params.iter().map(|p| p[0]).collect();
                if flat.as_slice() == [6] {
                    self.cursor_position_query = true;
                }
            }
            _ => {}
        }
    }

    fn esc_dispatch(&mut self, _intermediates: &[u8], _ignore: bool, _byte: u8) {}
}