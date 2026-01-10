variable "name" {
  type        = string
  description = "Prefix/name for resources (e.g. genme-prod)"
}

variable "region" {
  type        = string
  description = "AWS region"
}

variable "vpc_id" {
  type        = string
  description = "VPC ID to place Redis into"
}

variable "subnet_ids" {
  type        = list(string)
  description = "Private subnet IDs for ElastiCache subnet group"
}

variable "node_type" {
  type        = string
  description = "Cache node type"
  default     = "cache.t4g.small"
}

variable "num_cache_clusters" {
  type        = number
  description = "Number of nodes (1 for single primary, >1 for replicas)"
  default     = 1
}

variable "engine_version" {
  type        = string
  description = "Redis engine version"
  default     = "7.1"
}

variable "auth_token" {
  type        = string
  description = "Optional auth token (store in Secrets Manager/SSM; do not commit)"
  default     = null
  sensitive   = true
}


