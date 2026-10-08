//! Git CLI wrapper for nekoit. Everything talks to the `git` binary so that the
//! UI gets exact parity with the user's git configuration, hooks, credential
//! helpers and newest features, and so that every invocation can be shown in a
//! command log.

pub mod diff;
pub mod discovery;
pub mod ignore;
pub mod log;
pub mod remote;
pub mod runner;
pub mod stage;
pub mod status;

pub use diff::*;
pub use discovery::*;
pub use ignore::*;
pub use log::*;
pub use remote::*;
pub use runner::*;
pub use stage::*;
pub use status::*;

#[derive(Debug, thiserror::Error)]
pub enum GitError {
    #[error("failed to start git: {0}")]
    Spawn(#[from] std::io::Error),
    #[error("git {args:?} in {cwd} exited with {code}: {stderr}")]
    Failed {
        cwd: String,
        args: Vec<String>,
        code: i32,
        stderr: String,
    },
    #[error("could not parse git output: {0}")]
    Parse(String),
    #[error("{0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, GitError>;

/// Field separator used in custom `--format` strings (ASCII unit separator).
pub(crate) const US: char = '\u{1f}';
