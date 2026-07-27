"""App version + build identity (shown in /api/health and the UI)."""
from __future__ import annotations

import os
from pathlib import Path

# Semver — bump on release / meaningful deploy.
APP_VERSION = os.environ.get("APP_VERSION", "1.0.1")

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
