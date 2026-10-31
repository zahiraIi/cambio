terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }

  # bucket and region come from -backend-config (see README.md); the bucket
  # name contains the account id, so it cannot be hardcoded here.
  backend "s3" {
    key          = "cambio/terraform.tfstate"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = { Project = "cambio" }
  }
}

data "aws_caller_identity" "current" {}
