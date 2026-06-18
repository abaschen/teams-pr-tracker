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
- Terraform >= 1.5
- Azure AD app registration (for Teams Bot)

## Quick Start

```bash
# Install dependencies
pnpm install

# Build
pnpm build

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
bootstrap/             # Azure resource provisioning (Bot registration, subscription setup)
```

## Deployment

### 1. Bootstrap Azure Resources (Optional)

> In a corporate environment these resources are typically pre-provisioned by the platform team. Use the bootstrap only for greenfield setups or development environments.

The `bootstrap/` folder contains Terraform configuration to create the Azure Bot registration and Teams app:

```bash
cd bootstrap

# Initialize Terraform
terraform init

# Review the plan
terraform plan -var="bot_display_name=PR Tracker" \
               -var="teams_app_name=PR Tracker"

# Apply
terraform apply -var="bot_display_name=PR Tracker" \
                -var="teams_app_name=PR Tracker"
```

This creates:
- Azure AD app registration (client ID + secret)
- Azure Bot Service channel registration
- Microsoft Teams channel connection
- Outputs the `bot_id` and `bot_password` needed for the AWS deployment

See [bootstrap/README.md](bootstrap/README.md) for full details.

### 2. Prepare Remote State (AWS)

Create an S3 bucket and DynamoDB table for Terraform state:

```bash
# Create state bucket
aws s3api create-bucket \
  --bucket my-pr-tracker-tf-state \
  --region us-east-1

aws s3api put-bucket-versioning \
  --bucket my-pr-tracker-tf-state \
  --versioning-configuration Status=Enabled

# Create lock table
aws dynamodb create-table \
  --table-name my-pr-tracker-tf-lock \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1
```

### 3. Deploy AWS Infrastructure

```bash
cd terraform

# Initialize with remote backend
terraform init \
  -backend-config="bucket=my-pr-tracker-tf-state" \
  -backend-config="dynamodb_table=my-pr-tracker-tf-lock" \
  -backend-config="region=us-east-1"

# Plan
terraform plan \
  -var="state_bucket=my-pr-tracker-tf-state" \
  -var="state_lock_table=my-pr-tracker-tf-lock" \
  -var="teams_bot_id=<bot-id-from-azure>" \
  -var="teams_bot_password=<bot-password-from-azure>"

# Apply
terraform apply \
  -var="state_bucket=my-pr-tracker-tf-state" \
  -var="state_lock_table=my-pr-tracker-tf-lock" \
  -var="teams_bot_id=<bot-id-from-azure>" \
  -var="teams_bot_password=<bot-password-from-azure>"
```

### 4. Configure Webhook Secrets

After deployment, update the placeholder SSM parameters with real secrets:

```bash
# GitHub webhook secret
aws ssm put-parameter \
  --name "/pr-tracker-default/secrets/webhook-secret-github" \
  --value "<your-github-webhook-secret>" \
  --type SecureString \
  --overwrite

# Bitbucket webhook secret
aws ssm put-parameter \
  --name "/pr-tracker-default/secrets/webhook-secret-bitbucket" \
  --value "<your-bitbucket-webhook-secret>" \
  --type SecureString \
  --overwrite

# GitLab webhook token
aws ssm put-parameter \
  --name "/pr-tracker-default/secrets/webhook-secret-gitlab" \
  --value "<your-gitlab-webhook-token>" \
  --type SecureString \
  --overwrite
```

### 5. Configure Provider Credentials

Store provider API tokens in Secrets Manager:

```bash
aws secretsmanager put-secret-value \
  --secret-id "pr-tracker-default/github/credentials" \
  --secret-string '{"token":"ghp_xxxxxxxxxxxx","type":"pat"}'

aws secretsmanager put-secret-value \
  --secret-id "pr-tracker-default/bitbucket/credentials" \
  --secret-string '{"username":"bot-user","app_password":"xxxxxx"}'

aws secretsmanager put-secret-value \
  --secret-id "pr-tracker-default/gitlab/credentials" \
  --secret-string '{"token":"glpat-xxxxxxxxxxxx","type":"project_access_token"}'
```

### 6. Configure Channel Mappings

Update the SSM parameter with repository-to-Teams-channel mappings:

```bash
aws ssm put-parameter \
  --name "/pr-tracker-default/config/channel-mappings" \
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

Configure webhooks in each source control provider pointing to the API Gateway URL:

| Provider | Webhook URL | Events |
|----------|-------------|--------|
| GitHub | `https://<api-id>.execute-api.<region>.amazonaws.com/<stage>/webhook/github` | Pull requests, Pull request reviews, Issue comments |
| Bitbucket | `https://<api-id>.execute-api.<region>.amazonaws.com/<stage>/webhook/bitbucket` | Pull request (all) |
| GitLab | `https://<api-id>.execute-api.<region>.amazonaws.com/<stage>/webhook/gitlab` | Merge request events, Note events |

### 8. Install Teams App

Package and install the Teams manifest:

```bash
cd teams-manifest
# Update manifest.json with your bot ID and org details
zip -r ../pr-tracker-teams-app.zip manifest.json color.png outline.png
```

Upload the zip via Teams Admin Center or side-load for development.

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
  -var="state_lock_table=my-pr-tracker-tf-lock-eu" \
  -var="teams_bot_id=<bot-id>" \
  -var="teams_bot_password=<bot-password>"
```

## License

ISC
