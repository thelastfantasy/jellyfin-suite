use anyhow::{Context, Result};
use std::path::PathBuf;
use std::ptr;

pub fn decode_and_encode(path: &PathBuf, pos_ms: i64, target_width: u32) -> Result<Vec<u8>> {
    use ffmpeg_next as ff;
    use ffmpeg_next::threading;

    let mut ictx = ff::format::input(path)
        .with_context(|| format!("cannot open {:?}", path))?;

    let stream_idx;
    let tb;
    let codec_ctx;

    {
        let stream = ictx
            .streams()
            .best(ff::media::Type::Video)
            .context("no video stream")?;
        stream_idx = stream.index();
        tb = stream.time_base();
        let params = stream.parameters();
        codec_ctx = ff::codec::context::Context::from_parameters(params)?;
    }

    let thread_count = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .min(4);

    let mut decoder = {
        let mut ctx = codec_ctx;
        ctx.set_threading(threading::Config {
            kind: threading::Type::Slice,
            count: thread_count,
        });
        ctx.decoder().video()?
    };

    let ts_us = pos_ms * 1000;
    let _ = ictx.seek(ts_us, ..ts_us);
    decoder.flush();

    let target_pts = if tb.0 != 0 && tb.1 != 0 {
        (pos_ms as f64 * tb.1 as f64 / (tb.0 as f64 * 1000.0)) as i64
    } else {
        0
    };

    let mut best: Option<ff::frame::Video> = None;

    'outer: for (s, pkt) in ictx.packets() {
        if s.index() != stream_idx {
            continue;
        }
        if decoder.send_packet(&pkt).is_err() {
            continue;
        }
        loop {
            let mut frame = ff::frame::Video::empty();
            match decoder.receive_frame(&mut frame) {
                Ok(_) => {
                    let pts = frame.pts().unwrap_or(0);
                    best = Some(frame);
                    if pts >= target_pts {
                        break 'outer;
                    }
                }
                Err(_) => break,
            }
        }
    }

    if best.is_none() {
        let _ = decoder.send_eof();
        loop {
            let mut frame = ff::frame::Video::empty();
            match decoder.receive_frame(&mut frame) {
                Ok(_) => {
                    best = Some(frame);
                }
                Err(_) => break,
            }
        }
    }

    let frame = best.context("no frame decoded")?;
    encode_jpeg(&frame, target_width)
}

fn encode_jpeg(frame: &ffmpeg_next::frame::Video, target_width: u32) -> Result<Vec<u8>> {
    use ffmpeg_next::ffi::*;

    let aspect = frame.width() as f64 / frame.height() as f64;
    let w = ((target_width + 1) & !1) as i32;
    let h = ((((target_width as f64 / aspect) as u32).max(2) + 1) & !1) as i32;

    unsafe {
        let src = frame.as_ptr();

        let src_fmt: AVPixelFormat = std::mem::transmute((*src).format);
        let sws = sws_getContext(
            (*src).width,
            (*src).height,
            src_fmt,
            w,
            h,
            AVPixelFormat::AV_PIX_FMT_YUVJ420P,
            SWS_BILINEAR as i32,
            ptr::null_mut(),
            ptr::null_mut(),
            ptr::null(),
        );
        if sws.is_null() {
            anyhow::bail!("sws_getContext failed");
        }

        let mut dst = av_frame_alloc();
        if dst.is_null() {
            sws_freeContext(sws);
            anyhow::bail!("av_frame_alloc failed");
        }
        (*dst).format = AVPixelFormat::AV_PIX_FMT_YUVJ420P as i32;
        (*dst).width = w;
        (*dst).height = h;
        if av_frame_get_buffer(dst, 0) < 0 {
            av_frame_free(&mut dst);
            sws_freeContext(sws);
            anyhow::bail!("av_frame_get_buffer failed");
        }

        sws_scale(
            sws,
            (*src).data.as_ptr() as *const *const u8,
            (*src).linesize.as_ptr(),
            0,
            (*src).height,
            (*dst).data.as_mut_ptr() as *mut *mut u8,
            (*dst).linesize.as_mut_ptr(),
        );
        sws_freeContext(sws);

        let codec = avcodec_find_encoder(AVCodecID::AV_CODEC_ID_MJPEG);
        if codec.is_null() {
            av_frame_free(&mut dst);
            anyhow::bail!("MJPEG encoder not found");
        }

        let mut enc = avcodec_alloc_context3(codec);
        if enc.is_null() {
            av_frame_free(&mut dst);
            anyhow::bail!("avcodec_alloc_context3 failed");
        }

        (*enc).width = w;
        (*enc).height = h;
        (*enc).pix_fmt = AVPixelFormat::AV_PIX_FMT_YUVJ420P;
        (*enc).time_base = AVRational { num: 1, den: 25 };
        (*enc).flags |= AV_CODEC_FLAG_QSCALE as i32;
        (*enc).global_quality = (FF_QP2LAMBDA * 5) as i32;

        if avcodec_open2(enc, codec, ptr::null_mut()) < 0 {
            avcodec_free_context(&mut enc);
            av_frame_free(&mut dst);
            anyhow::bail!("avcodec_open2 failed");
        }

        (*dst).pts = 0;
        (*dst).quality = (FF_QP2LAMBDA * 5) as i32;

        if avcodec_send_frame(enc, dst) < 0 {
            avcodec_free_context(&mut enc);
            av_frame_free(&mut dst);
            anyhow::bail!("avcodec_send_frame failed");
        }

        let mut pkt = av_packet_alloc();
        let mut jpeg = Vec::new();
        if !pkt.is_null() && avcodec_receive_packet(enc, pkt) == 0 {
            let data = std::slice::from_raw_parts((*pkt).data, (*pkt).size as usize);
            jpeg.extend_from_slice(data);
        }
        if !pkt.is_null() {
            av_packet_free(&mut pkt);
        }
        avcodec_free_context(&mut enc);
        av_frame_free(&mut dst);

        if jpeg.is_empty() {
            anyhow::bail!("JPEG encode produced no output");
        }
        Ok(jpeg)
    }
}
