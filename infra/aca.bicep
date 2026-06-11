// Azure Container Apps environment + Container App for the Ministry Management System.
// Mounts an Azure Files share at /data so SQLite persists across revisions.

@description('Deployment environment (staging | production)')
param environmentName string

@description('Azure region for all resources')
param location string

@description('Container image URI (e.g. ghcr.io/owner/minister-management:latest)')
param containerImage string

@description('Storage account name backing the Azure Files share')
param storageAccountName string

@description('Azure Files share name to mount at /data')
param fileShareName string

@description('Container memory allocation (must pair with cpu — e.g. 0.5 cpu + 1.0Gi)')
param containerMemory string = '1.0Gi'

@description('Container CPU allocation in vCPU')
param containerCpu string = '0.5'

@description('Sub-path for URL_PREFIX (e.g. /ministry); leave empty for root hosting')
param urlPrefix string = ''

@description('Minimum number of Container App replicas')
@minValue(1)
param minReplicas int = 1

@description('Maximum number of Container App replicas')
@minValue(1)
param maxReplicas int = 3

@description('Tags to apply to all resources')
param tags object = {}

@description('Flask SECRET_KEY')
@secure()
param secretKey string

@description('Admin login password')
@secure()
param adminPassword string

@description('Minister login password')
@secure()
param ministerPassword string

@description('Log Analytics retention in days')
param logRetentionDays int = 30

var logAnalyticsName = 'minister-logs-${environmentName}'
var managedEnvName = 'minister-env-${environmentName}'
var containerAppName = 'minister-app-${environmentName}'
var storageLinkName = 'minister-data'
var fileShareVolumeName = 'data-volume'

// Existing storage account (created by storage.bicep)
resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

// Log Analytics workspace for ACA stdout/stderr capture
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: logAnalyticsName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: logRetentionDays
  }
  tags: tags
}

// Container Apps managed environment
resource managedEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: managedEnvName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
  tags: tags
}

// Bind the Azure Files share to the managed environment as a named storage
resource envStorage 'Microsoft.App/managedEnvironments/storages@2024-03-01' = {
  parent: managedEnv
  name: storageLinkName
  properties: {
    azureFile: {
      accountName: storageAccount.name
      accountKey: storageAccount.listKeys().keys[0].value
      shareName: fileShareName
      accessMode: 'ReadWrite'
    }
  }
}

// The Container App itself
resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: containerAppName
  location: location
  tags: tags
  properties: {
    managedEnvironmentId: managedEnv.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 8080
        transport: 'http'
        allowInsecure: false
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
      }
      secrets: [
        {
          name: 'secret-key'
          value: secretKey
        }
        {
          name: 'admin-password'
          value: adminPassword
        }
        {
          name: 'minister-password'
          value: ministerPassword
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'app'
          image: containerImage
          resources: {
            cpu: json(containerCpu)
            memory: containerMemory
          }
          env: [
            {
              name: 'FLASK_ENV'
              value: 'production'
            }
            {
              name: 'PORT'
              value: '8080'
            }
            {
              name: 'DATABASE_PATH'
              value: '/data/minister.db'
            }
            {
              // SMB does not honour POSIX fcntl byte-range locks — use on-disk
              // dotfile locks instead so SQLite stays reliable on Azure Files.
              name: 'SQLITE_VFS'
              value: 'unix-dotfile'
            }
            {
              name: 'URL_PREFIX'
              value: urlPrefix
            }
            {
              name: 'SECRET_KEY'
              secretRef: 'secret-key'
            }
            {
              name: 'ADMIN_PASSWORD'
              secretRef: 'admin-password'
            }
            {
              name: 'MINISTER_PASSWORD'
              secretRef: 'minister-password'
            }
          ]
          volumeMounts: [
            {
              volumeName: fileShareVolumeName
              mountPath: '/data'
            }
          ]
          probes: [
            {
              type: 'Startup'
              httpGet: {
                path: '/health'
                port: 8080
              }
              initialDelaySeconds: 5
              periodSeconds: 5
              failureThreshold: 12
              timeoutSeconds: 3
            }
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: 8080
              }
              initialDelaySeconds: 30
              periodSeconds: 30
              failureThreshold: 3
              timeoutSeconds: 5
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/health'
                port: 8080
              }
              initialDelaySeconds: 5
              periodSeconds: 10
              failureThreshold: 3
              timeoutSeconds: 3
            }
          ]
        }
      ]
      volumes: [
        {
          name: fileShareVolumeName
          storageType: 'AzureFile'
          storageName: envStorage.name
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
        rules: [
          {
            name: 'http-scale'
            http: {
              metadata: {
                concurrentRequests: '50'
              }
            }
          }
        ]
      }
    }
  }
}

@description('Container App FQDN (without scheme)')
output containerAppFqdn string = containerApp.properties.configuration.ingress.fqdn

@description('Container App URL (https)')
output containerAppUrl string = 'https://${containerApp.properties.configuration.ingress.fqdn}'

@description('Container App name')
output containerAppName string = containerApp.name

@description('Container Apps environment name')
output managedEnvName string = managedEnv.name

@description('Log Analytics workspace ID (for KQL queries)')
output logAnalyticsId string = logAnalytics.id
