from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

DATABASE_URL = "postgresql+psycopg2://dfios:dfios123@localhost:5432/dfios"

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine)