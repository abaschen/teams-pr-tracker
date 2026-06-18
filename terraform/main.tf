# Backend configuration uses partial config - values provided at terraform init:
#   terraform init \
#     -backend-config="bucket=<state-bucket-name>" \
#     -backend-config="region=<aws-region>"
terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    key      = "pr-tracker/terraform.tfstate"
    encrypt  = true
    use_lockfile = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = var.project_name
      Environment = local.environment
      ManagedBy   = "terraform"
      Workspace   = terraform.workspace
    }
  }
}

locals {
  environment = var.environment != "" ? var.environment : terraform.workspace
  name_prefix = "${var.project_name}-${local.environment}"
}
