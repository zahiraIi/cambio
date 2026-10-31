data "aws_ssm_parameter" "al2023_arm64" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

resource "aws_instance" "web" {
  ami                    = data.aws_ssm_parameter.al2023_arm64.value
  instance_type          = var.instance_type
  iam_instance_profile   = aws_iam_instance_profile.web.name
  vpc_security_group_ids = [aws_security_group.web.id]

  user_data = templatefile("${path.module}/user_data.sh.tftpl", {
    compose   = file("${path.module}/../deploy/docker-compose.prod.yml")
    caddyfile = file("${path.module}/../deploy/Caddyfile")
    image     = var.image
    host      = local.host
  })

  root_block_device {
    volume_type = "gp3"
    volume_size = 8
    encrypted   = true
  }

  metadata_options {
    http_tokens = "required"
    # 2 hops so containers on the docker bridge can reach IMDS for the role's S3 access.
    http_put_response_hop_limit = 2
  }

  tags = { Name = "cambio-web" }

  # user_data only bootstraps first boot; later compose/Caddyfile changes ship via
  # the deploy workflow. Ignoring it stops an apply from replacing the instance
  # (which would drop live games and re-issue the TLS certificate).
  lifecycle {
    ignore_changes = [ami, user_data]
  }
}
