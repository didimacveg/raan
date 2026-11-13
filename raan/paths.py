"""Repository paths shared by every pipeline step."""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"  # raw downloads, git-ignored
RAW = DATA / "raw"
WEB_DATA = ROOT / "web" / "public" / "data"  # small derived artefacts, committed
REPORTS = ROOT / "reports"


def ensure(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path
