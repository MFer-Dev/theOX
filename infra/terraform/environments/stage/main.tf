terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.6"
    }
  }
}

provider "aws" {
  region = var.region
}

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.7.0"

  name = var.name
  cidr = var.vpc_cidr

  azs             = var.azs
  public_subnets  = var.public_subnets
  private_subnets = var.private_subnets

  enable_dns_hostnames = true
  enable_dns_support   = true

  enable_nat_gateway = true
  single_nat_gateway = true
}

resource "random_password" "db" {
  length  = 32
  special = true
}

resource "aws_secretsmanager_secret" "db_password" {
  name = "${var.name}/rds/master_password"
}

resource "aws_secretsmanager_secret_version" "db_password" {
  secret_id     = aws_secretsmanager_secret.db_password.id
  secret_string = random_password.db.result
}

resource "random_password" "redis" {
  length  = 32
  special = true
}

resource "aws_secretsmanager_secret" "redis_auth_token" {
  name = "${var.name}/redis/auth_token"
}

resource "aws_secretsmanager_secret_version" "redis_auth_token" {
  secret_id     = aws_secretsmanager_secret.redis_auth_token.id
  secret_string = random_password.redis.result
}

module "postgres" {
  source     = "../../modules/postgres"
  name       = var.name
  region     = var.region
  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  db_name             = "genme"
  username            = "genme"
  password            = random_password.db.result
  publicly_accessible = false

  deletion_protection   = true
  backup_retention_days = 7
  multi_az              = true
}

module "redis" {
  source     = "../../modules/redis"
  name       = var.name
  region     = var.region
  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  num_cache_clusters = 2
  auth_token         = random_password.redis.result
}

module "media" {
  source              = "../../modules/media"
  name                = var.name
  region              = var.region
  bucket_name         = var.media_bucket_name
  cloudfront_enabled  = var.media_cloudfront_enabled
}


