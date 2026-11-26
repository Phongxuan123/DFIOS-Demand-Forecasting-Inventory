import json

import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_current_user
from app.main import app

GOOD = {
    "policy": "REFIT-RSS-EOQ-G", "cost": 719971.2, "holding": 467614.3, "lost": 67794.9, "ordering": 184562,
    "fill": 0.98506, "min_class_csl": 0.95979, "orders": 92281, "n_cycles": 51, "n_skus": 8831,
    "classes": ["AX"], "selection": {"schedule": [{"start": 0, "m": [1], "kappa": [0.5]}]},
}


@pytest.fixture
def client():
    app.dependency_overrides[get_current_user] = lambda: object()
    yield TestClient(app)
    app.dependency_overrides.pop(get_current_user, None)


def _write(tmp_path, monkeypatch, data):
    p = tmp_path / "ref.json"
    p.write_text(json.dumps(data), encoding="utf-8")
    monkeypatch.setenv("E10B_REFERENCE_JSON", str(p))


def test_missing_file(client, tmp_path, monkeypatch):
    monkeypatch.setenv("E10B_REFERENCE_JSON", str(tmp_path / "nope.json"))
    r = client.get("/api/v1/reference/e10b")
    assert r.status_code == 200
    assert r.json()["available"] is False and r.json()["message"]


def test_matching_file(client, tmp_path, monkeypatch):
    _write(tmp_path, monkeypatch, GOOD)
    body = client.get("/api/v1/reference/e10b").json()
    assert body["available"] is True and body["matches"] is True
    assert body["teacher"]["orders"] == 92281
    assert body["selection_schedule"][0]["kappa"] == [0.5]


def test_mismatching_file(client, tmp_path, monkeypatch):
    _write(tmp_path, monkeypatch, {**GOOD, "cost": 720000.0, "orders": 92280})
    body = client.get("/api/v1/reference/e10b").json()
    assert body["available"] is True and body["matches"] is False
    assert body["checks"]["cost"] is False and body["checks"]["orders"] is False
    assert body["checks"]["fill"] is True


def test_invalid_file(client, tmp_path, monkeypatch):
    _write(tmp_path, monkeypatch, {"cost": "x"})
    assert client.get("/api/v1/reference/e10b").json()["available"] is False


def test_requires_auth():
    app.dependency_overrides.pop(get_current_user, None)
    assert TestClient(app).get("/api/v1/reference/e10b").status_code in (401, 403)
