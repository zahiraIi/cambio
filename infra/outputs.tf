output "public_url" {
  value = "https://${local.host}"
}

output "cambio_host" {
  value = local.host
}

output "instance_id" {
  value = aws_instance.web.id
}

output "artifacts_bucket" {
  value = aws_s3_bucket.artifacts.bucket
}

output "deploy_role_arn" {
  value = aws_iam_role.deploy.arn
}
