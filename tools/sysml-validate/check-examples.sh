#!/usr/bin/env bash
# Validate every .sysml example with the Pilot Implementation, one fresh kernel per file (so nothing leaks between files).
# Usage: tools/sysml-validate/check-examples.sh [file.sysml ...]   (default: all examples). Exit status 1 if any file has errors.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
files=("$@"); [ ${#files[@]} -eq 0 ] && mapfile -t files < <(find "$ROOT/packages/vscode-sysml-v2/examples/sysml" -name '*.sysml' | sort)
bad=0
for f in "${files[@]}"; do
  out=$(timeout 300 python3 "$HERE/validate.py" "$f" 2>/dev/null | grep -v '^Reading \|^===')
  e=$(grep -c '^ERROR' <<<"$out"); w=$(grep -c '^WARNING' <<<"$out")
  printf '%-48s errors=%s warnings=%s\n' "${f#"$ROOT"/}" "$e" "$w"
  if [ "$e" != 0 ]; then bad=1; grep '^ERROR' <<<"$out" | head -5 | sed 's/^/    /'; fi
done
exit $bad
