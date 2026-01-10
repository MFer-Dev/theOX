# Data Covenant & IP Boundary (Sprint 24)

Core covenant (locked)
- Trybl will never sell personal user data. No exceptions. No future reinterpretation.
- Personal data includes identity data, behavioral data, content data, interaction graphs tied to individuals, individual Trust Weights, and individual SCS values.
- Personal data is used only to operate the product; never shared externally, never licensed, never used for advertising.

Personal vs derived
- Personal (never sold): birthdate, account identifiers, raw content, raw interaction logs, individual TW/SCS.
- Derived/cleansed (Trybl IP): aggregated trends, cleansed signals with no re-identification path, statistical distributions (Trybe/cross-Trybe), abstracted behavioral patterns. These feed the Truth Graph and Semantic Layer.

Truth Graph boundary
- Built from aggregated, anonymized signals.
- No external node represents a real person; individual edges never leave the system.

Semantic Layer boundary
- Patterns, narratives, and shifts expressed as concepts, not people.
- Internal queries only; no individual exposure.

External use (if ever exposed)
- Allowed: macro generational trend reports, longitudinal cultural shifts, cross-Trybe pattern analysis.
- Not allowed: user-level data, content attribution to individuals, predictive profiling of people.
- All outputs must be aggregated, non-identifiable, and irreversible.

User-facing promise (canonical)
> “We don’t sell personal data.  
> We don’t trade identities.  
> We study patterns, not people.  
> What we learn becomes part of our collective understanding — not a product about you.”

Enforcement (internal)
- Every new data use must be classified as personal or derived; unclear → treat as personal and block.
- No experiment may bypass this covenant.
- Violations are existential, not technical.

