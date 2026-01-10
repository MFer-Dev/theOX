output "s3_bucket_name" {
  value = aws_s3_bucket.media.bucket
}

output "cloudfront_domain_name" {
  value       = try(aws_cloudfront_distribution.media[0].domain_name, null)
  description = "CloudFront distribution domain (if enabled)"
}


