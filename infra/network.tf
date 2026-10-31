data "aws_vpc" "default" {
  default = true
}

resource "aws_security_group" "web" {
  name        = "cambio-web"
  description = "HTTP/HTTPS only; admin access is via SSM, not SSH"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description      = "HTTP (ACME challenge + redirect)"
    from_port        = 80
    to_port          = 80
    protocol         = "tcp"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  ingress {
    description      = "HTTPS"
    from_port        = 443
    to_port          = 443
    protocol         = "tcp"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  egress {
    from_port        = 0
    to_port          = 0
    protocol         = "-1"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }
}

# Allocated before the instance so user_data can embed <ip>.sslip.io.
resource "aws_eip" "web" {
  domain = "vpc"
}

resource "aws_eip_association" "web" {
  instance_id   = aws_instance.web.id
  allocation_id = aws_eip.web.id
}

locals {
  host = "${aws_eip.web.public_ip}.sslip.io"
}
