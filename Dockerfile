FROM python:3.12-slim

WORKDIR /srv

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

# No apt/curl needed — pure Python health probe (works offline in locked-down builds).
HEALTHCHECK --interval=20s --timeout=5s --start-period=45s --retries=5 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:%s/api/health'%(__import__('os').environ.get('PORT','8787')), timeout=4).status==200 else 1)"

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8787}"]
