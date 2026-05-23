mod decoder;
mod disk_cache;
mod protocol;
mod server;

use anyhow::{Context, Result};
use disk_cache::DiskCache;
use tokio::net::UnixListener;

#[tokio::main(flavor = "multi_thread")]
async fn main() -> Result<()> {
    ffmpeg_next::init()?;

    let args: Vec<String> = std::env::args().collect();
    let sock_path = args.get(1).context("Usage: seek-preview <socket-path>")?;

    let _ = std::fs::remove_file(sock_path);
    let listener = UnixListener::bind(sock_path)?;
    eprintln!("[seek-preview] listening on {sock_path}");

    let disk = DiskCache::new();
    let state = server::State::new(disk);

    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                tokio::spawn(server::handle_conn(stream, state.clone()));
            }
            Err(e) => eprintln!("[seek-preview] accept error: {e}"),
        }
    }
}
