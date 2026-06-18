variable "aws_region" {
  description = "AWS region for deployment"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name (defaults to Terraform workspace name if empty)"
  type        = string
  default     = ""
}

variable "project_name" {
  description = "Project name used for resource naming"
  type        = string
  default     = "pr-tracker"
}

variable "state_bucket" {
  description = "S3 bucket name for Terraform remote state"
  type        = string
}

variable "lambda_runtime" {
  description = "Lambda function runtime"
  type        = string
  default     = "nodejs22.x"
}

variable "lambda_memory" {
  description = "Lambda function memory in MB"
  type        = number
  default     = 256
}

variable "lambda_timeout" {
  description = "Lambda function timeout in seconds"
  type        = number
  default     = 30
}

variable "teams_bot_id" {
  description = "Microsoft Teams Bot ID"
  type        = string
}

variable "teams_bot_password" {
  description = "Microsoft Teams Bot password"
  type        = string
  sensitive   = true
}

variable "vpc_subnet_ids" {
  description = "VPC subnet IDs for Lambda (optional)"
  type        = list(string)
  default     = []
}

variable "vpc_security_group_ids" {
  description = "VPC security group IDs for Lambda (optional)"
  type        = list(string)
  default     = []
}
