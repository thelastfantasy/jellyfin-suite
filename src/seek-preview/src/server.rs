use crate::decoder::decode_and_encode;
use crate::disk_cache::DiskCache;
use crate::protocol::{read_req, write_ack, write_response};
use lru::LruCache;
use std::num::NonZeroUsize;
use std::sync::Arc;
use tokio::net::UnixStream;
use tokio::sync::{Mutex, Semaphore};

const PRIORITY_FETCH: u8 = 0x01;
const CACHE_CAP: usize = 20;
const MAX_CONCURRENT_DECODES: usize = 6;

#[derive(Clone, Hash, PartialEq, Eq)]
pub(crate) struct CacheKey {
    item_id: String,
    pos_ms_aligned: i64,
}

pub type JpegData = Arc<Vec<u8>>;

pub struct State {
    pub cache: Mutex<LruCache<CacheKey, JpegData>>,
    pub disk: Arc<DiskCache>,
    active_item_id: Mutex<Option<String>>,
    decode_sem: Arc<Semaphore>,
}

impl State {
    pub fn new(disk: Arc<DiskCache>) -> Arc<Self> {
        Arc::new(Self {
            cache: Mutex::new(LruCache::new(NonZeroUsize::new(CACHE_CAP).unwrap())),
            disk,
            active_item_id: Mutex::new(None),
            decode_sem: Arc::new(Semaphore::new(MAX_CONCURRENT_DECODES)),
        })
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
                let item_id = req.item_id.clone();
                let path = req.path.clone();
                let disk = state.disk.clone();
                let s2 = state.clone();
                let k2 = key.clone();
                let permit = state.decode_sem.clone().acquire_owned().await.unwrap();
                match tokio::task::spawn_blocking(move || -> anyhow::Result<Vec<u8>> {
                    let _permit = permit;
                    if let Some(bytes) = disk.read(&item_id, &path, aligned_pos) {
                        return Ok(bytes);
                    }
                    let bytes = decode_and_encode(&path, aligned_pos, width)?;
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
            let _ = write_ack(&mut stream, req.request_id).await;
            let already_on_disk = state.disk.exists(&req.item_id, &req.path, aligned_pos);
            if cached.is_none() && !already_on_disk {
                let Ok(permit) = state.decode_sem.clone().try_acquire_owned() else {
                    continue;
                };
                let item_id = req.item_id.clone();
                let path = req.path.clone();
                let disk = state.disk.clone();
                let s2 = state.clone();
                let k2 = key.clone();
                tokio::spawn(async move {
                    match tokio::task::spawn_blocking(move || -> anyhow::Result<Vec<u8>> {
                        let _permit = permit;
                        let bytes = decode_and_encode(&path, aligned_pos, width)?;
                        disk.write(&item_id, &path, aligned_pos, &bytes);
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
