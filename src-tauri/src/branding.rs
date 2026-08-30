//! Server branding: the 64×64 `server-icon.png` shown in the multiplayer list.
//! (MOTD is a plain `server.properties` key — edited through the settings path.)

use std::fs;
use std::path::Path;

pub const ICON_FILE: &str = "server-icon.png";

/// Load any common image, square-crop-to-fit at 64×64, write `server-icon.png`.
pub fn set_icon(server_dir: &Path, src: &str) -> Result<(), String> {
    let img = image::open(src).map_err(|e| format!("Couldn't read that image: {e}"))?;
    // center-crop to a square, then exact 64×64 so it never looks stretched
    let (w, h) = (img.width(), img.height());
    let side = w.min(h);
    let cropped = image::imageops::crop_imm(&img, (w - side) / 2, (h - side) / 2, side, side).to_image();
    let icon = image::imageops::resize(&cropped, 64, 64, image::imageops::FilterType::Lanczos3);
    icon.save(server_dir.join(ICON_FILE))
        .map_err(|e| format!("Couldn't write server-icon.png: {e}"))
}

pub fn has_icon(server_dir: &Path) -> bool {
    server_dir.join(ICON_FILE).is_file()
}

pub fn clear_icon(server_dir: &Path) -> Result<(), String> {
    let p = server_dir.join(ICON_FILE);
    if p.exists() {
        fs::remove_file(&p).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resizes_any_image_to_64_square_png() {
        let d = std::env::temp_dir().join(format!("cp-brand-{:?}", std::thread::current().id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();

        // a 200×120 source
        let src = d.join("src.png");
        image::RgbaImage::from_pixel(200, 120, image::Rgba([10, 20, 30, 255]))
            .save(&src)
            .unwrap();

        set_icon(&d, &src.to_string_lossy()).unwrap();
        assert!(has_icon(&d));
        let out = image::open(d.join(ICON_FILE)).unwrap();
        assert_eq!((out.width(), out.height()), (64, 64));

        clear_icon(&d).unwrap();
        assert!(!has_icon(&d));
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn rejects_a_non_image() {
        let d = std::env::temp_dir().join("cp-brand-bad");
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join("notimg.png"), b"nope").unwrap();
        assert!(set_icon(&d, &d.join("notimg.png").to_string_lossy()).is_err());
        let _ = fs::remove_dir_all(&d);
    }
}
