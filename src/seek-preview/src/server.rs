use crate::decoder::decode_and_encode;
use crate::disk_cache::DiskCache;
use crate::protocol::{read_req, write_ack, write_response};
use lru::LruCache;
use std::num::NonZeroUsize;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::net::UnixStream;
use tokio::sync::{Mutex, Semaphore};

const PRIORITY_FETCH: u8 = 0x01;
const CACHE_CAP: usize = 20;
/// Max concurrent ffmpeg decode operations (FETCH queues, PREFETCH skips when full).
const MAX_CONCURRENT_DECODES: usize = 6;

#[derive(Clone, Hash, PartialEq, Eq)]
pub(crate) struct CacheKey {
    path: PathBuf,
    pos_ms_aligned: i64,
}

pub type JpegData = Arc<Vec<u8>>;

pub struct State {
    pub cache: Mutex<LruCache<CacheKey, JpegData>>,
    pub disk: Arc<DiskCache>,
    /// Last-seen video path; RAM cache is cleared when it changes.
    active_path: Mutex<Option<PathBuf>>,
    /// Limits concurrent ffmpeg spawns to bound peak RSS and thread count.
    decode_sem: Arc<Semaphore>,
}

impl State {
    pub fn new(disk: Arc<DiskCache>) -> Arc<Self> {
        Arc::new(Self {
            cache: Mutex::new(LruCache::new(NonZeroUsize::new(CACHE_CAP).unwrap())),
            disk,
            active_path: Mutex::new(None),
            decode_sem: Arc::new(Semaphore::new(MAX_CONCURRENT_DECODES)),
        })
    }
}

/// Clear RAM cache when the active video switches.
async fn evict_on_switch(state: &Arc<State>, path: &PathBuf) {
    let mut active = state.active_path.lock().await;
    if active.as_ref() != Some(path) {
        if active.is_some() {
            state.cache.lock().await.clear();
        }
        *active = Some(path.clone());
    }
}

pub async fn handle_conn(mut stream: UnixStream, state: Arc<State>) {
    loop {
        let req = match read_req(&mut stream).await {
            Ok(r) => r,
            Err(_) => break,
        };

        evict_on_switch(&state, &req.path).await;

        let key = CacheKey {
            path: req.path.clone(),
            pos_ms_aligned: req.pos_ms / 500 * 500,
        };
        let aligned_pos = key.pos_ms_aligned;
        let width = req.width;

        // ── RAM cache lookup ─────────────────────────────────────────────────
        let cached = {
            let mut c = state.cache.lock().await;
            c.get(&key).cloned()
        };

        if req.priority == PRIORITY_FETCH {
            let jpeg = if let Some(data) = cached {
                data
            } else {
                let path = req.path.clone();
                let disk = state.disk.clone();
                let s2 = state.clone();
                let k2 = key.clone();
                // Acquire permit before spawning — queues FETCH requests rather than spawning unbounded threads.
                let permit = state.decode_sem.clone().acquire_owned().await.unwrap();
                match tokio::task::spawn_blocking(move || -> anyhow::Result<Vec<u8>> {
                    let _permit = permit; // released when blocking task finishes
                    if let Some(bytes) = disk.read(&path, aligned_pos) {
                        return Ok(bytes);
                    }
                    let bytes = decode_and_encode(&path, aligned_pos, width)?;
                    disk.write(&path, aligned_pos, &bytes);
                    Ok(bytes)
                })
                .await
                {
                    Ok(Ok(bytes)) => {
                        let arc = Arc::new(bytes);
                        s2.cache.lock().await.put(k2, arc.clone());
                        arc
                    }
                    Ok(Err(e)) => {
                        eprintln!("[seek-preview] decode error: {e}");
                        let _ = write_ack(&mut stream, req.request_id).await;
                        continue;
                    }
                    Err(e) => {
                        eprintln!("[seek-preview] task error: {e}");
                        let _ = write_ack(&mut stream, req.request_id).await;
                        continue;
                    }
                }
            };
            let _ = write_response(&mut stream, req.request_id, &jpeg).await;
        } else {
            // Prefetch: ACK immediately, decode in background if not already cached
            let _ = write_ack(&mut stream, req.request_id).await;
            let already_on_disk = state.disk.exists(&req.path, aligned_pos);
            if cached.is_none() && !already_on_disk {
                // Skip prefetch if decode slots are full — don't queue, just drop.
                let Ok(permit) = state.decode_sem.clone().try_acquire_owned() else {
                    continue;
                };
                let path = req.path.clone();
                let disk = state.disk.clone();
                let s2 = state.clone();
                let k2 = key.clone();
                tokio::spawn(async move {
                    match tokio::task::spawn_blocking(move || -> anyhow::Result<Vec<u8>> {
                        let _permit = permit;
                        let bytes = decode_and_encode(&path, aligned_pos, width)?;
                        disk.write(&path, aligned_pos, &bytes);
                        Ok(bytes)
                    })
                    .await
                    {
                        Ok(Ok(bytes)) => {
                            s2.cache.lock().await.put(k2, Arc::new(bytes));
                        }
                        Ok(Err(e)) => eprintln!("[seek-preview] prefetch decode error: {e}"),
                        Err(e) => eprintln!("[seek-preview] prefetch task error: {e}"),
                    }
                });
            }
        }
    }
}
