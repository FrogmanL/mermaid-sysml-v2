#!/usr/bin/env bash
# Install the SysML v2 Pilot Implementation Jupyter kernel and register it as the user-level kernel "sysml".
# Needs: gh (authenticated), java, python3 with jupyter_client, unzip. Idempotent.
# The ~125 MB download goes to $SYSML_PILOT_DIR (default ~/tools/sysml-pilot), deliberately outside this repo.
set -euo pipefail
DIR="${SYSML_PILOT_DIR:-$HOME/tools/sysml-pilot}"
REPO=Systems-Modeling/SysML-v2-Pilot-Implementation
TAG="${SYSML_PILOT_TAG:-$(gh release list -R "$REPO" -L 1 --json tagName -q '.[0].tagName')}"
mkdir -p "$DIR"; cd "$DIR"
if ! ls sysml/jupyter-sysml-kernel-*-all.jar >/dev/null 2>&1; then
  echo "Downloading kernel from release $TAG ..."
  gh release download "$TAG" -R "$REPO" -p 'jupyter-sysml-kernel-*.zip' --skip-existing
  unzip -q -o jupyter-sysml-kernel-*.zip
fi
python3 - "$DIR/sysml" <<'PY'
import json, os, sys, tempfile
from jupyter_client.kernelspec import KernelSpecManager
d = sys.argv[1]
spec = json.load(open(os.path.join(d, "kernel.json")))
spec["argv"] = ["java", "-Xss4m", "--enable-final-field-mutation=ALL-UNNAMED", "-cp", d + "/*",
                "org.omg.sysml.jupyter.kernel.ISysML", "{connection_file}"]
spec["env"] = {"ISYSML_LIBRARY_PATH": d + "/sysml.library"}
tmp = tempfile.mkdtemp()
json.dump(spec, open(os.path.join(tmp, "kernel.json"), "w"), indent=1)
print("kernel spec:", KernelSpecManager().install_kernel_spec(tmp, "sysml", user=True))
PY
