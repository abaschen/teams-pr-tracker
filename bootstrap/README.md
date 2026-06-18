# Bootstrap — Azure Bot & Teams App Registration

This folder contains Terraform configuration to provision the Azure resources required for the Teams PR Tracker bot. It creates an Azure AD app registration, Bot Service channel registration, and connects it to Microsoft Teams.

> **Note:** In most corporate environments, these resources are pre-provisioned by the platform or identity team. Use this bootstrap only for greenfield setups, development environments, or when you need a self-contained deployment.

## What Gets Created

| Resource | Purpose |
|----------|---------|
| Azure AD App Registration | Identity for the bot (client ID + secret) |
| Azure Bot Service | Bot Framework registration with messaging endpoint |
| Teams Channel | Connects the bot to Microsoft Teams |

## Prerequisites

- Azure CLI (`az`) logged in with permissions to:
  - Create app registrations in Azure AD
  - Create Bot Service resources
  - Manage Teams app policies (for org-wide install)
- Terraform >= 1.5
- An Azure subscription with the `Microsoft.BotService` resource provider registered

### Register the Resource Provider (first time only)

```bash
az provider register --namespace Microsoft.BotService
az provider show --namespace Microsoft.BotService --query "registrationState"
# Wait until it shows "Registered"
```

## Usage

```bash
cd bootstrap

# Initialize
terraform init

# Plan — review what will be created
terraform plan \
  -var="bot_display_name=PR Tracker" \
  -var="messaging_endpoint=https://<your-api-gw-url>/webhook/teams"

# Apply
terraform apply \
  -var="bot_display_name=PR Tracker" \
  -var="messaging_endpoint=https://<your-api-gw-url>/webhook/teams"
```

## Outputs

After apply, Terraform outputs the values needed for the AWS deployment:

| Output | Use In |
|--------|--------|
| `bot_app_id` | `terraform/variables.tf` → `teams_bot_id` |
| `bot_app_password` | `terraform/variables.tf` → `teams_bot_password` (store in Secrets Manager) |
| `bot_service_name` | Reference for Teams admin |
| `tenant_id` | Azure AD tenant for token validation |

## Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `bot_display_name` | no | `PR Tracker` | Display name shown in Teams |
| `messaging_endpoint` | no | `""` | Bot messaging endpoint URL (API Gateway URL) |
| `azure_location` | no | `global` | Azure region for Bot Service |
| `sku` | no | `F0` | Bot Service SKU (`F0` = free, `S1` = standard) |
| `tags` | no | `{}` | Additional Azure resource tags |

## Teams App Deployment

After the bot is registered, you can install the Teams app:

1. Update `teams-manifest/manifest.json` with the `bot_app_id` output
2. Package the manifest: `cd teams-manifest && zip -r ../pr-tracker-teams-app.zip .`
3. Upload via Teams Admin Center → Manage Apps → Upload custom app

For org-wide deployment:

```bash
# Requires Teams Administrator role
az teams app publish --app-path ../pr-tracker-teams-app.zip
```

## Teardown

```bash
terraform destroy \
  -var="bot_display_name=PR Tracker" \
  -var="messaging_endpoint=https://example.com"
```

This removes the bot registration and AD app. Existing Teams threads created by the bot will remain but the bot will stop responding.
