/// 判断 PTY 字节流中是否包含光标位置查询 CSI `ESC[6n`。
pub fn contains_cursor_position_query(data: &[u8]) -> bool {
    data.windows(4).any(|window| window == b"\x1b[6n")
}
