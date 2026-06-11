#!/bin/bash
# Backup SQLite database from Azure Files to blob storage
# Usage: backup-db.sh <environment> <storage-account> <file-share> <container>

set -euo pipefail

ENVIRONMENT="${1:-staging}"
STORAGE_ACCOUNT="${2}"
FILE_SHARE="${3:-minister-data}"
BACKUP_CONTAINER="${4:-backups}"
TIMESTAMP=$(date -u +'%Y%m%d-%H%M%S')
BACKUP_NAME="minister-backup-${ENVIRONMENT}-${TIMESTAMP}.db"

echo "[INFO] Starting database backup..."
echo "[INFO] Environment: $ENVIRONMENT"
echo "[INFO] Storage Account: $STORAGE_ACCOUNT"
echo "[INFO] File Share: $FILE_SHARE"
echo "[INFO] Backup Name: $BACKUP_NAME"

# Check if storage account is provided
if [ -z "$STORAGE_ACCOUNT" ]; then
  echo "[ERROR] Storage account name required"
  exit 1
fi

# Check if we're authenticated to Azure
if ! az account show > /dev/null 2>&1; then
  echo "[ERROR] Not authenticated to Azure. Run: az login"
  exit 1
fi

# Create blob container if it doesn't exist
ACCOUNT_EXISTS=$(az storage account show --name "$STORAGE_ACCOUNT" --query name -o tsv 2>/dev/null || echo "")
if [ -z "$ACCOUNT_EXISTS" ]; then
  echo "[ERROR] Storage account $STORAGE_ACCOUNT not found"
  exit 1
fi

echo "[INFO] Checking for container '$BACKUP_CONTAINER'..."
CONTAINER_EXISTS=$(az storage container exists \
  --account-name "$STORAGE_ACCOUNT" \
  --name "$BACKUP_CONTAINER" \
  --query exists -o tsv 2>/dev/null || echo "false")

if [ "$CONTAINER_EXISTS" = "false" ]; then
  echo "[INFO] Creating backup container..."
  az storage container create \
    --account-name "$STORAGE_ACCOUNT" \
    --name "$BACKUP_CONTAINER" \
    --public-access off
fi

# Note: Actual file transfer would require file share mounting on the host
# This is a placeholder for the upload logic
echo "[INFO] ✓ Backup prepared: $BACKUP_NAME"
echo "[INFO] Note: Actual backup transfer requires file share mount point"
echo "[INFO] To complete, mount the file share:"
echo "        sudo mount -t cifs //$STORAGE_ACCOUNT.file.core.windows.net/$FILE_SHARE /mnt/share -o username=$STORAGE_ACCOUNT,password=<key>"
echo "        cp /mnt/share/minister.db ./backups/$BACKUP_NAME"
