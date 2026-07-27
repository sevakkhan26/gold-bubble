FROM python:3.12-slim

WORKDIR /srv

# Prefer offline wheelhouse (LAN builds often cannot reach PyPI).
# Host: pip download -r requirements.txt -d wheelhouse \
#         --python-version 312 --platform manylinux2014_x86_64 --only-binary=:all:
COPY requirements.txt .
COPY wheelhouse /wheelhouse/
RUN set -e; \
    if ls /wheelhouse/*.whl >/dev/null 2>&1; then \
      echo "pip: offline wheelhouse"; \
      pip install --no-index --find-links=/wheelhouse -r requirements.txt; \
    else \
      pip install --no-cache-dir -r requirements.txt; \
    fi; \
    rm -rf /wheelhouse

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

HEALTHCHECK --interval=20s --timeout=5s --start-period=45s --retries=5 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:%s/api/health'%(__import__('os').environ.get('PORT','8787')), timeout=4).status==200 else 1)"

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8787}"]
