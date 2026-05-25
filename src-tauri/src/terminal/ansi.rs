use super::vte_detect;

/// 判断 PTY 字节流中是否包含光标位置查询 CSI `ESC[6n`。
pub fn contains_cursor_position_query(data: &[u8]) -> bool {
    let Ok(text) = std::str::from_utf8(data) else {
        return false;
    };
    vte_detect::has_cursor_position_query(text)
}
