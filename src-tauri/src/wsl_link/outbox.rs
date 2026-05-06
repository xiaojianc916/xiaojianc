use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File, OpenOptions},
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use super::types::WslLinkEnvelope;

#[derive(Debug, Error)]
pub enum WslLinkOutboxError {
    #[error("WSL Link outbox IO 失败：{0}")]
    Io(#[from] std::io::Error),
    #[error("WSL Link outbox 序列化失败：{0}")]
    Serde(#[from] serde_json::Error),
    #[error("WSL Link outbox 消息无效：{0}")]
    InvalidEnvelope(&'static str),
}

#[derive(Debug, Clone)]
pub struct WslLinkWalOutbox {
    path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum WalRecord {
    Enqueue { envelope: WslLinkEnvelope },
    Ack { client_seq: u64 },
}

impl WslLinkWalOutbox {
    pub fn open(path: impl Into<PathBuf>) -> Result<Self, WslLinkOutboxError> {
        let path = path.into();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }

        OpenOptions::new().create(true).append(true).open(&path)?;

        Ok(Self { path })
    }

    pub fn enqueue(&self, envelope: &WslLinkEnvelope) -> Result<(), WslLinkOutboxError> {
        envelope
            .validate()
            .map_err(WslLinkOutboxError::InvalidEnvelope)?;
        self.append_record(&WalRecord::Enqueue {
            envelope: envelope.clone(),
        })
    }

    pub fn ack(&self, client_seq: u64) -> Result<(), WslLinkOutboxError> {
        self.append_record(&WalRecord::Ack { client_seq })
    }

    pub fn pending(&self) -> Result<Vec<WslLinkEnvelope>, WslLinkOutboxError> {
        let mut pending = BTreeMap::<u64, WslLinkEnvelope>::new();
        let mut acked = BTreeSet::<u64>::new();
        let file = File::open(&self.path)?;
        let reader = BufReader::new(file);

        for line in reader.lines() {
            let line = line?;
            if line.trim().is_empty() {
                continue;
            }

            match serde_json::from_str::<WalRecord>(&line)? {
                WalRecord::Enqueue { envelope } => {
                    if !acked.contains(&envelope.client_seq) {
                        pending.insert(envelope.client_seq, envelope);
                    }
                }
                WalRecord::Ack { client_seq } => {
                    acked.insert(client_seq);
                    pending.remove(&client_seq);
                }
            }
        }

        Ok(pending.into_values().collect())
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    fn append_record(&self, record: &WalRecord) -> Result<(), WslLinkOutboxError> {
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)?;
        serde_json::to_writer(&mut file, record)?;
        file.write_all(b"\n")?;
        file.sync_data()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;

    fn unique_outbox_path() -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("calamex-wsl-link-outbox-{stamp}.jsonl"))
    }

    fn envelope(client_seq: u64) -> WslLinkEnvelope {
        WslLinkEnvelope {
            session_id: "s1".to_string(),
            request_id: format!("r{client_seq}"),
            idempotency_key: format!("idem-{client_seq}"),
            client_seq,
            ack_server_seq: 0,
            trace_id: format!("trace-{client_seq}"),
            payload: b"payload".to_vec(),
            created_at_unix_ms: client_seq,
        }
    }

    #[test]
    fn wal_replays_unacked_messages() {
        let path = unique_outbox_path();
        let outbox = WslLinkWalOutbox::open(&path).expect("outbox should open");

        outbox.enqueue(&envelope(1)).expect("enqueue 1 should work");
        outbox.enqueue(&envelope(2)).expect("enqueue 2 should work");
        outbox.ack(1).expect("ack should work");

        let pending = outbox.pending().expect("pending should load");

        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].client_seq, 2);

        let _ = fs::remove_file(path);
    }

    #[test]
    fn wal_rejects_invalid_envelope() {
        let path = unique_outbox_path();
        let outbox = WslLinkWalOutbox::open(&path).expect("outbox should open");
        let mut invalid = envelope(1);
        invalid.trace_id.clear();

        assert!(matches!(
            outbox.enqueue(&invalid),
            Err(WslLinkOutboxError::InvalidEnvelope(_)),
        ));

        let _ = fs::remove_file(path);
    }
}
