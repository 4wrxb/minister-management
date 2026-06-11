#!/bin/bash
# Configure GitHub repository with Bicep deployment outputs
# This script is called by the GitHub Actions workflow after successful deployment
# It extracts Bicep outputs and updates GitHub repository variables/secrets

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
  echo -e "${GREEN}[INFO]${NC} $*"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $*"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $*"
}

# Parse arguments
ENVIRONMENT="${1:-staging}"
RESOURCE_GROUP="${2:-minister-rg-${ENVIRONMENT}}"

log_info "Configuring GitHub repository for environment: $ENVIRONMENT"
log_info "Resource group: $RESOURCE_GROUP"

# Check if Azure CLI is available
if ! command -v az &> /dev/null; then
  log_error "Azure CLI (az) not found. Install from https://docs.microsoft.com/cli/azure/install-azure-cli"
  exit 1
fi

# Check if gh CLI is available
if ! command -v gh &> /dev/null; then
  log_error "GitHub CLI (gh) not found. Install from https://cli.github.com/"
  exit 1
fi

# Check if we're authenticated to Azure
if ! az account show > /dev/null 2>&1; then
  log_error "Not authenticated to Azure. Run: az login"
  exit 1
fi

# Check if we're authenticated to GitHub
if ! gh auth status > /dev/null 2>&1; then
  log_error "Not authenticated to GitHub. Run: gh auth login"
  exit 1
fi

# Get current repo
REPO_OWNER=$(gh api user --jq .login)
REPO_NAME=$(git rev-parse --show-toplevel | xargs basename)
REPO_FULL_NAME="${REPO_OWNER}/${REPO_NAME}"

log_info "Repository: $REPO_FULL_NAME"

# Extract Bicep deployment outputs
log_info "Retrieving deployment outputs from Azure..."

OUTPUTS=$(az deployment group show \
  --resource-group "$RESOURCE_GROUP" \
  --name main-deployment \
  --query properties.outputs \
  -o json 2>/dev/null || echo '{}')

# Extract individual outputs
CONTAINER_APP_URL=$(echo "$OUTPUTS" | jq -r '.containerAppUrl.value // empty')
STORAGE_ACCOUNT=$(echo "$OUTPUTS" | jq -r '.storageAccountName.value // empty')
STORAGE_CONNECTION=$(echo "$OUTPUTS" | jq -r '.storageConnectionString.value // empty')
FILE_SHARE_NAME=$(echo "$OUTPUTS" | jq -r '.fileShareName.value // empty')
MANAGED_IDENTITY_ID=$(echo "$OUTPUTS" | jq -r '.managedIdentityId.value // empty')

if [ -z "$CONTAINER_APP_URL" ]; then
  log_warn "Could not retrieve Container App URL. Deployment may have failed or be incomplete."
else
  log_info "✓ Container App URL: $CONTAINER_APP_URL"
fi

# Update GitHub repository variables
log_info "Updating GitHub repository variables..."

# Container App URL
if [ -n "$CONTAINER_APP_URL" ]; then
  gh variable set "CONTAINER_APP_URL_${ENVIRONMENT^^}" --body "$CONTAINER_APP_URL" || true
  log_info "✓ Set CONTAINER_APP_URL_${ENVIRONMENT^^} = $CONTAINER_APP_URL"
fi

# Storage account name
if [ -n "$STORAGE_ACCOUNT" ]; then
  gh variable set "STORAGE_ACCOUNT_${ENVIRONMENT^^}" --body "$STORAGE_ACCOUNT" || true
  log_info "✓ Set STORAGE_ACCOUNT_${ENVIRONMENT^^} = $STORAGE_ACCOUNT"
fi

# File share name
if [ -n "$FILE_SHARE_NAME" ]; then
  gh variable set "FILE_SHARE_${ENVIRONMENT^^}" --body "$FILE_SHARE_NAME" || true
  log_info "✓ Set FILE_SHARE_${ENVIRONMENT^^} = $FILE_SHARE_NAME"
fi

# Managed identity ID
if [ -n "$MANAGED_IDENTITY_ID" ]; then
  gh variable set "MANAGED_IDENTITY_ID_${ENVIRONMENT^^}" --body "$MANAGED_IDENTITY_ID" || true
  log_info "✓ Set MANAGED_IDENTITY_ID_${ENVIRONMENT^^} = $MANAGED_IDENTITY_ID"
fi

# Optional: Store connection string as secret (more sensitive)
if [ -n "$STORAGE_CONNECTION" ]; then
  gh secret set "STORAGE_CONNECTION_${ENVIRONMENT^^}" --body "$STORAGE_CONNECTION" || true
  log_info "✓ Set STORAGE_CONNECTION_${ENVIRONMENT^^} (secret)"
fi

log_info "GitHub repository configuration complete!"
log_info ""
log_info "Updated variables (accessible in workflows):"
log_info "  - CONTAINER_APP_URL_${ENVIRONMENT^^}"
log_info "  - STORAGE_ACCOUNT_${ENVIRONMENT^^}"
log_info "  - FILE_SHARE_${ENVIRONMENT^^}"
log_info "  - MANAGED_IDENTITY_ID_${ENVIRONMENT^^}"

log_info ""
log_info "Usage in GitHub Actions:"
log_info "  \${{ vars.CONTAINER_APP_URL_${ENVIRONMENT^^} }}"
log_info "  \${{ secrets.STORAGE_CONNECTION_${ENVIRONMENT^^} }}"
