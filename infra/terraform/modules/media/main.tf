terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

provider "aws" {
  region = var.region
}

# S3 bucket for original media objects.
resource "aws_s3_bucket" "media" {
  bucket = var.bucket_name
}

# Block public access; serve via CloudFront.
resource "aws_s3_bucket_public_access_block" "media" {
  bucket                  = aws_s3_bucket.media.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# TODO(production): add lifecycle rules, server-side encryption, object lock, and bucket policy for presigned PUT.

# CloudFront is optional scaffold; production should wire ACM cert + custom domain.
resource "aws_cloudfront_distribution" "media" {
  count = var.cloudfront_enabled ? 1 : 0

  enabled             = true
  default_root_object = ""

  origin {
    domain_name = aws_s3_bucket.media.bucket_regional_domain_name
    origin_id   = "${var.name}-media-s3"
  }

  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "${var.name}-media-s3"

    viewer_protocol_policy = "redirect-to-https"

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}


