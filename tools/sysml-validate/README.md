# sysml-validate

Check `.sysml` files against the OMG SysML v2 **Pilot Implementation** (the reference parser and validator), headless.

    tools/sysml-validate/setup.sh                     # once: download the kernel, register it as Jupyter kernel "sysml"
    tools/sysml-validate/check-examples.sh            # validate every example under packages/vscode-sysml-v2/examples
    python3 tools/sysml-validate/validate.py FILE...  # validate specific files (all files share one kernel session)

Needs `gh`, `java`, `python3` with `jupyter_client`, `unzip`. The download (~125 MB) lives in `$SYSML_PILOT_DIR`
(default `~/tools/sysml-pilot`), outside the repo. Each run reloads the standard library, so allow about a minute per file.

Output is the kernel's own: `ERROR:` / `WARNING:` lines with `line : column`, or one `Package X (id)` line per element when the
file is clean. Line numbers are in the file as validated. Use `check-examples.sh` (fresh kernel per file) for authoritative
results; a shared session can hide errors by letting one file see another's names.

The renderer in `packages/mermaid-sysml-v2` only supports a subset of SysML v2, so passing here does not mean it renders.
Passing here and parsing there are separate checks; the examples are meant to satisfy both.
