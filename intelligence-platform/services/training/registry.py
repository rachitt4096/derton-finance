"""Model registry: artifacts in MinIO/S3, metadata + lineage in ClickHouse.

save_model() persists the booster, calibrator, and move-head as one tarball to
s3://{bucket}/{horizon}/{version}.tar and inserts a row into
predictions.model_registry. load_active() reads model:active:{horizon} from Redis
(or the is_active flag in CH), pulls the tarball, and returns a LoadedModel bundle
ready for serving (incl. a SHAP TreeExplainer).
"""
from __future__ import annotations

import io
import json
import pickle
import tarfile

import boto3

from services.common.clickhouse import get_client
from services.common.config import settings

REG_COLS = ["model_version", "horizon", "algo", "feature_version", "train_start",
            "train_end", "n_samples", "calibration", "val_auc", "val_accuracy",
            "val_ece", "artifact_uri", "params", "is_active"]


def _s3():
    return boto3.client("s3", endpoint_url=settings.s3_endpoint,
                        aws_access_key_id=settings.s3_access_key,
                        aws_secret_access_key=settings.s3_secret_key)


def save_model(horizon, version, booster, calibrator, calibrator_kind,
               move_head, features, metrics, train_start, train_end):
    key = f"{horizon}/{version}.tar"
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as tar:
        for name, obj in [("booster.bin", booster.save_raw()),
                          ("calibrator.pkl", pickle.dumps(calibrator)),
                          ("move_head.bin", move_head.save_raw()),
                          ("meta.json", json.dumps(
                              {"features": features, "calibrator_kind": calibrator_kind,
                               **metrics}).encode())]:
            data = obj if isinstance(obj, (bytes, bytearray)) else bytes(obj)
            ti = tarfile.TarInfo(name)
            ti.size = len(data)
            tar.addfile(ti, io.BytesIO(data))
    buf.seek(0)
    _s3().put_object(Bucket=settings.s3_bucket, Key=key, Body=buf.getvalue())

    ch = get_client()
    ch.insert("predictions.model_registry", [[
        version, horizon, "xgboost", settings.feature_version, train_start,
        train_end, metrics["n_samples"], calibrator_kind, metrics["val_auc"],
        metrics["val_accuracy"], metrics["val_ece"],
        f"s3://{settings.s3_bucket}/{key}", json.dumps({"features": features}), 0,
    ]], column_names=REG_COLS)


def promote(horizon: str, version: str):
    """Mark a version active (sets Redis pointer the inference service reads)."""
    import redis as r
    rc = r.from_url(settings.redis_url, decode_responses=True)
    rc.set(f"model:active:{horizon}", version)
    ch = get_client()
    ch.command(f"ALTER TABLE predictions.model_registry UPDATE is_active = "
               f"if(model_version='{version}',1,0) WHERE horizon='{horizon}'")


def load_active(horizon: str):
    """Return a LoadedModel for the active version of `horizon`."""
    import redis as r
    import shap
    import xgboost as xgb

    from services.inference.predictor import LoadedModel

    rc = r.from_url(settings.redis_url, decode_responses=True)
    version = rc.get(f"model:active:{horizon}")
    if not version:
        ch = get_client()
        version = ch.query(
            f"SELECT model_version FROM predictions.model_registry "
            f"WHERE horizon='{horizon}' AND is_active=1 ORDER BY created_at DESC LIMIT 1"
        ).result_rows[0][0]

    obj = _s3().get_object(Bucket=settings.s3_bucket, Key=f"{horizon}/{version}.tar")
    tar = tarfile.open(fileobj=io.BytesIO(obj["Body"].read()))
    booster = xgb.Booster()
    booster.load_model(bytearray(tar.extractfile("booster.bin").read()))
    move_head = xgb.Booster()
    move_head.load_model(bytearray(tar.extractfile("move_head.bin").read()))
    calibrator = pickle.loads(tar.extractfile("calibrator.pkl").read())
    explainer = shap.TreeExplainer(booster)
    return LoadedModel(version, booster, _wrap_calibrator(calibrator),
                       move_head, sharpness=1.0, explainer=explainer)


def _wrap_calibrator(cal):
    """Normalize Isotonic/LogReg to a .transform(list)->list interface."""
    class _C:
        def transform(self, raw):
            try:
                return cal.transform(raw)                       # isotonic
            except AttributeError:
                import numpy as np
                return cal.predict_proba(np.array(raw).reshape(-1, 1))[:, 1]
    return _C()
