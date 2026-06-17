output "api_gateway_url" {
  description = "API Gateway webhook endpoint URL"
  value       = "${aws_api_gateway_stage.webhook.invoke_url}/webhook"
}

output "api_gateway_health_url" {
  description = "API Gateway health-check endpoint URL"
  value       = "${aws_api_gateway_stage.webhook.invoke_url}/health"
}

output "lambda_function_arn" {
  description = "ARN of the PR Tracker Lambda function"
  value       = aws_lambda_function.webhook.arn
}

output "lambda_function_name" {
  description = "Name of the PR Tracker Lambda function"
  value       = aws_lambda_function.webhook.function_name
}

output "dynamodb_table_name" {
  description = "Name of the DynamoDB table for PR state"
  value       = "" # Populated after DynamoDB resource is defined in dynamodb.tf
}

output "api_gateway_id" {
  description = "ID of the API Gateway REST API"
  value       = aws_api_gateway_rest_api.webhook.id
}

output "api_gateway_stage_name" {
  description = "Name of the deployed API Gateway stage"
  value       = aws_api_gateway_stage.webhook.stage_name
}
