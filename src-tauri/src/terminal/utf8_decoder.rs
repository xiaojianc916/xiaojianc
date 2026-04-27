/// 面向 PTY 字节流的增量 UTF-8 解码器。
///
/// 用于处理 read 边界切开多字节字符的情况；非法字节会以 U+FFFD 显式替代，
/// 避免把半个字符或损坏字节静默丢弃。
#[derive(Default)]
pub struct Utf8ChunkDecoder {
    pending: Vec<u8>,
}

impl Utf8ChunkDecoder {
    /// 将新输入增量解码到 `output`。
    ///
    /// `last=true` 表示上游已结束，此时未完成的残留字节会输出替代字符。
    pub fn decode_into(&mut self, input: &[u8], output: &mut String, last: bool) {
        if !input.is_empty() {
            self.pending.extend_from_slice(input);
        }

        loop {
            if self.pending.is_empty() {
                return;
            }

            match std::str::from_utf8(&self.pending) {
                Ok(valid) => {
                    output.push_str(valid);
                    self.pending.clear();
                    return;
                }
                Err(error) => {
                    let valid_up_to = error.valid_up_to();

                    if valid_up_to > 0 {
                        if let Ok(valid_prefix) = std::str::from_utf8(&self.pending[..valid_up_to])
                        {
                            output.push_str(valid_prefix);
                        }
                        self.pending.drain(..valid_up_to);
                        continue;
                    }

                    if let Some(error_len) = error.error_len() {
                        output.push('\u{FFFD}');
                        self.pending.drain(..error_len);
                        continue;
                    }

                    if last {
                        output.push('\u{FFFD}');
                        self.pending.clear();
                    }

                    return;
                }
            }
        }
    }
}
