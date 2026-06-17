# KMS key for encrypting provider credentials at rest

data "aws_caller_identity" "current" {}

resource "aws_kms_key" "credential_encryption" {
  description             = "KMS key for PR Tracker credential encryption"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowRootAccountFullAccess"
        Effect = "Allow"
        Principal = {
          AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"
        }
        Action   = "kms:*"
        Resource = "*"
      },
      {
        Sid    = "AllowLambdaDecrypt"
        Effect = "Allow"
        Principal = {
          AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${local.name_prefix}-lambda-role"
        }
        Action = [
          "kms:Decrypt",
          "kms:DescribeKey",
          "kms:GenerateDataKey"
        ]
        Resource = "*"
      }
    ]
  })

  tags = {
    Name = "${local.name_prefix}-credential-key"
  }
}

resource "aws_kms_alias" "credential_encryption" {
  name          = "alias/${local.name_prefix}-credentials"
  target_key_id = aws_kms_key.credential_encryption.key_id
}
