# Secrets Manager resources for provider credentials
#
# NOTE: Actual secret values are managed outside Terraform.
# Secrets follow the naming pattern: pr-tracker/{provider}/{repo}
# They are pre-created and populated via AWS CLI or console.
# Terraform only defines the secret resources (not the secret values).

# GitHub provider credentials secret
resource "aws_secretsmanager_secret" "provider_credentials_github" {
  name        = "${local.name_prefix}/github/credentials"
  description = "GitHub API credentials for PR Tracker (OAuth tokens or PATs)"
  kms_key_id  = aws_kms_key.credential_encryption.arn

  tags = {
    Name     = "${local.name_prefix}-github-credentials"
    Provider = "github"
  }
}

# Bitbucket provider credentials secret
resource "aws_secretsmanager_secret" "provider_credentials_bitbucket" {
  name        = "${local.name_prefix}/bitbucket/credentials"
  description = "Bitbucket API credentials for PR Tracker (app passwords or OAuth tokens)"
  kms_key_id  = aws_kms_key.credential_encryption.arn

  tags = {
    Name     = "${local.name_prefix}-bitbucket-credentials"
    Provider = "bitbucket"
  }
}

# GitLab provider credentials secret
resource "aws_secretsmanager_secret" "provider_credentials_gitlab" {
  name        = "${local.name_prefix}/gitlab/credentials"
  description = "GitLab API credentials for PR Tracker (personal or project access tokens)"
  kms_key_id  = aws_kms_key.credential_encryption.arn

  tags = {
    Name     = "${local.name_prefix}-gitlab-credentials"
    Provider = "gitlab"
  }
}

# Teams Bot credentials secret
resource "aws_secretsmanager_secret" "teams_bot_credentials" {
  name        = "${local.name_prefix}/teams/bot-credentials"
  description = "Microsoft Teams Bot Framework credentials (app ID and password)"
  kms_key_id  = aws_kms_key.credential_encryption.arn

  tags = {
    Name     = "${local.name_prefix}-teams-bot-credentials"
    Provider = "teams"
  }
}
