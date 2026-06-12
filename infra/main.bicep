// Root Bicep template for the Ministry Management System on Azure Container Apps.
// Composes storage.bicep (Azure Files for SQLite) + aca.bicep (Container App + env).
//
// Deploy with:
//   az deployment group create \
//     --resource-group <rg> \
//     --template-file infra/main.bicep \
//     --parameters environmentName=staging \
//                  containerImage=ghcr.io/owner/minister-management:latest \
//                  secretKey=... adminPassword=... ministerPassword=...

targetScope = 'resourceGroup'

@description('Deployment environment (staging | production)')
@allowed([
  'staging'
  'production'
])
param environmentName string = 'staging'

@description('Azure region for all resources (defaults to resource group region)')
param location string = resourceGroup().location

@description('Container image URI (e.g. ghcr.io/owner/minister-management:latest)')
param containerImage string

@description('Flask SECRET_KEY for session signing')
@secure()
param secretKey string

@description('Admin login password')
@secure()
param adminPassword string

@description('Minister login password')
@secure()
param ministerPassword string

@description('Azure Files share quota in GB')
@minValue(1)
@maxValue(100)
param fileShareQuota int = 5

@description('Container memory (must pair with cpu — e.g. 0.5 cpu / 1.0Gi)')
param containerMemory string = '1.0Gi'

@description('Container CPU in vCPU')
param containerCpu string = '0.5'

@description('Sub-path for URL_PREFIX (e.g. /ministry); leave empty for root hosting')
param urlPrefix string = ''

@description('Minimum Container App replicas')
@minValue(1)
@maxValue(1)
param minReplicas int = 1

@description('Maximum Container App replicas')
@minValue(1)
@maxValue(1)
param maxReplicas int = 1

@description('Additional tags to apply on top of the defaults')
param extraTags object = {}

var defaultTags = {
  project: 'minister-management'
  environment: environmentName
  'managed-by': 'bicep'
}

var mergedTags = union(defaultTags, extraTags)

// Azure Files storage account + share
module storage './storage.bicep' = {
  name: 'storage'
  params: {
    environmentName: environmentName
    location: location
    fileShareQuota: fileShareQuota
    tags: mergedTags
  }
}

// Container Apps environment + Container App
module aca './aca.bicep' = {
  name: 'aca'
  params: {
    environmentName: environmentName
    location: location
    containerImage: containerImage
    storageAccountName: storage.outputs.storageAccountName
    fileShareName: storage.outputs.fileShareName
    containerMemory: containerMemory
    containerCpu: containerCpu
    urlPrefix: urlPrefix
    minReplicas: minReplicas
    maxReplicas: maxReplicas
    tags: mergedTags
    secretKey: secretKey
    adminPassword: adminPassword
    ministerPassword: ministerPassword
  }
}

// Outputs consumed by scripts/github-configure.sh and the GitHub Actions workflow
@description('Resource group name')
output resourceGroupName string = resourceGroup().name

@description('Deployment environment name')
output environmentName string = environmentName

@description('Storage account name')
output storageAccountName string = storage.outputs.storageAccountName

@description('Azure Files share name (mounted at /data)')
output fileShareName string = storage.outputs.fileShareName

@description('Backups blob container')
output backupContainerName string = storage.outputs.backupContainerName

@description('Primary blob endpoint (https://{account}.blob.core.windows.net/)')
output blobEndpoint string = storage.outputs.blobEndpoint

@description('Container App FQDN')
output containerAppFqdn string = aca.outputs.containerAppFqdn

@description('Container App HTTPS URL')
output containerAppUrl string = aca.outputs.containerAppUrl

@description('Container App name')
output containerAppName string = aca.outputs.containerAppName

@description('Container Apps managed environment name')
output managedEnvName string = aca.outputs.managedEnvName

@description('Log Analytics workspace resource ID')
output logAnalyticsId string = aca.outputs.logAnalyticsId
