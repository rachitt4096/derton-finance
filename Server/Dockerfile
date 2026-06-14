FROM python:3.12-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev protobuf-compiler && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml .
RUN pip install --no-cache-dir -e ".[dev]" grpcio-tools

FROM python:3.12-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY . .

RUN python -m grpc_tools.protoc \
    -Iapp/services/upstox \
    --python_out=app/services/upstox \
    app/services/upstox/MarketDataFeedV3.proto

# Copy pre-built frontend if present (built by deploy script before docker build)
RUN mkdir -p /app/frontend_dist
COPY --chown=root:root frontend_dist/ /app/frontend_dist/

ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1

EXPOSE 4000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "4000", "--workers", "1"]
