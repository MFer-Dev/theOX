# Events infrastructure (placeholder)

This repo uses Kafka-compatible topics (via `@platform/events`). In production you can run:

- **AWS MSK** (managed Kafka)
- **Redpanda** (self-managed on ECS/EKS/EC2, or managed vendor)

This module is intentionally a **template placeholder** until you choose the exact backend.

## Contract

Outputs you should provide once wired:
- broker connection string(s)
- auth mechanism (IAM/SASL/SCRAM) and how services obtain credentials
- topic creation strategy (auto vs IaC)


