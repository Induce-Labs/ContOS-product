"""Ingest a DOCX marketing corpus into Supabase pgvector.

Usage (from Agents/backend):
  python scripts/ingest_marketing_knowledge.py ../Transcripts.docx --dry-run
  python scripts/ingest_marketing_knowledge.py ../Transcripts.docx
"""

from __future__ import annotations

import argparse
import hashlib
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path
from typing import Iterator

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

WORD_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def read_docx_paragraphs(path: Path) -> Iterator[tuple[str | None, str]]:
    """Yield (heading, paragraph) pairs using only the DOCX XML standard library."""
    with zipfile.ZipFile(path) as archive:
        root = ET.fromstring(archive.read("word/document.xml"))

    heading: str | None = None
    for paragraph in root.iter(f"{WORD_NS}p"):
        text = "".join(node.text or "" for node in paragraph.iter(f"{WORD_NS}t"))
        text = re.sub(r"\s+", " ", text).strip()
        if not text:
            continue
        style = paragraph.find(f"./{WORD_NS}pPr/{WORD_NS}pStyle")
        style_name = (style.get(f"{WORD_NS}val") if style is not None else "") or ""
        if style_name.lower().startswith("heading"):
            heading = text
            continue
        yield heading, text


def chunk_paragraphs(
    paragraphs: Iterator[tuple[str | None, str]], max_chars: int = 2_600, overlap_chars: int = 320
) -> list[dict[str, object]]:
    """Keep nearby paragraphs together; overlap only within the same section."""
    chunks: list[dict[str, object]] = []
    buffer = ""
    section: str | None = None

    def flush() -> None:
        nonlocal buffer
        content = buffer.strip()
        if content:
            chunks.append({"section": section, "content": content})
        buffer = ""

    for next_section, paragraph in paragraphs:
        if buffer and next_section != section:
            flush()
        if not buffer:
            section = next_section
        candidate = f"{buffer}\n\n{paragraph}".strip()
        if len(candidate) <= max_chars:
            buffer = candidate
            continue
        previous_tail = buffer[-overlap_chars:]
        flush()
        buffer = f"{previous_tail}\n\n{paragraph}".strip()
        while len(buffer) > max_chars:
            split_at = buffer.rfind(" ", 0, max_chars)
            split_at = split_at if split_at > max_chars // 2 else max_chars
            chunks.append({"section": section, "content": buffer[:split_at].strip()})
            buffer = buffer[max(0, split_at - overlap_chars):].strip()
    flush()
    return chunks


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("document", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    document = args.document.resolve()
    if document.suffix.lower() != ".docx" or not document.is_file():
        parser.error("document must be an existing .docx file")

    raw = document.read_bytes()
    source_hash = hashlib.sha256(raw).hexdigest()
    chunks = chunk_paragraphs(read_docx_paragraphs(document))
    if not chunks:
        raise RuntimeError("No readable text found in DOCX")
    print(f"Prepared {len(chunks)} chunks from {document.name} ({source_hash[:12]}…)")
    if args.dry_run:
        print("Dry run: no embeddings generated and no Supabase writes made.")
        return 0

    from db.supabase_client import replace_marketing_knowledge_chunks
    from embeddings.embed import generate_embedding

    rows = []
    for index, chunk in enumerate(chunks):
        content = str(chunk["content"])
        rows.append(
            {
                "source_name": document.name,
                "source_hash": source_hash,
                "section": chunk["section"],
                "chunk_index": index,
                "content": content,
                "metadata": {"source_path": document.name, "char_count": len(content)},
                "embedding": generate_embedding(content),
            }
        )
        print(f"Embedded {index + 1}/{len(chunks)}", flush=True)

    replace_marketing_knowledge_chunks(document.name, rows)
    print(f"Ingested {len(rows)} chunks into marketing_knowledge_chunks.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
