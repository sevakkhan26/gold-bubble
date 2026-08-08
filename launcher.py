#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Gold Market Site — Windows launcher (standard library only).

Everything the old batch files did with fragile cmd syntax is done here in
Python: find a working interpreter, stop a stale server on the port, start
the Lite server, wait for it to answer, open the browser, and on failure
show the log. start-site.bat is now just a 5-line stub that calls this file.
"""
import json
import os
import re
import socket
import subprocess
import sys
import time
from pathlib import Path

BASE = Path(__file__).resolve().parent
SERVER = BASE / "lite" / "server.py"
LOG = BASE / "lite.log"
PORT = 8787
URL = f"http://127.0.0.1:{PORT}"


def _reconfigure():
    if os.name == "nt":
        for s in (sys.stdout, sys.stderr):
            try:
                s.reconfigure(encoding="utf-8", errors="replace")
            except Exception:  # noqa: BLE001
                pass


def _expected_version():
    try:
        m = re.search(r'VERSION\s*=\s*"([^"]+)"', SERVER.read_text(encoding="utf-8"))
        return m.group(1) if m else "?"
    except Exception:  # noqa: BLE001
        return "?"


def _port_busy(port=PORT):
    return socket.socket().connect_ex(("127.0.0.1", port)) == 0


def _health_ok():
    try:
        import urllib.request

        with urllib.request.urlopen(URL + "/api/health", timeout=2) as r:
            return r.status == 200
    except Exception:  # noqa: BLE001
        return False


def _running_version():
    try:
        import urllib.request

        with urllib.request.urlopen(URL + "/api/version", timeout=2) as r:
            return (json.loads(r.read().decode("utf-8")) or {}).get("version")
    except Exception:  # noqa: BLE001
        return None


def _kill_port(port=PORT):
    """Stop whatever is listening on the port (Windows)."""
    if os.name != "nt":
        return
    try:
        out = subprocess.run(
            ["netstat", "-ano"], capture_output=True, text=True, timeout=15
        ).stdout
    except Exception:  # noqa: BLE001
        return
    pids = set()
    for line in out.splitlines():
        if f":{port}" in line and "LISTENING" in line:
            parts = line.split()
            if parts:
                pids.add(parts[-1])
    for pid in pids:
        try:
            subprocess.run(["taskkill", "/F", "/PID", pid],
                           capture_output=True, text=True, timeout=10)
        except Exception:  # noqa: BLE001
            pass


def _wait_port_free(port=PORT, secs=10):
    for _ in range(secs):
        if not _port_busy(port):
            return True
        time.sleep(1)
    return False


def _open_browser():
    try:
        import webbrowser

        webbrowser.open(URL)
    except Exception:  # noqa: BLE001
        pass


def _start_server(py):
    if LOG.exists():
        try:
            LOG.unlink()
        except Exception:  # noqa: BLE001
            pass
    logf = open(LOG, "wb", buffering=0)
    flags = 0
    if os.name == "nt" and hasattr(subprocess, "CREATE_NEW_CONSOLE"):
        flags = subprocess.CREATE_NEW_CONSOLE
    subprocess.Popen(
        [str(py), str(SERVER)],
        cwd=str(BASE),
        stdout=logf,
        stderr=subprocess.STDOUT,
        creationflags=flags,
    )


def main():
    _reconfigure()
    exp = _expected_version()
    print("=" * 52)
    print("  Gold Market Site - Launcher")
    print("  Expected version:", exp)
    print("=" * 52)

    if not SERVER.is_file():
        print()
        print("[ERROR] lite/server.py not found!")
        print("  Extract the zip fully first (right-click -> Extract All)")
        print("  and run from inside the extracted folder.")
        return 1

    # 1) Already running with the current version?
    rv = _running_version()
    if rv == exp:
        print(f"Site is already running with the latest version ({rv}).")
        _open_browser()
        return 0

    # 2) Something else is on the port? Stop it (stale old server).
    if _port_busy(PORT):
        print(f"Old/other server is on port {PORT}. Stopping it ...")
        _kill_port(PORT)
        if not _wait_port_free(PORT):
            print("[ERROR] Port is still busy after kill. Close the other program and retry.")
            return 1

    # 3) Start the server.
    print("Python:", sys.executable)
    print("[1/2] Starting server ...")
    _start_server(sys.executable)

    # 4) Wait until it answers (give the firewall dialog time too).
    print("[2/2] Waiting for the site ...")
    ok = False
    for _ in range(90):
        if _health_ok():
            ok = True
            break
        time.sleep(1)

    if ok:
        print("   Site is ready!")
        _open_browser()
        print()
        print("  URL:", URL)
        print("  Version:", exp)
        print("  To stop the site, close the 'Gold Market Site Server' window.")
    else:
        print()
        print("[ERROR] The site did not come up.")
        print("  1) If Windows showed a Firewall dialog, click 'Allow access',")
        print("     then run again.")
        print("  2) Last lines of the log:")
        try:
            tail = LOG.read_text(encoding="utf-8", errors="replace").splitlines()[-15:]
            for line in tail:
                print("     " + line)
        except Exception:  # noqa: BLE001
            print("     (no log yet)")
        if os.name == "nt":
            try:
                subprocess.Popen(["notepad", str(LOG)])
            except Exception:  # noqa: BLE001
                pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
