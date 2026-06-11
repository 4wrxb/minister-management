# Copilot Agent Repository Instructions

For project architecture, business logic, API reference, schema, and development rules, see [`claude.md`](../claude.md).

## Required validation before finishing

1. Backend:
   - `pip install --no-cache-dir -r backend/requirements.txt`
   - `python -m py_compile backend/app.py backend/database.py`
2. Frontend:
   - `cd frontend && npm ci && npm run lint && npm run build`
