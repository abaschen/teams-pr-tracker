# Teams PR Tracker

Serverless PR tracking system that bridges GitHub, Bitbucket, and GitLab with Microsoft Teams. When a PR is opened, the system evaluates annotation rules, creates a dedicated Teams thread, enforces sequential approval chains, and provides merge-readiness indicators — all running on AWS Lambda + DynamoDB and deployed via Terraform.

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   GitHub     │     │  Bitbucket   │     │   GitLab     │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │ webhook             │ webhook            │ webhook
       └─────────────┬───────┴────────────────────┘
                     ▼
          ┌─────────────────────┐
          │   API Gateway       │  POST /webhook/{provider}
          │   (TLS 1.2+)       │  GET  /health
          └──────────┬──────────┘
                     ▼
          ┌─────────────────────┐
          │   Lambda Function   │  Signature verification
          │   (Node.js 22.x)   │  Event normalization
          └──────────┬──────────┘  Rule evaluation
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
 ┌─────────────┐ ┌────────┐ ┌──────────────┐
 │  DynamoDB   │ │  KMS   │ │ Secrets Mgr  │
 │ (PR state,  │ │        │ │ (credentials)│
 │  rules,     │ └────────┘ └──────────────┘
 │  circuits)  │
 └─────────────┘
        │
        ▼
 ┌─────────────────────┐
 │  Microsoft Teams    │  Thread creation
 │  Bot Framework      │  @mentions / reactions
 └─────────────────────┘
```

## Features

- **Multi-provider webhooks** — GitHub, Bitbucket, GitLab with signature verification
- **Annotation rules** — file path globs, repo name, branch patterns, PR labels
- **Approval chains** — sequential team ordering with automatic activation
- **Teams integration** — dedicated threads, @mentions, merge-readiness reactions
- **Circuit breaker** — automatic credential suspension on repeated auth failures
- **State persistence** — DynamoDB with conditional writes for concurrency safety

## Prerequisites

- Node.js 22+ (LTS)
- pnpm 10+
- AWS CLI v2 configured with appropriate credentials
- Azure CLI (`az`) logged in (for bootstrap)
- Terraform >= 1.5
- Azure AD app registration (for Teams Bot)

## Quick Start

```bash
# Install dependencies
pnpm install

# Build (type-check)
pnpm build

# Bundle for Lambda deployment
pnpm run package

# Run tests
pnpm test

# Lint & format
pnpm lint
pnpm format
```

## Project Structure

```
src/
├── handlers/          # Lambda entry point, webhook routing, signature verification
├── normalizers/       # Provider-specific event normalization (GitHub, Bitbucket, GitLab)
├── engines/           # Rule evaluation engine, team diff, config validation
├── adapters/          # Provider API adapters (labels, reviewers, comments)
├── managers/          # Teams thread, mentions, readiness, approvals, credentials
├── repositories/      # DynamoDB data access (PR state, rules, circuit breakers)
├── models/            # TypeScript interfaces and types
└── utils/             # DynamoDB client, retry logic, error types

test/
├── handlers/          # Handler unit tests
├── normalizers/       # Normalizer unit tests
├── engines/           # Engine unit tests
├── adapters/          # Adapter unit tests
├── managers/          # Manager unit tests
├── repositories/      # Repository unit tests
├── utils/             # Utility unit tests
└── properties/        # Property-based tests (fast-check)

terraform/             # AWS infrastructure (Lambda, DynamoDB, API GW, KMS, SSM, Secrets)
teams-manifest/        # Microsoft Teams app manifest
bootstrap/             # Azure resource provisioning (Bot registration, Teams channel)
vite.lambda.config.ts  # Vite bundler config for Lambda packaging
```

## Deployment

### 1. Bootstrap Azure Resources (Optional)

> In a corporate environment these resources are typically pre-provisioned by the platform team. Use the bootstrap only for greenfield setups or development environments.

The `bootstrap/` folder contains Terraform configuration to create the Azure Bot registration (SingleTenant) and Teams channel:

```bash
cd bootstrap

# Initialize Terraform
terraform init

# Review the plan
terraform plan \
  -var="bot_display_name=PR Tracker" \
  -var="messaging_endpoint=https://<your-api-gw-url>/webhook/teams"

# Apply
terraform apply \
  -var="bot_display_name=PR Tracker" \
  -var="messaging_endpoint=https://<your-api-gw-url>/webhook/teams"
```

This creates:
- Azure AD app registration (SingleTenant, client ID + secret)
- Azure Bot Service (`azurerm_bot_service_azure_bot`, SingleTenant)
- Microsoft Teams channel connection
- Outputs the `bot_app_id` and `bot_app_password` needed for the AWS deployment

See [bootstrap/README.md](bootstrap/README.md) for full details.

### 2. Prepare Remote State (AWS)

Create an S3 bucket for Terraform state (S3-native locking is used automatically):

```bash
# Create state bucket
aws s3api create-bucket \
  --bucket my-pr-tracker-tf-state \
  --region us-east-1

aws s3api put-bucket-versioning \
  --bucket my-pr-tracker-tf-state \
  --versioning-configuration Status=Enabled
```

### 3. Deploy AWS Infrastructure

```bash
cd terraform

# Initialize with remote backend
terraform init \
  -backend-config="bucket=my-pr-tracker-tf-state" \
  -backend-config="region=us-east-1"

# Package the Lambda bundle
cd .. && pnpm run package && cd terraform

# Plan
terraform plan \
  -var="state_bucket=my-pr-tracker-tf-state" \
  -var="teams_bot_id=<bot_app_id-from-azure>" \
  -var="teams_bot_password=<bot_app_password-from-azure>" \
  -var="environment=dev"

# Apply
terraform apply \
  -var="state_bucket=my-pr-tracker-tf-state" \
  -var="teams_bot_id=<bot_app_id-from-azure>" \
  -var="teams_bot_password=<bot_app_password-from-azure>" \
  -var="environment=dev"
```

> **Note:** The Lambda is packaged as a single-file ESM bundle via Vite (see `vite.lambda.config.ts`). No `node_modules` are needed at runtime — all dependencies are inlined.

### 4. Configure Webhook Secrets

After deployment, update the placeholder SSM parameters with real secrets:

```bash
# GitHub webhook secret
aws ssm put-parameter \
  --name "/pr-tracker-dev/secrets/webhook-secret-github" \
  --value "$(openssl rand -base64 24)" \
  --type SecureString \
  --overwrite

# Bitbucket webhook secret
aws ssm put-parameter \
  --name "/pr-tracker-dev/secrets/webhook-secret-bitbucket" \
  --value "$(openssl rand -base64 24)" \
  --type SecureString \
  --overwrite

# GitLab webhook token
aws ssm put-parameter \
  --name "/pr-tracker-dev/secrets/webhook-secret-gitlab" \
  --value "$(openssl rand -base64 24)" \
  --type SecureString \
  --overwrite
```

> **Note:** The Lambda resolves these SSM parameters at runtime (with caching). Updating the value takes effect on the next cold start.

### 5. Configure Provider Credentials

Store provider API tokens in Secrets Manager:

```bash
aws secretsmanager put-secret-value \
  --secret-id "pr-tracker-dev/github/credentials" \
  --secret-string '{"token":"ghp_xxxxxxxxxxxx","type":"pat"}'

aws secretsmanager put-secret-value \
  --secret-id "pr-tracker-dev/bitbucket/credentials" \
  --secret-string '{"username":"bot-user","app_password":"xxxxxx"}'

aws secretsmanager put-secret-value \
  --secret-id "pr-tracker-dev/gitlab/credentials" \
  --secret-string '{"token":"glpat-xxxxxxxxxxxx","type":"project_access_token"}'
```

### 6. Configure Channel Mappings

Update the SSM parameter with repository-to-Teams-channel mappings:

```bash
aws ssm put-parameter \
  --name "/pr-tracker-dev/config/channel-mappings" \
  --type String \
  --overwrite \
  --value '{
    "mappings": [
      {
        "repository": "org/my-repo",
        "provider": "github",
        "channelId": "19:xxxxxxxx@thread.tacv2",
        "teamId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
      }
    ],
    "defaultChannelId": "19:fallback@thread.tacv2"
  }'
```

### 7. Register Webhooks

Use the provider's CLI/API to register webhooks programmatically. The webhook secret must match what's stored in SSM.

**GitHub (via `gh` CLI):**

```bash
# Generate and store a webhook secret
WEBHOOK_SECRET=$(openssl rand -base64 24)
aws ssm put-parameter \
  --name "/pr-tracker-dev/secrets/webhook-secret-github" \
  --value "$WEBHOOK_SECRET" \
  --type SecureString \
  --overwrite

# Register the webhook on a repository
API_URL=$(cd terraform && terraform output -raw api_gateway_url)
gh api repos/<owner>/<repo>/hooks --method POST \
  -f name=web \
  -F active=true \
  -f "config[url]=${API_URL}/github" \
  -f "config[content_type]=json" \
  -f "config[secret]=$WEBHOOK_SECRET" \
  -f "config[insecure_ssl]=0" \
  -f "events[]=pull_request" \
  -f "events[]=pull_request_review"
```

**Webhook URLs by provider:**

| Provider | Webhook URL | Events |
|----------|-------------|--------|
| GitHub | `<api_gateway_url>/github` | `pull_request`, `pull_request_review` |
| Bitbucket | `<api_gateway_url>/bitbucket` | Pull request (all) |
| GitLab | `<api_gateway_url>/gitlab` | Merge request events, Note events |

### 8. Install Teams App

Package and install the Teams manifest via CLI:

```bash
cd teams-manifest

# Update manifest.json with your bot_app_id from bootstrap output
BOT_ID=$(cd ../bootstrap && terraform output -raw bot_app_id)
sed -i "s/\"botId\": \".*\"/\"botId\": \"$BOT_ID\"/" manifest.json

# Package the manifest
zip -r ../pr-tracker-teams-app.zip .

# Upload via Teams Admin (or sideload for development)
# For org-wide deployment (requires Teams Administrator role):
# az teams app publish --app-path ../pr-tracker-teams-app.zip
```

## Configuration

### Annotation Rules

Rules are stored in DynamoDB and determine which validation teams are required for a PR. Example rule structure:

```json
{
  "ruleId": "frontend-review",
  "conditions": {
    "filePatterns": ["src/ui/**/*.tsx", "src/styles/**"],
    "repositories": ["org/web-app"],
    "branches": ["main", "release/*"]
  },
  "teams": [
    { "name": "frontend-team", "reviewers": ["user1", "user2"] }
  ],
  "approvalChain": ["frontend-team", "qa-team"]
}
```

### Feature Flags

Runtime behavior is controlled via SSM Parameter Store:

| Flag | Default | Description |
|------|---------|-------------|
| `approvalChainsEnabled` | `true` | Enable sequential approval enforcement |
| `mentionCleanupEnabled` | `true` | Remove @mentions after team approves |
| `circuitBreakerEnabled` | `true` | Suspend credentials after repeated 401s |
| `rateLimitWarnings` | `true` | Post warnings when rate-limited |

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm build` | Compile TypeScript to `dist/` |
| `pnpm bundle` | Bundle Lambda with Vite into a single ESM file |
| `pnpm package` | Bundle + zip for Lambda deployment |
| `pnpm test` | Run all unit tests |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm test:properties` | Run property-based tests |
| `pnpm test:coverage` | Run tests with coverage report |
| `pnpm lint` | Check for linting errors |
| `pnpm lint:fix` | Auto-fix linting errors |
| `pnpm format` | Format code with Prettier |
| `pnpm format:check` | Check formatting without changes |

## Multi-Region Deployment

Deploy to additional regions using Terraform workspaces:

```bash
cd terraform

# Create a workspace for eu-west-1
terraform workspace new eu-west-1

terraform apply \
  -var="aws_region=eu-west-1" \
  -var="state_bucket=my-pr-tracker-tf-state-eu" \
  -var="teams_bot_id=<bot-id>" \
  -var="teams_bot_password=<bot-password>"
```

## License

ISC
