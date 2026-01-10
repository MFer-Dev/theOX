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

# Dev environment: VPC + RDS + Redis + Media bucket.
# ECS/ECR/ALB wiring comes next (after networking/data plane are in place).

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

  # Dev-friendly
  deletion_protection     = false
  backup_retention_days   = 3
  multi_az                = false
}

module "redis" {
  source     = "../../modules/redis"
  name       = var.name
  region     = var.region
  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  num_cache_clusters = 1
  auth_token         = random_password.redis.result
}

#
# --- ECS (dev) ---
#

data "aws_caller_identity" "current" {}

resource "random_password" "access_token_secret" {
  length  = 48
  special = true
}

resource "aws_secretsmanager_secret" "access_token_secret" {
  name = "${var.name}/jwt/access_token_secret"
}

resource "aws_secretsmanager_secret_version" "access_token_secret" {
  secret_id     = aws_secretsmanager_secret.access_token_secret.id
  secret_string = random_password.access_token_secret.result
}

resource "random_password" "refresh_token_secret" {
  length  = 48
  special = true
}

resource "aws_secretsmanager_secret" "refresh_token_secret" {
  name = "${var.name}/jwt/refresh_token_secret"
}

resource "aws_secretsmanager_secret_version" "refresh_token_secret" {
  secret_id     = aws_secretsmanager_secret.refresh_token_secret.id
  secret_string = random_password.refresh_token_secret.result
}

resource "aws_secretsmanager_secret" "database_url" {
  name = "${var.name}/runtime/DATABASE_URL"
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id     = aws_secretsmanager_secret.database_url.id
  secret_string = "postgresql://genme:${random_password.db.result}@${module.postgres.address}:5432/genme"
}

resource "aws_secretsmanager_secret" "redis_url" {
  name = "${var.name}/runtime/REDIS_URL"
}

resource "aws_secretsmanager_secret_version" "redis_url" {
  secret_id     = aws_secretsmanager_secret.redis_url.id
  secret_string = "redis://:${random_password.redis.result}@${module.redis.primary_endpoint_address}:6379"
}

resource "aws_ecr_repository" "services" {
  for_each = toset([
    "gateway",
    "identity",
    "discourse",
    "purge",
    "cred",
    "endorse",
    "safety",
    "trustgraph",
  ])
  name                 = "${var.name}-${each.value}"
  image_tag_mutability = "MUTABLE"
}

resource "aws_ecs_cluster" "this" {
  name = "${var.name}-cluster"
}

resource "aws_service_discovery_private_dns_namespace" "this" {
  name        = "${var.name}.local"
  description = "Service discovery for ${var.name}"
  vpc         = module.vpc.vpc_id
}

resource "aws_service_discovery_service" "svc" {
  for_each = {
    identity   = { port = 4001 }
    discourse  = { port = 4002 }
    purge      = { port = 4003 }
    cred       = { port = 4004 }
    endorse    = { port = 4005 }
    safety     = { port = 4008 }
    trustgraph = { port = 4007 }
  }

  name = each.key

  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.this.id
    dns_records {
      ttl  = 10
      type = "A"
    }
    routing_policy = "MULTIVALUE"
  }

  health_check_custom_config {
    failure_threshold = 1
  }
}

resource "aws_security_group" "alb" {
  name        = "${var.name}-alb"
  description = "Public ALB"
  vpc_id      = module.vpc.vpc_id
}

resource "aws_security_group_rule" "alb_ingress_http" {
  type              = "ingress"
  from_port         = 80
  to_port           = 80
  protocol          = "tcp"
  security_group_id = aws_security_group.alb.id
  cidr_blocks       = ["0.0.0.0/0"]
}

resource "aws_security_group_rule" "alb_egress_all" {
  type              = "egress"
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  security_group_id = aws_security_group.alb.id
  cidr_blocks       = ["0.0.0.0/0"]
}

resource "aws_security_group" "tasks" {
  name        = "${var.name}-tasks"
  description = "ECS tasks"
  vpc_id      = module.vpc.vpc_id
}

resource "aws_security_group_rule" "tasks_ingress_from_alb_gateway" {
  type                     = "ingress"
  from_port                = 4000
  to_port                  = 4000
  protocol                 = "tcp"
  security_group_id        = aws_security_group.tasks.id
  source_security_group_id = aws_security_group.alb.id
}

resource "aws_security_group_rule" "tasks_egress_all" {
  type              = "egress"
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  security_group_id = aws_security_group.tasks.id
  cidr_blocks       = ["0.0.0.0/0"]
}

resource "aws_lb" "gateway" {
  name               = "${var.name}-gateway"
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = module.vpc.public_subnets
}

resource "aws_lb_target_group" "gateway" {
  name        = "${var.name}-gateway"
  port        = 4000
  protocol    = "HTTP"
  vpc_id      = module.vpc.vpc_id
  target_type = "ip"

  health_check {
    path = "/readyz"
  }
}

resource "aws_lb_listener" "gateway_http" {
  load_balancer_arn = aws_lb.gateway.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.gateway.arn
  }
}

resource "aws_cloudwatch_log_group" "svc" {
  for_each          = aws_ecr_repository.services
  name              = "/${var.name}/${each.key}"
  retention_in_days = 14
}

resource "aws_iam_role" "ecs_task_execution" {
  name = "${var.name}-ecs-task-exec"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = { Service = "ecs-tasks.amazonaws.com" }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_exec_managed" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_exec_secrets" {
  name = "${var.name}-ecs-secrets"
  role = aws_iam_role.ecs_task_execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["secretsmanager:GetSecretValue"]
        Resource = [
          aws_secretsmanager_secret.database_url.arn,
          aws_secretsmanager_secret.redis_url.arn,
          aws_secretsmanager_secret.access_token_secret.arn,
          aws_secretsmanager_secret.refresh_token_secret.arn,
        ]
      }
    ]
  })
}

locals {
  ns = aws_service_discovery_private_dns_namespace.this.name
  core_services = {
    identity   = { port = 4001, url_env = "IDENTITY_BASE_URL" }
    discourse  = { port = 4002, url_env = "DISCOURSE_BASE_URL" }
    purge      = { port = 4003, url_env = "PURGE_BASE_URL" }
    cred       = { port = 4004, url_env = "CRED_BASE_URL" }
    endorse    = { port = 4005, url_env = "ENDORSE_BASE_URL" }
    safety     = { port = 4008, url_env = "SAFETY_BASE_URL" }
    trustgraph = { port = 4007, url_env = "TRUST_BASE_URL" }
  }
}

resource "aws_ecs_task_definition" "service" {
  for_each = merge(local.core_services, { gateway = { port = 4000, url_env = "" } })

  family                   = "${var.name}-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn

  container_definitions = jsonencode([
    {
      name      = each.key
      image     = "${aws_ecr_repository.services[each.key].repository_url}:${var.image_tag}"
      essential = true
      portMappings = [
        { containerPort = each.value.port, hostPort = each.value.port, protocol = "tcp" }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.svc[each.key].name
          awslogs-region        = var.region
          awslogs-stream-prefix = "ecs"
        }
      }
      environment = concat(
        [
          { name = "PORT", value = tostring(each.value.port) },
          { name = "MEDIA_PUBLIC_BASE_URL", value = "http://${aws_lb.gateway.dns_name}/discourse/media" },
        ],
        each.key == "gateway"
          ? [
              { name = "OPS_GATEWAY_URL", value = "http://ops-gateway.${local.ns}:4013" },
              { name = "OPS_INTERNAL_KEY", value = "dev_internal" }
            ]
          : [],
        each.key == "gateway"
          ? [for k, v in local.core_services : { name = v.url_env, value = "http://${k}.${local.ns}:${v.port}" }]
          : [],
      )
      secrets = [
        { name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.database_url.arn },
        { name = "REDIS_URL", valueFrom = aws_secretsmanager_secret.redis_url.arn },
        { name = "ACCESS_TOKEN_SECRET", valueFrom = aws_secretsmanager_secret.access_token_secret.arn },
        { name = "REFRESH_TOKEN_SECRET", valueFrom = aws_secretsmanager_secret.refresh_token_secret.arn },
      ]
    }
  ])
}

resource "aws_ecs_service" "service" {
  for_each = merge(local.core_services, { gateway = { port = 4000, url_env = "" } })

  name            = "${var.name}-${each.key}"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.service[each.key].arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = module.vpc.private_subnets
    security_groups = [aws_security_group.tasks.id]
    assign_public_ip = false
  }

  dynamic "load_balancer" {
    for_each = each.key == "gateway" ? [1] : []
    content {
      target_group_arn = aws_lb_target_group.gateway.arn
      container_name   = "gateway"
      container_port   = 4000
    }
  }

  dynamic "service_registries" {
    for_each = contains(keys(local.core_services), each.key) ? [1] : []
    content {
      registry_arn = aws_service_discovery_service.svc[each.key].arn
    }
  }

  depends_on = [aws_lb_listener.gateway_http]
}

module "media" {
  source              = "../../modules/media"
  name                = var.name
  region              = var.region
  bucket_name         = var.media_bucket_name
  cloudfront_enabled  = var.media_cloudfront_enabled
}


