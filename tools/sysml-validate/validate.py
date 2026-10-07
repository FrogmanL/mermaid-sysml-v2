#!/usr/bin/env python3
"""Validate .sysml files with the SysML v2 Pilot Implementation kernel (headless). Usage: validate.py FILE...  (each file is sent as one cell)"""
import queue, sys
from jupyter_client.manager import start_new_kernel

def run(km, kc, text, timeout=180):
    msg_id = kc.execute(text)
    out, status = [], None
    while True:
        try:
            m = kc.get_iopub_msg(timeout=timeout)
        except queue.Empty:
            return ["<timeout>"], "timeout"
        if m["parent_header"].get("msg_id") != msg_id:
            continue
        t, c = m["msg_type"], m["content"]
        if t == "stream": out.append(c["text"])
        elif t == "error": out.append("ERROR: " + "\n".join(c.get("traceback", [])) or c.get("evalue", ""))
        elif t in ("display_data", "execute_result"): out.append(c["data"].get("text/plain", ""))
        elif t == "status" and c["execution_state"] == "idle": break
    reply = kc.get_shell_msg(timeout=timeout)
    return out, reply["content"].get("status", str(sorted(reply["content"])))

if __name__ == "__main__":
    km, kc = start_new_kernel(kernel_name="sysml", startup_timeout=120)
    try:
        for f in sys.argv[1:]:
            out, st = run(km, kc, open(f).read())
            print(f"=== {f}: kernel status={st}")
            print("\n".join(l for l in "".join(out).splitlines() if not l.startswith("Reading ")) or "(no output)")
    finally:
        kc.stop_channels(); km.shutdown_kernel(now=True)
