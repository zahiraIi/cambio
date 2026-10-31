variable "region" {
  type    = string
  default = "us-east-1"
}

variable "instance_type" {
  type    = string
  default = "t4g.micro"
}

variable "monthly_budget_usd" {
  type    = number
  default = 5
}

variable "alert_email" {
  description = "Receives AWS Budgets alerts at 50% and 100% of monthly_budget_usd."
  type        = string
}

variable "github_repo" {
  type    = string
  default = "zahiraIi/cambio"
}

variable "image" {
  description = "Initial server image; the deploy workflow pins it to a commit sha afterwards."
  type        = string
  default     = "ghcr.io/zahiraii/cambio:latest"
}
