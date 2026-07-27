FROM python:3.12-slim

WORKDIR /srv

# System CA certs for HTTPS providers + curl for healthcheck
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY public ./public

ARG APP_VERSION=1.0.0
ARG GIT_SHA=unknown
ENV APP_VERSION=$APP_VERSION \
    APP_GIT_SHA=$GIT_SHA \
    PORT=8787 \
    PYTHONUNBUFFERED=1

RUN date -u +"%Y-%m-%dT%H:%M:%SZ" > /srv/app/.build_time

EXPOSE 8787

HEALTHCHECK --interval=20s --timeout=5s --start-period=40s --retries=5 \
  CMD curl -fsS "http://127.0.0.1:${PORT:-8787}/api/health" >/dev/null || exit 1

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8787}"]
