import unittest
import pandas as pd
from sqlalchemy import create_engine, text
from app.core.db_bulk import psql_insert_copy


class TestDBBulk(unittest.TestCase):
    def test_psql_insert_copy_fallback_sqlite(self):
        """Kiểm tra psql_insert_copy tự động fallback an toàn và nạp đúng dữ liệu trên sqlite."""
        engine = create_engine("sqlite:///:memory:")
        with engine.begin() as conn:
            conn.execute(text("CREATE TABLE test_items (id INTEGER, name TEXT, val REAL)"))

        df = pd.DataFrame({
            "id": [1, 2, 3],
            "name": ["A", "B", "C"],
            "val": [10.5, 20.0, 30.5],
        })

        with engine.begin() as conn:
            df.to_sql("test_items", conn, if_exists="append", index=False, method=psql_insert_copy)

        read_df = pd.read_sql("SELECT * FROM test_items ORDER BY id", engine)
        self.assertEqual(len(read_df), 3)
        self.assertEqual(list(read_df["name"]), ["A", "B", "C"])
        self.assertEqual(list(read_df["val"]), [10.5, 20.0, 30.5])


if __name__ == "__main__":
    unittest.main()
