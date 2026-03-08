"""
Fetches Mermaid documentation from GitHub on first startup.
Dynamically discovers .md files via the GitHub Contents API
"""

import asyncio
import httpx
from pathlib import Path

DOCS_DIR = Path(__file__).parent.parent / "docs" / "mermaid"

GITHUB_API_BASE = "https://api.github.com/repos/mermaid-js/mermaid/contents"
GITHUB_REF = "mermaid@11.12.3"

# Directories to fetch from the Mermaid repo
DOC_PATHS = ["docs/syntax"]


def docs_exist() -> bool:
    """Check if docs have already been fetched."""
    return DOCS_DIR.exists() and any(DOCS_DIR.glob("**/*.md"))


async def _list_md_files(client: httpx.AsyncClient, repo_path: str) -> list[dict]:
    """
    Use GitHub Contents API to list .md files in a repo directory.
    Returns list of {name, download_url} dicts.
    """
    url = f"{GITHUB_API_BASE}/{repo_path}"
    resp = await client.get(
        url,
        params={"ref": GITHUB_REF},
        headers={"Accept": "application/vnd.github.v3+json"},
    )
    resp.raise_for_status()

    entries = resp.json()
    return [
        {"name": entry["name"], "download_url": entry["download_url"]}
        for entry in entries
        if entry["type"] == "file" and entry["name"].endswith(".md")
    ]


async def _download_file(client: httpx.AsyncClient, url: str, dest: Path) -> bool:
    """Download a single file."""
    try:
        resp = await client.get(url, follow_redirects=True)
        resp.raise_for_status()
        dest.write_text(resp.text, encoding="utf-8")
        return True
    except Exception as e:
        print(f"[docs] Failed to fetch {url}: {e}")
        return False


async def fetch_docs(force: bool = False) -> None:
    """
    Download Mermaid docs from GitHub if not already cached.
    Dynamically discovers which .md files exist in each directory.
    """
    if not force and docs_exist():
        print("[docs] Mermaid docs already cached, skipping fetch")
        return

    print("[docs] Fetching Mermaid documentation from GitHub...")

    async with httpx.AsyncClient(timeout=30.0) as client:
        tasks = []

        for repo_path in DOC_PATHS:
            local_subdir = repo_path.split("/", 1)[1]  # "syntax" or "intro"
            local_dir = DOCS_DIR / local_subdir
            local_dir.mkdir(parents=True, exist_ok=True)

            try:
                md_files = await _list_md_files(client, repo_path)
                print(f"[docs] Found {len(md_files)} .md files in {repo_path}")
            except Exception as e:
                print(f"[docs] Failed to list {repo_path}: {e}")
                continue

            for file_info in md_files:
                dest = local_dir / file_info["name"]
                tasks.append(_download_file(client, file_info["download_url"], dest))

        if tasks:
            results = await asyncio.gather(*tasks, return_exceptions=True)
            success = sum(1 for r in results if r is True)
            failed = sum(1 for r in results if r is not True)
            print(f"[docs] Fetched {success} docs ({failed} failures)")
        else:
            print("[docs] No files discovered — check network or GitHub API")
