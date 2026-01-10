output "vpc_id" {
  value = module.vpc.vpc_id
}

output "private_subnets" {
  value = module.vpc.private_subnets
}

output "public_subnets" {
  value = module.vpc.public_subnets
}

output "rds_address" {
  value = module.postgres.address
}

output "redis_primary_endpoint" {
  value = module.redis.primary_endpoint_address
}

output "db_password_secret_arn" {
  value = aws_secretsmanager_secret.db_password.arn
}

output "redis_auth_token_secret_arn" {
  value = aws_secretsmanager_secret.redis_auth_token.arn
}

output "media_bucket_name" {
  value = module.media.s3_bucket_name
}

