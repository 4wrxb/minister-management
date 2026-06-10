# Copilot Agent Repository Instructions

Use these steps when making changes in this repository so future edits are validated consistently.

## Required validation before finishing

1. Backend checks:
   - `pip install --no-cache-dir -r backend/requirements.txt`
   - `python -m py_compile backend/app.py backend/database.py`
2. Frontend checks:
   - `cd frontend`
   - `npm ci`
   - `npm run lint`
   - `npm run build`

## Repository principles

- Keep changes scoped and avoid unrelated refactors.
- Keep the codebase cloud-agnostic. See [DEPLOYMENT.md](../DEPLOYMENT.md) for the supported deployment paths (bare metal, Docker, Google Cloud Run, AWS, Azure, etc.).
- Preserve existing Flask + SQLite architecture patterns (single-worker gunicorn for production).
- **Keep the docs in sync with the code.** Whenever you add or modify an API endpoint (`backend/app.py`), a database column / table (`backend/database.py`), or an environment variable, update `claude.md`, `PROJECT_SUMMARY.md`, and `RECREATION_GUIDE.md` in the same change, and add a `CHANGELOG.md` entry.
