#!/usr/bin/env bash
# Generate Python protobuf bindings for the Upstox V3 MarketDataFeed proto.
# Run once after cloning, or after editing the .proto file.
#
# Requirements: pip install grpcio-tools
set -e
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "Generating MarketDataFeed_pb2.py ..."
python -m grpc_tools.protoc \
    -I services/ingestion \
    --python_out=services/ingestion \
    services/ingestion/MarketDataFeed.proto

echo "Done. Generated: services/ingestion/MarketDataFeed_pb2.py"
