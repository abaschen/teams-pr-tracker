# Lambda Function and IAM Configuration

# IAM Role for Lambda execution
resource "aws_iam_role" "lambda_execution" {
  name = "${local.name_prefix}-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })
}

# Attach basic Lambda execution role (CloudWatch Logs)
resource "aws_iam_role_policy_attachment" "lambda_basic_execution" {
  role       = aws_iam_role.lambda_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Attach VPC access policy when VPC is configured
resource "aws_iam_role_policy_attachment" "lambda_vpc_access" {
  count      = length(var.vpc_subnet_ids) > 0 ? 1 : 0
  role       = aws_iam_role.lambda_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

# Custom IAM policy for DynamoDB, SSM, Secrets Manager, and KMS access
resource "aws_iam_policy" "lambda_custom" {
  name        = "${local.name_prefix}-lambda-custom-policy"
  description = "Custom permissions for PR Tracker Lambda: DynamoDB, SSM, Secrets Manager, KMS"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "DynamoDBAccess"
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:Scan"
        ]
        Resource = [
          "arn:aws:dynamodb:${var.aws_region}:*:table/${local.name_prefix}-*",
          "arn:aws:dynamodb:${var.aws_region}:*:table/${local.name_prefix}-*/index/*"
        ]
      },
      {
        Sid    = "SSMParameterAccess"
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters",
          "ssm:GetParametersByPath"
        ]
        Resource = "arn:aws:ssm:${var.aws_region}:*:parameter/${local.name_prefix}/*"
      },
      {
        Sid    = "SecretsManagerAccess"
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = [
          "arn:aws:secretsmanager:${var.aws_region}:*:secret:${local.name_prefix}/*",
          "arn:aws:secretsmanager:${var.aws_region}:*:secret:pr-tracker/*"
        ]
      },
      {
        Sid    = "KMSDecrypt"
        Effect = "Allow"
        Action = [
          "kms:Decrypt",
          "kms:DescribeKey"
        ]
        Resource = "arn:aws:kms:${var.aws_region}:*:key/*"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_custom" {
  role       = aws_iam_role.lambda_execution.name
  policy_arn = aws_iam_policy.lambda_custom.arn
}

# CloudWatch Log Group with 30-day retention
resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${local.name_prefix}-webhook"
  retention_in_days = 30
}

# Lambda Function
resource "aws_lambda_function" "webhook" {
  function_name = "${local.name_prefix}-webhook"
  description   = "PR Tracker webhook processor for GitHub, Bitbucket, and GitLab events"
  role          = aws_iam_role.lambda_execution.arn
  handler       = "dist/handlers/index.handler"
  runtime       = var.lambda_runtime
  memory_size   = var.lambda_memory
  timeout       = var.lambda_timeout

  filename         = "${path.module}/../dist/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../dist/lambda.zip")

  environment {
    variables = {
      TABLE_NAME              = "${local.name_prefix}-state"
      CHANNEL_MAPPING_PARAM   = "/${local.name_prefix}/config/channel-mappings"
      TEAMS_BOT_ID            = var.teams_bot_id
      TEAMS_BOT_PASSWORD      = var.teams_bot_password
      TEAMS_TENANT_ID         = "bac9d2f7-1353-4efe-9c11-f4b3c2ae6445"
      GITHUB_WEBHOOK_SECRET   = "/${local.name_prefix}/secrets/webhook-secret-github"
      BITBUCKET_WEBHOOK_SECRET = "/${local.name_prefix}/secrets/webhook-secret-bitbucket"
      GITLAB_WEBHOOK_SECRET   = "/${local.name_prefix}/secrets/webhook-secret-gitlab"
      NODE_ENV                = local.environment
    }
  }

  # Optional VPC configuration
  dynamic "vpc_config" {
    for_each = length(var.vpc_subnet_ids) > 0 ? [1] : []
    content {
      subnet_ids         = var.vpc_subnet_ids
      security_group_ids = var.vpc_security_group_ids
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.lambda_basic_execution,
    aws_iam_role_policy_attachment.lambda_custom,
    aws_cloudwatch_log_group.lambda
  ]
}
