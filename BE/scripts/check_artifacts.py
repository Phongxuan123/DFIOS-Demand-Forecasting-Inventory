"""
P-05: kiểm tra artifact khoa học bắt buộc (không tải tự động, chủ dự án gửi file cho thành viên).

Cách dùng (chạy từ thư mục BE/):
    python scripts/check_artifacts.py                 # kiểm tra tồn tại + kích thước + sha256
    python scripts/check_artifacts.py --quick         # chỉ kiểm tra tồn tại + kích thước
    python scripts/check_artifacts.py --update-manifest   # (chủ dự án) tính lại sha256 từ file hiện có

Vị trí mong đợi (xem artifacts_manifest.json):
    location "scripts"  -> $DFIOS_ARTIFACTS_DIR nếu đặt, mặc định BE/scripts/
    location "MODEL"    -> BE/MODEL/
Thoát với mã 1 và in danh sách rõ ràng nếu thiếu hoặc sai nội dung.
"""
import argparse
import hashlib
import json
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BE_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
MANIFEST_PATH = os.path.join(SCRIPT_DIR, "artifacts_manifest.json")


def artifacts_dir() -> str:
    return os.path.abspath(os.getenv("DFIOS_ARTIFACTS_DIR") or SCRIPT_DIR)


def resolve(entry: dict) -> str:
    base = artifacts_dir() if entry["location"] == "scripts" else os.path.join(BE_DIR, "MODEL")
    return os.path.join(base, entry["name"])


def sha256_of(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def load_manifest() -> dict:
    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def check(quick: bool = False) -> list:
    """Trả về danh sách lỗi (rỗng nếu mọi artifact hợp lệ)."""
    problems = []
    for entry in load_manifest()["files"]:
        path = resolve(entry)
        if not os.path.isfile(path):
            problems.append(f"MISSING   {entry['location']}/{entry['name']}  (expected at {path}) - {entry['purpose']}")
            continue
        size = os.path.getsize(path)
        if size != entry["size"]:
            problems.append(f"SIZE      {entry['location']}/{entry['name']}: {size} bytes, expected {entry['size']}")
            continue
        if not quick and sha256_of(path) != entry["sha256"]:
            problems.append(f"CHECKSUM  {entry['location']}/{entry['name']}: sha256 differs from manifest (wrong or modified file)")
    return problems


def update_manifest() -> None:
    manifest = load_manifest() if os.path.exists(MANIFEST_PATH) else {"files": []}
    for entry in manifest["files"]:
        path = resolve(entry)
        if not os.path.isfile(path):
            raise SystemExit(f"Cannot update: {path} is missing")
        entry["size"] = os.path.getsize(path)
        entry["sha256"] = sha256_of(path)
    with open(MANIFEST_PATH, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"Manifest updated: {MANIFEST_PATH}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--quick", action="store_true", help="skip sha256, check existence and size only")
    parser.add_argument("--update-manifest", action="store_true", help="recompute sizes/sha256 from local files")
    args = parser.parse_args()
    if args.update_manifest:
        update_manifest()
        return 0
    problems = check(quick=args.quick)
    if problems:
        print("ARTIFACT CHECK FAILED:", file=sys.stderr)
        for p in problems:
            print("  " + p, file=sys.stderr)
        print(
            "\nAsk the project owner for the missing/updated files and place them at the paths above "
            "(files are distributed manually; they are not in git).",
            file=sys.stderr,
        )
        return 1
    n = len(load_manifest()["files"])
    print(f"Artifacts OK ({n} files{' - quick' if args.quick else ', sha256 verified'}) in {artifacts_dir()} and {os.path.join(BE_DIR, 'MODEL')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
