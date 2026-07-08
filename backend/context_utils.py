"""
Context utilities for LeapReader AI backend.

Provides text trimming to a token budget, using a simple word-based
approximation (1 token ≈ 4 characters, or ≈ 0.75 words).
"""

CHARS_PER_TOKEN = 4
DEFAULT_TOKEN_LIMIT = 8_000


def trim_to_tokens(text: str, max_tokens: int = DEFAULT_TOKEN_LIMIT) -> tuple[str, bool]:
    """
    Trim `text` to fit within `max_tokens`.

    Returns (trimmed_text, was_truncated).
    Truncation happens from the END of the text (keep the beginning).
    """
    max_chars = max_tokens * CHARS_PER_TOKEN
    if len(text) <= max_chars:
        return text, False
    return text[:max_chars], True


def extract_pdf_text(file_path: str, max_chars: int = 50_000) -> tuple[str, bool]:
    """
    Extract full text from a PDF using pypdf.
    Joins pages with '--- PAGE BREAK ---' markers.

    Returns (text, was_truncated).
    """
    from pypdf import PdfReader

    reader = PdfReader(file_path)
    pages = []
    for page in reader.pages:
        text = page.extract_text() or ""
        pages.append(text)

    full_text = "\n--- PAGE BREAK ---\n".join(pages)
    if len(full_text) <= max_chars:
        return full_text, False
    return full_text[:max_chars], True
