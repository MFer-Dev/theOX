output "address" {
  value       = aws_db_instance.this.address
  description = "RDS endpoint address"
}

output "port" {
  value       = aws_db_instance.this.port
  description = "RDS port"
}

output "security_group_id" {
  value       = aws_security_group.this.id
  description = "Security group controlling Postgres ingress"
}

output "arn" {
  value       = aws_db_instance.this.arn
  description = "DB instance ARN"
}


