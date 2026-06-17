output "api_gateway_url" {
  description = "API Gateway webhook endpoint URL"
  value       = "" # Populated after API Gateway resource is defined in api-gateway.tf
}

output "lambda_function_arn" {
  description = "ARN of the PR Tracker Lambda function"
  value       = "" # Populated after Lambda resource is defined in lambda.tf
}

output "lambda_function_name" {
  description = "Name of the PR Tracker Lambda function"
  value       = "" # Populated after Lambda resource is defined in lambda.tf
}

output "dynamodb_table_name" {
  description = "Name of the DynamoDB table for PR state"
  value       = "" # Populated after DynamoDB resource is defined in dynamodb.tf
}

output "api_gateway_id" {
  description = "ID of the API Gateway REST API"
  value       = "" # Populated after API Gateway resource is defined in api-gateway.tf
}
