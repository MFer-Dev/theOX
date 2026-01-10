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
  description = "VPC ID to place RDS into"
}

variable "subnet_ids" {
  type        = list(string)
  description = "Private subnet IDs for the DB subnet group"
}

variable "db_name" {
  type        = string
  description = "Initial database name"
  default     = "genme"
}

variable "username" {
  type        = string
  description = "Master username"
  default     = "genme"
}

variable "password" {
  type        = string
  description = "Master password (store in Secrets Manager/SSM; do not commit)"
  sensitive   = true
}

variable "instance_class" {
  type        = string
  description = "RDS instance class"
  default     = "db.t4g.small"
}

variable "allocated_storage" {
  type        = number
  description = "Allocated storage (GB)"
  default     = 50
}

variable "multi_az" {
  type        = bool
  description = "Enable Multi-AZ"
  default     = true
}

variable "publicly_accessible" {
  type        = bool
  description = "Whether RDS has a public endpoint (prod should be false)"
  default     = false
}

variable "backup_retention_days" {
  type        = number
  description = "Backup retention in days"
  default     = 14
}

variable "deletion_protection" {
  type        = bool
  description = "Deletion protection (prod should be true)"
  default     = true
}


