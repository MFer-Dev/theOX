output "primary_endpoint_address" {
  value       = aws_elasticache_replication_group.this.primary_endpoint_address
  description = "Primary endpoint address"
}

output "reader_endpoint_address" {
  value       = aws_elasticache_replication_group.this.reader_endpoint_address
  description = "Reader endpoint address"
}

output "port" {
  value       = aws_elasticache_replication_group.this.port
  description = "Redis port"
}

output "security_group_id" {
  value       = aws_security_group.this.id
  description = "Security group controlling Redis ingress"
}


