output "bot_app_id" {
  description = "Azure AD Application (Client) ID — use as teams_bot_id in AWS Terraform"
  value       = azuread_application.bot.client_id
}

output "bot_app_password" {
  description = "Azure AD Application secret — use as teams_bot_password in AWS Terraform (store securely)"
  value       = azuread_application_password.bot.value
  sensitive   = true
}

output "bot_service_name" {
  description = "Azure Bot Service resource name"
  value       = azurerm_bot_service_azure_bot.bot.name
}

output "tenant_id" {
  description = "Azure AD Tenant ID for token validation"
  value       = data.azuread_client_config.current.tenant_id
}

output "resource_group_name" {
  description = "Resource group containing the bot resources"
  value       = azurerm_resource_group.bot.name
}
