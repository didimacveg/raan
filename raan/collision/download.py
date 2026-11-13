"""Download the ESA Collision Avoidance Challenge dataset (Zenodo 4463683, CC BY 4.0)."""

from __future__ import annotations

import hashlib
import io
import zipfile

import requests

from raan.paths import RAW, ensure

RECORD = "10.5281/zenodo.4463683"
URL = (
    "https://zenodo.org/api/records/4463683/files/"
    "Collision%20Avoidance%20Challenge%20-%20Dataset.zip/content"
)
MD5 = "d19dc8875229f2f6893253c38adddc87"
FILES = ("train_data.csv", "test_data.csv", "test_data_private.csv")


def main() -> None:
    out = ensure(RAW / "cac")
    if all((out / f).exists() for f in FILES):
        print(f"dataset already present in {out}")
        return
    print(f"downloading {URL} (221 MB)…")
    blob = requests.get(URL, timeout=1800).content
    digest = hashlib.md5(blob).hexdigest()
    if digest != MD5:
        raise SystemExit(f"checksum mismatch: got {digest}, expected {MD5}")
    with zipfile.ZipFile(io.BytesIO(blob)) as outer:
        for name in outer.namelist():
            base = name.rsplit("/", 1)[-1]
            if base in FILES:
                (out / base).write_bytes(outer.read(name))
            elif base == "train_data.zip":
                with zipfile.ZipFile(io.BytesIO(outer.read(name))) as inner:
                    (out / "train_data.csv").write_bytes(inner.read("train_data.csv"))
    print(f"ok → {out} (md5 {digest})")


if __name__ == "__main__":
    main()
