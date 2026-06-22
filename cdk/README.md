# AWS CDK Deployment (Alternative to Terraform)

This directory contains the AWS CDK TypeScript equivalent of the `terraform/` deployment.
Both produce the same AWS resources — use whichever IaC tool your team prefers.

## Resources Created

| Resource | Description |
|----------|-------------|
| Lambda Function | Webhook processor (Node.js 22.x) |
| API Gateway (REST) | `/webhook/{provider}` + `/health` |
| DynamoDB Table | Single-table design (PR state, rules, circuit breakers) |
| KMS Key | Credential encryption at rest |
| SSM Parameters | Channel mappings, feature flags, webhook secrets |
| Secrets Manager | Provider credentials (GitHub, Bitbucket, GitLab, Teams) |
| CloudWatch Logs | 30-day retention |

## Prerequisites

- Node.js 22+ and pnpm
- AWS CLI configured with appropriate credentials
- CDK bootstrapped in your account/region:
  ```bash
  npx cdk bootstrap aws://ACCOUNT_ID/REGION
  ```

## Usage

```bash
cd cdk

# Install dependencies
pnpm install

# Build the Lambda bundle first (from project root)
cd .. && pnpm run package && cd cdk

# Synthesize CloudFormation template (dry run)
pnpm run synth

# Deploy
pnpm run deploy -- \
  -c environment=dev \
  -c teamsBotId=<bot-app-id> \
  -c teamsBotPassword=<bot-password> \
  -c teamsTenantId=<azure-tenant-id>

# Diff (see pending changes)
pnpm run diff

# Destroy
pnpm run destroy
```

## Context Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `environment` | no | `dev` | Environment name for resource naming |
| `region` | no | `us-east-1` | AWS region |
| `teamsBotId` | yes | — | Azure AD App ID for the Teams bot |
| `teamsBotPassword` | yes | — | Bot client secret |
| `teamsTenantId` | yes | — | Azure AD tenant ID |

## Compared to Terraform

| Aspect | Terraform | CDK |
|--------|-----------|-----|
| Language | HCL | TypeScript |
| State | S3 bucket (manual setup) | CDK Toolkit stack (auto) |
| Drift detection | `terraform plan` | `cdk diff` |
| Resource naming | Manual `${local.name_prefix}` | Automatic with logical IDs |
| Permissions | Inline IAM policy JSON | `grant*()` methods |
| Secrets | `lifecycle { ignore_changes }` | Not tracked after creation |

Both approaches produce identical infrastructure. The CDK version has the advantage of
sharing the same TypeScript toolchain as the application code.
