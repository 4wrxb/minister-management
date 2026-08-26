# Multi-stage build for optimized Cloud Run deployment

# Stage 1: Build frontend
FROM node:20.19-alpine AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# Stage 2: Backend with built frontend
FROM python:3.11-slim

WORKDIR /app

# Copy backend requirements and install
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY backend/ ./

# Copy built frontend
COPY --from=frontend-builder /app/frontend/dist ./static

# Create data directory for persistent storage
RUN mkdir -p /data

# Set environment variables
ENV FLASK_ENV=production
ENV PYTHONUNBUFFERED=1
ENV PORT=8080
ENV DATABASE_PATH=/data/minister.db

# OCI image metadata
# org.opencontainers.image.source connects the GHCR package to this
# repository on first push, so the package surfaces on the repo's
# Packages tab and exposes the "Inherit access from source repository"
# visibility option. Required for the ACA deploy workflow to pass its
# verify-package-visibility preflight without a registry PAT.
LABEL org.opencontainers.image.source="https://github.com/4wrxb/minister-management" \
      org.opencontainers.image.description="Whiteout Survival ministry-position scheduling system" \
      org.opencontainers.image.title="minister-management"

# Expose port
EXPOSE 8080

# Run with gunicorn - single worker to prevent concurrent SQLite writes on GCS FUSE
# Multiple workers cause journal file OutOfOrderError on GCS FUSE
CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "1", "--threads", "2", "--timeout", "120", "app:app"]
