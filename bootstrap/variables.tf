variable "bot_display_name" {
  description = "Display name for the Teams bot shown in Microsoft Teams"
  type        = string
  default     = "PR Tracker"
}

variable "messaging_endpoint" {
  description = "Bot messaging endpoint URL (your API Gateway webhook URL for Teams)"
  type        = string
  default     = ""
}

variable "azure_location" {
  description = "Azure region for the Bot Service resource (use 'global' for Bot Service)"
  type        = string
  default     = "global"
}

variable "sku" {
  description = "Bot Service pricing tier: F0 (free, 10k messages/month) or S1 (standard, unlimited)"
  type        = string
  default     = "F0"

  validation {
    condition     = contains(["F0", "S1"], var.sku)
    error_message = "SKU must be either F0 (free) or S1 (standard)."
  }
}

variable "tags" {
  description = "Additional tags to apply to all Azure resources"
  type        = map(string)
  default     = {}
}
