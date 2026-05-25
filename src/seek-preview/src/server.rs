use crate::decoder::decode_and_encode;
use crate::disk_cache::DiskCache;
use crate::protocol::{read_req, write_ack, write_response};
use lru::LruCache;
use std::collections::HashSet;
use std::num::NonZeroUsize;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;
use tokio::net::UnixStream;
use tokio::sync::{mpsc, Mutex, Semaphore};

const PRIORITY_FETCH: u8 = 0x01;
const CACHE_CAP: usize = 20;
/// Bounded channel cap — try_send drops silently when full (C# will re-enqueue on next tick).
const PREFETCH_QUEUE_CAP: usize = 64;
/// Number of concurrent background prefetch workers (each runs one spawn_blocking at a time).
pub const PREFETCH_WORKERS: usize = 2;

#[derive(Clone, Hash, PartialEq, Eq)]
pub(crate) struct CacheKey {
    item_id: String,
    pos_ms_aligned: i64,
}

pub type JpegData = Arc<Vec<u8>>;

struct PrefetchJob {
    item_id: String,
    path: PathBuf,
    aligned_pos: i64,
    width: u32,
    key: CacheKey,
}

pub struct State {
    pub cache: Mutex<LruCache<CacheKey, JpegData>>,
    pub disk: Arc<DiskCache>,
    active_item_id: Mutex<Option<String>>,
    /// Limits concurrent interactive FETCH decodes (C# already serialises via _fetchLock, cap=1 is defensive).
    decode_sem: Arc<Semaphore>,
    /// PREFETCH queue — background workers process sequentially per worker.
    prefetch_tx: mpsc::Sender<PrefetchJob>,
    /// Tracks frames currently being decoded to prevent duplicate work across workers.
    in_progress: Mutex<HashSet<(String, i64)>>,
}

impl State {
    pub fn new(disk: Arc<DiskCache>) -> Arc<Self> {
        let (tx, rx) = mpsc::channel(PREFETCH_QUEUE_CAP);
        let state = Arc::new(Self {
            cache: Mutex::new(LruCache::new(NonZeroUsize::new(CACHE_CAP).unwrap())),
            disk,
            active_item_id: Mutex::new(None),
            decode_sem: Arc::new(Semaphore::new(1)),
            prefetch_tx: tx,
            in_progress: Mutex::new(HashSet::new()),
        });
        let rx = Arc::new(Mutex::new(rx));
        for _ in 0..PREFETCH_WORKERS {
            tokio::spawn(prefetch_worker(rx.clone(), state.clone()));
        }
        state
    }
}

async fn prefetch_worker(rx: Arc<Mutex<mpsc::Receiver<PrefetchJob>>>, state: Arc<State>) {
    loop {
        let job = match rx.lock().await.recv().await {
            Some(j) => j,
            None => break,
        };
        // Skip if already cached in RAM, on disk, or currently being decoded by another worker.
        {
            let c = state.cache.lock().await;
            if c.peek(&job.key).is_some() {
                continue;
            }
        }
        if state.disk.exists(&job.item_id, &job.path, job.aligned_pos) {
            continue;
        }
        let progress_key = (job.item_id.clone(), job.aligned_pos);
        {
            let mut ip = state.in_progress.lock().await;
            if !ip.insert(progress_key.clone()) {
                continue; // another worker already has this frame
            }
        }

        let disk = state.disk.clone();
        let item_id = job.item_id.clone();
        let path = job.path.clone();
        let aligned_pos = job.aligned_pos;
        let width = job.width;
        let key = job.key.clone();

        match tokio::task::spawn_blocking(move || -> anyhow::Result<Vec<u8>> {
            let t = Instant::now();
            let bytes = decode_and_encode(&path, aligned_pos, width)?;
            eprintln!(
                "[seek-preview] PREFETCH {}ms → {:.0}ms ({} B)",
                aligned_pos,
                t.elapsed().as_secs_f64() * 1000.0,
                bytes.len()
            );
            disk.write(&item_id, &path, aligned_pos, &bytes);
            Ok(bytes)
        })
        .await
        {
            Ok(Ok(bytes)) => {
                state.cache.lock().await.put(key, Arc::new(bytes));
            }
            Ok(Err(e)) => eprintln!("[seek-preview] prefetch decode error: {e}"),
            Err(e) => eprintln!("[seek-preview] prefetch task error: {e}"),
        }
        state.in_progress.lock().await.remove(&progress_key);
    }
}

async fn evict_on_switch(state: &Arc<State>, item_id: &str) {
    let mut active = state.active_item_id.lock().await;
    if active.as_deref() != Some(item_id) {
        if active.is_some() {
            state.cache.lock().await.clear();
        }
        *active = Some(item_id.to_owned());
    }
}

pub async fn handle_conn(mut stream: UnixStream, state: Arc<State>) {
    loop {
        let req = match read_req(&mut stream).await {
            Ok(r) => r,
            Err(_) => break,
        };

        evict_on_switch(&state, &req.item_id).await;

        let key = CacheKey {
            item_id: req.item_id.clone(),
            pos_ms_aligned: req.pos_ms / 100 * 100,
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
                let item_id = req.item_id.clone();
                let path = req.path.clone();
                let disk = state.disk.clone();
                let s2 = state.clone();
                let k2 = key.clone();
                let permit = state.decode_sem.clone().acquire_owned().await.unwrap();
                match tokio::task::spawn_blocking(move || -> anyhow::Result<Vec<u8>> {
                    let _permit = permit;
                    if let Some(bytes) = disk.read(&item_id, &path, aligned_pos) {
                        eprintln!("[seek-preview] FETCH  hit  {}ms ({} B)", aligned_pos, bytes.len());
                        return Ok(bytes);
                    }
                    let t = Instant::now();
                    let bytes = decode_and_encode(&path, aligned_pos, width)?;
                    eprintln!(
                        "[seek-preview] FETCH  decode {}ms → {:.0}ms ({} B)",
                        aligned_pos,
                        t.elapsed().as_secs_f64() * 1000.0,
                        bytes.len()
                    );
                    disk.write(&item_id, &path, aligned_pos, &bytes);
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
            // PREFETCH: ACK immediately, enqueue for background worker.
            // try_send drops silently when queue is full — C# re-enqueues on next tick.
            let _ = write_ack(&mut stream, req.request_id).await;
            if cached.is_none() && !state.disk.exists(&req.item_id, &req.path, aligned_pos) {
                let _ = state.prefetch_tx.try_send(PrefetchJob {
                    item_id: req.item_id,
                    path: req.path,
                    aligned_pos,
                    width,
                    key,
                });
            }
        }
    }
}
