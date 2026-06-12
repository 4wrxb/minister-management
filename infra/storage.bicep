// Azure Files storage account and file share for persistent SQLite database storage.
// SMB share mounted at /data in the Container App; required SQLITE_VFS=unix-dotfile
// is set in main.bicep because SMB does not honour POSIX fcntl byte-range locks.

@description('Deployment environment (staging | production)')
param environmentName string

@description('Azure region for all resources')
param location string

@description('Azure Files share quota in GB')
param fileShareQuota int = 5

@description('Tags to apply to all resources')
param tags object = {}

@description('Unique suffix for storage account (lowercase alphanumeric, 1-11 chars)')
param storageSuffix string = take(uniqueString(resourceGroup().id, environmentName), 8)

var environmentToken = environmentName == 'production' ? 'prod' : environmentName
var storageAccountName = toLower('minister${environmentToken}${storageSuffix}')
var fileShareName = 'minister-data'

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    accessTier: 'Hot'
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    supportsHttpsTrafficOnly: true
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      defaultAction: 'Allow'
      bypass: 'AzureServices'
    }
  }
  tags: tags
}

resource fileService 'Microsoft.Storage/storageAccounts/fileServices@2023-05-01' = {
  parent: storageAccount
  name: 'default'
}

resource fileShare 'Microsoft.Storage/storageAccounts/fileServices/shares@2023-05-01' = {
  parent: fileService
  name: fileShareName
  properties: {
    shareQuota: fileShareQuota
    enabledProtocols: 'SMB'
    accessTier: 'Hot'
  }
}

// Backups container for pre-deploy DB snapshots taken by the GitHub Actions workflow
resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storageAccount
  name: 'default'
}

resource backupContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'backups'
  properties: {
    publicAccess: 'None'
  }
}

@description('Storage account name')
output storageAccountName string = storageAccount.name

@description('Storage account resource ID')
output storageAccountId string = storageAccount.id

@description('File share name (Azure Files)')
output fileShareName string = fileShareName

@description('Backups blob container name')
output backupContainerName string = backupContainer.name

@description('Primary blob endpoint (for backup URLs)')
output blobEndpoint string = storageAccount.properties.primaryEndpoints.blob

@description('File endpoint (for SMB clients)')
output fileEndpoint string = storageAccount.properties.primaryEndpoints.file
