//! Open the user's terminal emulator in a directory, detached from the app.

use std::path::Path;
use std::process::{Command, Stdio};

/// Candidates in order of preference: the user's `$TERMINAL`, the Debian
/// alternatives wrapper, then well-known emulators with their cwd flag.
fn candidates(dir: &str) -> Vec<(String, Vec<String>)> {
    let mut list: Vec<(String, Vec<String>)> = Vec::new();
    if let Ok(t) = std::env::var("TERMINAL") {
        if !t.is_empty() {
            // Most emulators honour the process cwd; pass no flags.
            list.push((t, vec![]));
        }
    }
    let known: [(&str, &[&str]); 9] = [
        ("x-terminal-emulator", &[]),
        ("gnome-terminal", &["--working-directory", dir]),
        ("kgx", &["--working-directory", dir]),
        ("ptyxis", &["--working-directory", dir]),
        ("konsole", &["--workdir", dir]),
        ("xfce4-terminal", &["--working-directory", dir]),
        ("alacritty", &["--working-directory", dir]),
        ("kitty", &["--directory", dir]),
        ("wezterm", &["start", "--cwd", dir]),
    ];
    for (bin, args) in known {
        list.push((bin.to_string(), args.iter().map(|s| s.to_string()).collect()));
    }
    list.push(("xterm".to_string(), vec![]));
    list
}

pub fn open(dir: &str) -> Result<String, String> {
    if !Path::new(dir).is_dir() {
        return Err(format!("{dir} is not a directory"));
    }
    let mut last = String::new();
    for (bin, args) in candidates(dir) {
        match Command::new(&bin)
            .args(&args)
            .current_dir(dir)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(_) => return Ok(bin),
            Err(e) => last = format!("{bin}: {e}"),
        }
    }
    Err(format!("no terminal emulator found ({last})"))
}
