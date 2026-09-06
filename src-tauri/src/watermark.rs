//! The "made with CraftPanel" console banner — printed as a single
//! `"system"`-stream line (see `process::LogLine`) the moment a server
//! starts, the same way many plugins print a splash logo on load.
//!
//! Scoped deliberately: this only shows up in *CraftPanel's own* console
//! view, printed by CraftPanel itself, not baked into the real server
//! process's actual log file — that would need a compiled Paper/Spigot
//! plugin (and separately, one per mod loader) hooking the boot sequence,
//! which is real, ongoing engineering per loader rather than one file
//! here. This is the always-works, zero-toolchain version; the
//! "shows even if the server folder is redistributed and launched
//! without CraftPanel" version is a real follow-up, not this.

/// Generated with `pyfiglet`'s `ansi_shadow` font — swap the word here (and
/// regenerate) if the exact wordmark ever changes; this is plain text, no
/// per-letter renderer to maintain.
const BANNER_ART: &str = r"
 ██████╗██████╗  █████╗ ███████╗████████╗██████╗  █████╗ ███╗   ██╗███████╗██╗
██╔════╝██╔══██╗██╔══██╗██╔════╝╚══██╔══╝██╔══██╗██╔══██╗████╗  ██║██╔════╝██║
██║     ██████╔╝███████║█████╗     ██║   ██████╔╝███████║██╔██╗ ██║█████╗  ██║
██║     ██╔══██╗██╔══██║██╔══╝     ██║   ██╔═══╝ ██╔══██║██║╚██╗██║██╔══╝  ██║
╚██████╗██║  ██║██║  ██║██║        ██║   ██║     ██║  ██║██║ ╚████║███████╗███████╗
 ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝        ╚═╝   ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═══╝╚══════╝╚══════╝";

pub fn banner() -> String {
    format!("{BANNER_ART}\n     This server was set up with CraftPanel — github.com/Rashica07/craftpanel\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn banner_is_nonempty_and_mentions_the_repo() {
        let b = banner();
        assert!(b.contains("CraftPanel"));
        assert!(b.contains("github.com/Rashica07/craftpanel"));
    }
}
