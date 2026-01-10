variable "name" {
  description = "Prefix/name for media resources"
  type        = string
}

variable "region" {
  description = "AWS region"
  type        = string
}

variable "bucket_name" {
  description = "S3 bucket name to store media"
  type        = string
}

variable "cloudfront_enabled" {
  description = "Whether to provision CloudFront distribution"
  type        = bool
  default     = true
}


