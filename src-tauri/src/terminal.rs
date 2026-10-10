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

/// Open `file` in the configured editor and wait for the command to exit.
/// `xdg-open` returns immediately, so for it "returning" means "launched".
pub fn edit(editor: &str, file: &str) -> Result<(), String> {
    let editor = editor.trim();
    let (bin, args): (String, Vec<String>) = if editor.is_empty() {
        ("xdg-open".to_string(), vec![file.to_string()])
    } else {
        let parts: Vec<String> = shell_words(editor).into_iter().map(|p| p.replace("{file}", file)).collect();
        let has_file = editor.contains("{file}");
        let mut args = parts[1..].to_vec();
        if !has_file {
            args.push(file.to_string());
        }
        (parts[0].clone(), args)
    };
    let status = Command::new(&bin)
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| format!("{bin}: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("{bin} exited with {status}"))
    }
}

/// Minimal shell-style splitting: whitespace separated, single or double quotes group.
fn shell_words(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    for c in s.chars() {
        match (quote, c) {
            (Some(q), c) if c == q => quote = None,
            (Some(_), c) => cur.push(c),
            (None, '"') | (None, '\'') => quote = Some(c),
            (None, c) if c.is_whitespace() => {
                if !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                }
            }
            (None, c) => cur.push(c),
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

/// Open `file` with the desktop's default application and return at once.
pub fn view(file: &Path) -> Result<(), String> {
    Command::new("xdg-open")
        .arg(file)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("xdg-open: {e}"))
}
