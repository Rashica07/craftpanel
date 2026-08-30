//! One-off asset processor. Not part of the app.
//!
//!   cargo run --bin gen_assets -- <icon.jpg> <wordmark.jpg> <repo_root>
//!
//! * icon    -> repo_root/src-tauri/app-icon.png  (1024², squircle, transparent corners)
//! * wordmark-> repo_root/src/public/wordmark.png (near-white bg removed, autocropped)
//!
//! After running, regenerate the platform icon set:
//!   npm run tauri icon src-tauri/app-icon.png

use std::path::Path;

use std::collections::VecDeque;

use image::{Rgba, RgbaImage};

fn main() {
    let a: Vec<String> = std::env::args().collect();
    if a.len() != 4 {
        eprintln!("usage: gen_assets <icon.jpg> <wordmark.jpg> <repo_root>");
        std::process::exit(1);
    }
    let (icon_src, word_src, root) = (&a[1], &a[2], Path::new(&a[3]));

    squircle_icon(icon_src, &root.join("src-tauri/app-icon.png"));
    let wm = wordmark(word_src, &root.join("public/wordmark.png"));
    light_wordmark(&wm, &root.join("public/wordmark-light.png"));
    println!("done. now: npm run tauri icon src-tauri/app-icon.png");
}

/// Mask the source to an iOS-style superellipse so the corners are perfectly
/// transparent (and any white halo the generator left is clipped away).
fn squircle_icon(src: &str, out: &Path) {
    let raw = image::open(src).expect("open icon").to_rgba8();

    // crop off the white margin around the drawn squircle
    let (rw, rh) = raw.dimensions();
    let (mut x0, mut y0, mut x1, mut y1) = (rw, rh, 0u32, 0u32);
    for (x, y, p) in raw.enumerate_pixels() {
        let min = p[0].min(p[1]).min(p[2]) as i32;
        let sat = p[0].max(p[1]).max(p[2]) as i32 - min;
        if min < 236 || sat > 24 {
            x0 = x0.min(x);
            y0 = y0.min(y);
            x1 = x1.max(x);
            y1 = y1.max(y);
        }
    }
    // shave 1% to drop the anti-aliased white fringe, then square it up
    let shave = ((x1 - x0).min(y1 - y0) as f64 * 0.012) as u32;
    x0 += shave; y0 += shave; x1 -= shave; y1 -= shave;
    let side = (x1 - x0).max(y1 - y0);
    let cx = (x0 + x1) / 2;
    let cy = (y0 + y1) / 2;
    let sx = cx.saturating_sub(side / 2);
    let sy = cy.saturating_sub(side / 2);
    let cropped = image::imageops::crop_imm(&raw, sx, sy, side.min(rw - sx), side.min(rh - sy)).to_image();

    let img = image::imageops::resize(&cropped, 1024, 1024, image::imageops::FilterType::Lanczos3);
    let sz = 1024.0_f64;
    let inset = 6.0_f64; // clip the drawn edge / any white halo
    let radius = 230.0_f64; // ~iOS corner radius for 1024
    let ss = 4; // supersample for smooth edges

    let inside = |px: f64, py: f64| {
        let (lo, hi) = (inset, sz - inset);
        if px < lo || px > hi || py < lo || py > hi {
            return false;
        }
        let cx = px.clamp(lo + radius, hi - radius);
        let cy = py.clamp(lo + radius, hi - radius);
        let (dx, dy) = (px - cx, py - cy);
        dx * dx + dy * dy <= radius * radius
    };

    let mut outimg = RgbaImage::new(1024, 1024);
    for y in 0..1024u32 {
        for x in 0..1024u32 {
            let mut covered = 0u32;
            for sy in 0..ss {
                for sx in 0..ss {
                    let px = x as f64 + (sx as f64 + 0.5) / ss as f64;
                    let py = y as f64 + (sy as f64 + 0.5) / ss as f64;
                    if inside(px, py) {
                        covered += 1;
                    }
                }
            }
            let src_px = img.get_pixel(x, y);
            let cov = covered as f32 / (ss * ss) as f32;
            let alpha = (src_px[3] as f32 * cov).round() as u8;
            outimg.put_pixel(x, y, Rgba([src_px[0], src_px[1], src_px[2], alpha]));
        }
    }
    if let Some(p) = out.parent() {
        let _ = std::fs::create_dir_all(p);
    }
    outimg.save(out).expect("save icon");
    println!("wrote {}", out.display());
}

/// Recolour the dark text of a wordmark to near-white for dark UIs.
fn light_wordmark(wm: &RgbaImage, out: &Path) {
    let mut img = wm.clone();
    for p in img.pixels_mut() {
        if p[3] == 0 {
            continue;
        }
        let min = p[0].min(p[1]).min(p[2]);
        let sat = p[0].max(p[1]).max(p[2]) - min;
        let luma = 0.299 * p[0] as f32 + 0.587 * p[1] as f32 + 0.114 * p[2] as f32;
        // recolour only near-neutral dark ink (the text) — leave the orange cube
        if sat < 45 && luma < 130.0 {
            let k = 236u8;
            *p = Rgba([k, k, k, p[3]]);
        }
    }
    img.save(out).expect("save light wordmark");
    println!("wrote {}", out.display());
}

/// Flood-fill the light background from the borders to transparency (so white
/// details *inside* the logo survive), feathered at the edge, then autocrop.
fn wordmark(src: &str, out: &Path) -> RgbaImage {
    let img = image::open(src).expect("open wordmark").to_rgba8();
    let (w, h) = img.dimensions();

    let is_bg = |p: &Rgba<u8>| {
        let (r, g, b) = (p[0] as i32, p[1] as i32, p[2] as i32);
        let min = r.min(g).min(b);
        let sat = r.max(g).max(b) - min;
        sat < 40 && min > 190
    };

    let idx = |x: u32, y: u32| (y * w + x) as usize;
    let mut bg = vec![false; (w * h) as usize];
    let mut q: VecDeque<(u32, u32)> = VecDeque::new();
    for x in 0..w {
        for y in [0, h - 1] {
            if is_bg(img.get_pixel(x, y)) && !bg[idx(x, y)] {
                bg[idx(x, y)] = true;
                q.push_back((x, y));
            }
        }
    }
    for y in 0..h {
        for x in [0, w - 1] {
            if is_bg(img.get_pixel(x, y)) && !bg[idx(x, y)] {
                bg[idx(x, y)] = true;
                q.push_back((x, y));
            }
        }
    }
    while let Some((x, y)) = q.pop_front() {
        let mut nb = [(0u32, 0u32); 4];
        let mut n = 0;
        if x > 0 { nb[n] = (x - 1, y); n += 1; }
        if x + 1 < w { nb[n] = (x + 1, y); n += 1; }
        if y > 0 { nb[n] = (x, y - 1); n += 1; }
        if y + 1 < h { nb[n] = (x, y + 1); n += 1; }
        for &(nx, ny) in &nb[..n] {
            if !bg[idx(nx, ny)] && is_bg(img.get_pixel(nx, ny)) {
                bg[idx(nx, ny)] = true;
                q.push_back((nx, ny));
            }
        }
    }

    let mut rgba = RgbaImage::new(w, h);
    for (x, y, p) in img.enumerate_pixels() {
        let alpha = if bg[idx(x, y)] {
            0
        } else {
            // soft edge: if any neighbour is bg, ramp by brightness
            let touches_bg = (x > 0 && bg[idx(x - 1, y)])
                || (x + 1 < w && bg[idx(x + 1, y)])
                || (y > 0 && bg[idx(x, y - 1)])
                || (y + 1 < h && bg[idx(x, y + 1)]);
            if touches_bg {
                let min = (p[0].min(p[1]).min(p[2])) as f32;
                (255.0 * (1.0 - ((min - 170.0) / 60.0).clamp(0.0, 1.0))) as u8
            } else {
                255
            }
        };
        rgba.put_pixel(x, y, Rgba([p[0], p[1], p[2], alpha]));
    }

    // autocrop to the non-transparent bounding box + padding
    let (mut x0, mut y0, mut x1, mut y1) = (w, h, 0u32, 0u32);
    for (x, y, p) in rgba.enumerate_pixels() {
        if p[3] > 12 {
            x0 = x0.min(x);
            y0 = y0.min(y);
            x1 = x1.max(x);
            y1 = y1.max(y);
        }
    }
    let pad = 16u32;
    x0 = x0.saturating_sub(pad);
    y0 = y0.saturating_sub(pad);
    x1 = (x1 + pad).min(w - 1);
    y1 = (y1 + pad).min(h - 1);
    let cropped =
        image::imageops::crop_imm(&rgba, x0, y0, x1 - x0 + 1, y1 - y0 + 1).to_image();

    if let Some(p) = out.parent() {
        let _ = std::fs::create_dir_all(p);
    }
    cropped.save(out).expect("save wordmark");
    println!("wrote {} ({}x{})", out.display(), cropped.width(), cropped.height());
    cropped
}
