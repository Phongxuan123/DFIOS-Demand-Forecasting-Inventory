import sys, os
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(SCRIPT_DIR, ".."))

from app.core.database import engine
from app.models import Base

Base.metadata.create_all(engine)
print("Tables created!")