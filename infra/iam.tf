data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "web" {
  name               = "cambio-web"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.web.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "artifacts" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.artifacts.arn}/models/*"]
  }
  statement {
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.artifacts.arn}/games/*"]
  }
}

resource "aws_iam_role_policy" "artifacts" {
  name   = "cambio-artifacts"
  role   = aws_iam_role.web.id
  policy = data.aws_iam_policy_document.artifacts.json
}

resource "aws_iam_instance_profile" "web" {
  name = "cambio-web"
  role = aws_iam_role.web.name
}
