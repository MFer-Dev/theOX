variable "name" {
  type        = string
  description = "Environment name/prefix"
  default     = "trybl-dev"
}

variable "region" {
  type        = string
  description = "AWS region"
  default     = "us-east-1"
}

variable "vpc_cidr" {
  type        = string
  description = "VPC CIDR"
  default     = "10.10.0.0/16"
}

variable "azs" {
  type        = list(string)
  description = "Availability zones"
  default     = ["us-east-1a", "us-east-1b"]
}

variable "public_subnets" {
  type        = list(string)
  description = "Public subnet CIDRs (one per AZ)"
  default     = ["10.10.1.0/24", "10.10.2.0/24"]
}

variable "private_subnets" {
  type        = list(string)
  description = "Private subnet CIDRs (one per AZ)"
  default     = ["10.10.11.0/24", "10.10.12.0/24"]
}

variable "media_bucket_name" {
  type        = string
  description = "S3 bucket for media"
  default     = "trybl-dev-media-example"
}

variable "media_cloudfront_enabled" {
  type        = bool
  description = "Whether to provision a CloudFront distribution for media"
  default     = true
}

variable "image_tag" {
  type        = string
  description = "Container image tag (set by CI/CD)"
  default     = "latest"
}

