# SSM Parameter Store for runtime configuration

# Channel mappings configuration (JSON)
resource "aws_ssm_parameter" "channel_mappings" {
  name        = "/${local.name_prefix}/config/channel-mappings"
  description = "Teams channel mapping configuration for repository-to-channel routing"
  type        = "String"
  value       = jsonencode({
    mappings         = []
    defaultChannelId = ""
  })

  tags = {
    Name = "${local.name_prefix}-channel-mappings"
  }

  lifecycle {
    ignore_changes = [value]
  }
}

# Feature flags
resource "aws_ssm_parameter" "feature_flags" {
  name        = "/${local.name_prefix}/config/feature-flags"
  description = "Feature flags for PR Tracker runtime behavior"
  type        = "String"
  value       = jsonencode({
    approvalChainsEnabled  = true
    mentionCleanupEnabled  = true
    circuitBreakerEnabled  = true
    rateLimitWarnings      = true
  })

  tags = {
    Name = "${local.name_prefix}-feature-flags"
  }

  lifecycle {
    ignore_changes = [value]
  }
}

# Webhook secrets per provider (SecureString encrypted with KMS)
resource "aws_ssm_parameter" "webhook_secret_github" {
  name        = "/${local.name_prefix}/secrets/webhook-secret-github"
  description = "GitHub webhook signature verification secret"
  type        = "SecureString"
  key_id      = aws_kms_key.credential_encryption.key_id
  value       = "placeholder-replace-after-deploy"

  tags = {
    Name = "${local.name_prefix}-webhook-secret-github"
  }

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "webhook_secret_bitbucket" {
  name        = "/${local.name_prefix}/secrets/webhook-secret-bitbucket"
  description = "Bitbucket webhook signature verification secret"
  type        = "SecureString"
  key_id      = aws_kms_key.credential_encryption.key_id
  value       = "placeholder-replace-after-deploy"

  tags = {
    Name = "${local.name_prefix}-webhook-secret-bitbucket"
  }

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "webhook_secret_gitlab" {
  name        = "/${local.name_prefix}/secrets/webhook-secret-gitlab"
  description = "GitLab webhook token verification secret"
  type        = "SecureString"
  key_id      = aws_kms_key.credential_encryption.key_id
  value       = "placeholder-replace-after-deploy"

  tags = {
    Name = "${local.name_prefix}-webhook-secret-gitlab"
  }

  lifecycle {
    ignore_changes = [value]
  }
}
