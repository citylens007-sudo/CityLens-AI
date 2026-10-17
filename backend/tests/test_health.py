from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_health_reports_api_liveness() -> None:
    response = client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "citylens-api"}


def test_readiness_reports_unavailable_database(monkeypatch) -> None:
    monkeypatch.setattr("app.health.check_database", lambda: False)

    response = client.get("/api/v1/ready")

    assert response.status_code == 503
    assert response.json() == {"status": "not_ready", "database": "unavailable"}


def test_readiness_reports_connected_database(monkeypatch) -> None:
    monkeypatch.setattr("app.health.check_database", lambda: True)

    response = client.get("/api/v1/ready")

    assert response.status_code == 200
    assert response.json() == {"status": "ready", "database": "connected"}


def test_cors_rejects_untrusted_origin() -> None:
    response = client.options(
        "/api/v1/auth/login",
        headers={
            "Origin": "https://untrusted.example",
            "Access-Control-Request-Method": "POST",
        },
    )

    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers