use portable_pty::PtySize;

use super::types::Geometry;

/// 将终端列/行规格归一化为 portable-pty 可接受的 PTY 尺寸。
pub fn normalize_pty_size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        cols: cols.max(2),
        rows: rows.max(1),
        pixel_width: 0,
        pixel_height: 0,
    }
}

/// 将终端几何信息归一化为 portable-pty 可接受的 PTY 尺寸。
pub fn normalize_geometry_pty_size(geometry: Geometry) -> PtySize {
    normalize_pty_size(geometry.cols, geometry.rows)
}
