terraform {
  required_version = ">= 1.5"

  required_providers {
    azuread = {
      source  = "hashicorp/azuread"
      version = "~> 3.0"
    }
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }
}

provider "azuread" {}

provider "azurerm" {
  features {}
}

data "azuread_client_config" "current" {}

# Azure AD Application Registration for the Bot
resource "azuread_application" "bot" {
  display_name = var.bot_display_name

  sign_in_audience = "AzureADMultipleOrgs"

  api {
    requested_access_token_version = 2
  }

  web {
    redirect_uris = ["https://token.botframework.com/.auth/web/redirect"]
  }

  tags = ["teams-bot", "pr-tracker"]
}

# Client Secret for the Bot Application
resource "azuread_application_password" "bot" {
  application_id = azuread_application.bot.id
  display_name   = "pr-tracker-bot-secret"
  end_date       = timeadd(timestamp(), "8760h") # 1 year

  lifecycle {
    ignore_changes = [end_date]
  }
}

# Azure Bot Service Registration
resource "azurerm_bot_channels_registration" "bot" {
  name                = replace(lower(var.bot_display_name), " ", "-")
  location            = var.azure_location
  resource_group_name = azurerm_resource_group.bot.name
  sku                 = var.sku
  microsoft_app_id    = azuread_application.bot.client_id

  endpoint = var.messaging_endpoint

  tags = merge(var.tags, {
    purpose = "pr-tracker-teams-bot"
  })
}

# Resource Group for Bot Service
resource "azurerm_resource_group" "bot" {
  name     = "rg-${replace(lower(var.bot_display_name), " ", "-")}"
  location = var.azure_location != "global" ? var.azure_location : "westus2"

  tags = merge(var.tags, {
    purpose = "pr-tracker-teams-bot"
  })
}

# Enable Microsoft Teams Channel on the Bot
resource "azurerm_bot_channel_ms_teams" "teams" {
  bot_name            = azurerm_bot_channels_registration.bot.name
  location            = azurerm_bot_channels_registration.bot.location
  resource_group_name = azurerm_resource_group.bot.name
}
