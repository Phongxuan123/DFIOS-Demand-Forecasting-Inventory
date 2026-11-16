import sys
import os
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(SCRIPT_DIR, ".."))

from app.core.database import engine
from app.core.schema_upgrades import apply_schema_upgrades
from app.models import Base


def main() -> None:
    Base.metadata.create_all(engine)
    applied = apply_schema_upgrades(engine)
    if applied:
        print("Schema upgrades applied: " + ", ".join(applied))
    # R-17: the default ML schedule is seeded here (and at API startup), never by a GET request
    from app.core.database import SessionLocal
    from app.services.pipeline_service import pipeline_service
    with SessionLocal() as db:
        if pipeline_service.ensure_default_schedule(db):
            print("Default ML pipeline schedule created.")
    print("Tables created!")


if __name__ == "__main__":
    main()
