"""research_v2 H6 / NFR5: the JWT secret must come from the environment, never from a default in the code."""
import pytest

from app.core.config import JWT_SECRET_MIN_LENGTH, resolve_jwt_secret, settings


@pytest.mark.parametrize("raw", [None, "", "   ", "dfios_default_secret_key_change_in_production",
                                 "your_secret_key_here", "CHANGE_ME"])
def test_missing_or_placeholder_secret_refuses_to_start(raw):
    with pytest.raises(RuntimeError, match="JWT_SECRET_KEY"):
        resolve_jwt_secret(raw)


def test_short_secret_refused():
    with pytest.raises(RuntimeError, match=str(JWT_SECRET_MIN_LENGTH)):
        resolve_jwt_secret("x" * (JWT_SECRET_MIN_LENGTH - 1))


def test_real_secret_accepted_and_trimmed():
    key = "k" * JWT_SECRET_MIN_LENGTH
    assert resolve_jwt_secret(f"  {key}\n") == key


def test_running_settings_never_use_the_old_default():
    assert settings.JWT_SECRET_KEY != "dfios_default_secret_key_change_in_production"
    assert len(settings.JWT_SECRET_KEY) >= JWT_SECRET_MIN_LENGTH
