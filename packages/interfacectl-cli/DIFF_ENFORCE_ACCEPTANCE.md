# Diff and Enforce Acceptance Criteria

## Acceptance Criteria Checklist

### Schema Implementation
- [x] All three JSON schemas created (diff, policy, fix-summary)
- [x] Schemas copied to dist/ during build
- [x] Schema validation utilities implemented
- [x] Schemas validate correctly against JSON Schema Draft 2020-12

### Core Infrastructure
- [x] Normalization utilities implemented
- [x] Deterministic fingerprinting implemented (SHA-256)
- [x] Comparison engine implemented
- [x] Drift detection utilities implemented (all 10 categories)
- [x] Types extended in validator package

### Commands
- [x] `diff` command implemented
- [x] `enforce` command implemented
- [x] Both commands integrated into CLI
- [x] Exit codes aligned with promised semantics

### Policy and Autofix
- [x] Default policy created
- [x] Policy utilities implemented
- [x] Autofix engine implemented
- [x] File mutation utilities implemented

### Examples and Fixtures
- [x] Example policy.json created
- [x] Example diff.json created
- [x] Golden fixtures structure created

### Testing
- [x] Unit tests for all utilities
- [x] Integration tests for CLI commands
- [x] Snapshot tests for JSON output
- [x] Determinism tests with hash comparison
- [x] Schema validation tests

### Documentation
- [x] docs/diff.md
- [x] docs/enforce.md
- [x] docs/drift-risks.md

## Definition of Done

All items in the checklist must be completed and verified:

1. **All commands work end-to-end** - Both `diff` and `enforce` commands execute successfully
2. **Schemas validate** - All JSON outputs pass schema validation
3. **Deterministic output** - Same inputs produce byte-for-byte identical outputs
4. **Tests pass** - All unit, integration, and snapshot tests pass
5. **Documentation complete** - All documentation files created and reviewed

## Test Coverage Requirements

- Unit tests: Each utility function (normalize, compare, autofix, drift-detection, fingerprint, policy, file-mutator)
- Integration tests: Full CLI invocations with fixtures
- Snapshot tests: JSON output regression testing
- Determinism tests: Hash comparison across runs

## Fixture Descriptions

### identical-inputs
Contract and descriptor match exactly → empty diff, exit 0

### reorder-only
Arrays reordered (allowedFonts, color.allowedValues), values same → suppressed via normalization

### ephemeral-fields
Timestamps/IDs changed in observed → stripped in normalization, not in diff

### rename-scenarios
Section ID changes (similarity > threshold) → detected as rename with confidence

### autofix-safe
Mechanical changes (font variable renames, color format changes) → autofix applies

### autofix-blocked
Semantic changes (section intent changes, layout constraints) → autofix blocked

### drift-risks
Examples of each drift risk category → all 10 categories represented
