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
    print("Tables created!")


if __name__ == "__main__":
    main()
