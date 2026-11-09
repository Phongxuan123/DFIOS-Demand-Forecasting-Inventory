import sys
import os
import uuid
import json
from datetime import datetime, timezone

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(SCRIPT_DIR, ".."))

import pandas as pd
from sqlalchemy import text
from app.core.database import engine

with engine.begin() as conn:
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS data_imports (
            id VARCHAR(100) PRIMARY KEY,
            file_name VARCHAR(255) NOT NULL,
            file_type VARCHAR(50) NOT NULL,
            row_count INTEGER DEFAULT 0,
            status VARCHAR(50) DEFAULT 'COMPLETED',
            uploaded_by VARCHAR(100) DEFAULT 'system',
            summary JSONB,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
    """))

now = datetime.now(timezone.utc)
import_id = "import_m5_seed_001"

summary_data = {
    "dataset": "M5 Walmart",
    "stores": ["CA_1", "TX_1", "WI_1"],
    "total_series": 30490,
    "quality_status": "PASSED"
}

record = [{
    "id": import_id,
    "file_name": "sales_train_evaluation.csv",
    "file_type": "CSV",
    "row_count": 30490,
    "status": "COMPLETED",
    "uploaded_by": "system",
    "summary": json.dumps(summary_data),
    "created_at": now
}]

df = pd.DataFrame(record)

with engine.begin() as conn:
    conn.execute(text("DELETE FROM data_imports WHERE id = :id"), {"id": import_id})

df.to_sql("data_imports", engine, if_exists="append", index=False)
print("Seeded data_imports baseline record!")
