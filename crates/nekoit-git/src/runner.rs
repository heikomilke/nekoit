use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::{GitError, Result};

/// One git invocation, as shown in the UI command log.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandRecord {
    pub id: u64,
    pub cwd: String,
    pub args: Vec<String>,
    pub exit_code: Option<i32>,
    pub duration_ms: u64,
    pub started_at_ms: u64,
    pub stderr: String,
}

pub type LogSink = Arc<dyn Fn(&CommandRecord) + Send + Sync>;

pub struct Output {
    pub stdout: Vec<u8>,
    pub stderr: String,
    pub code: i32,
}

/// Runs git commands. Cheap to clone-by-reference; hold one per app.
pub struct Git {
    sink: Option<LogSink>,
    counter: AtomicU64,
    binary: String,
}

impl Default for Git {
    fn default() -> Self {
        Self::new()
    }
}

impl Git {
    pub fn new() -> Self {
        Self { sink: None, counter: AtomicU64::new(1), binary: "git".into() }
    }

    pub fn with_sink(sink: LogSink) -> Self {
        Self { sink: Some(sink), ..Self::new() }
    }

    fn command(&self, cwd: &Path, args: &[&str]) -> Command {
        let mut cmd = Command::new(&self.binary);
        cmd.args(args)
            .current_dir(cwd)
            .env("LC_ALL", "C")
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_OPTIONAL_LOCKS", "0")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        cmd
    }

    /// Run git and return raw output regardless of exit code.
    pub fn run_raw(&self, cwd: &Path, args: &[&str]) -> Result<Output> {
        self.run_impl(cwd, args, None)
    }

    /// Run git, feeding `stdin`, and return raw output regardless of exit code.
    pub fn run_raw_with_stdin(&self, cwd: &Path, args: &[&str], stdin: &[u8]) -> Result<Output> {
        self.run_impl(cwd, args, Some(stdin))
    }

    /// Run git and return stdout as lossy UTF-8; non-zero exit is an error.
    pub fn run(&self, cwd: &Path, args: &[&str]) -> Result<String> {
        let out = self.run_raw(cwd, args)?;
        self.check(cwd, args, out).map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
    }

    /// Run git with stdin; non-zero exit is an error.
    pub fn run_with_stdin(&self, cwd: &Path, args: &[&str], stdin: &[u8]) -> Result<String> {
        let out = self.run_raw_with_stdin(cwd, args, stdin)?;
        self.check(cwd, args, out).map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
    }

    /// Run git and return stdout bytes; non-zero exit is an error.
    pub fn run_bytes(&self, cwd: &Path, args: &[&str]) -> Result<Vec<u8>> {
        let out = self.run_raw(cwd, args)?;
        self.check(cwd, args, out).map(|o| o.stdout)
    }

    fn check(&self, cwd: &Path, args: &[&str], out: Output) -> Result<Output> {
        if out.code == 0 {
            Ok(out)
        } else {
            Err(GitError::Failed {
                cwd: cwd.display().to_string(),
                args: args.iter().map(|s| s.to_string()).collect(),
                code: out.code,
                stderr: out.stderr,
            })
        }
    }

    fn run_impl(&self, cwd: &Path, args: &[&str], stdin: Option<&[u8]>) -> Result<Output> {
        let mut cmd = self.command(cwd, args);
        if stdin.is_some() {
            cmd.stdin(Stdio::piped());
        }
        let started = Instant::now();
        let started_at_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let mut child = cmd.spawn()?;
        if let Some(data) = stdin {
            if let Some(mut pipe) = child.stdin.take() {
                pipe.write_all(data)?;
            }
        }
        let output = child.wait_with_output()?;
        let code = output.status.code().unwrap_or(-1);
        let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
        if let Some(sink) = &self.sink {
            sink(&CommandRecord {
                id: self.counter.fetch_add(1, Ordering::Relaxed),
                cwd: cwd.display().to_string(),
                args: args.iter().map(|s| s.to_string()).collect(),
                exit_code: output.status.code(),
                duration_ms: started.elapsed().as_millis() as u64,
                started_at_ms,
                stderr: stderr.clone(),
            });
        }
        Ok(Output { stdout: output.stdout, stderr, code })
    }
}
