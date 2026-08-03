"""App version + build identity (shown in /api/health and the UI)."""
from __future__ import annotations

import os
from pathlib import Path

# Semver — bump on release / meaningful deploy. This constant is the source of
# truth: a stale APP_VERSION in the server's .env used to win here and report an
# old version for a freshly deployed SHA, which made deploys look like they had
# not landed. The env var is now only a fallback.
_CODE_VERSION = "2.0.2"
APP_VERSION = _CODE_VERSION or os.environ.get("APP_VERSION", "0.0.0")

# Prefer Docker build-arg (APP_GIT_SHA); fall back to git or "dev".
APP_GIT_SHA = (os.environ.get("APP_GIT_SHA") or os.environ.get("GIT_SHA") or "dev").strip()

_BUILD_TIME_FILE = Path(__file__).resolve().parent / ".build_time"
APP_BUILD_TIME = (
    os.environ.get("APP_BUILD_TIME")
    or (_BUILD_TIME_FILE.read_text(encoding="utf-8").strip() if _BUILD_TIME_FILE.exists() else None)
    or "unknown"
)


def public_version() -> dict:
    return {
        "version": APP_VERSION,
        "gitSha": APP_GIT_SHA,
        "buildTime": APP_BUILD_TIME,
    }
