# AI Generator Adapter API

This page defines the canonical request/response semantics for generator adapters built around `interfacectl` validation and the compiled generation bundle.

For local workspace agents, the expected pre-generation handoff is `interfacectl prepare-generation`. This document covers the post-generation validation contract.

JSON Schemas for this contract live in:

- `packages/interfacectl-cli/schemas/generation-adapter-request.schema.json`
- `packages/interfacectl-cli/schemas/generation-adapter-response.schema.json`

Consumer repos may materialize this contract as CLI wrappers, HTTP endpoints, editor tasks, or MCP tools, but they should not change the meaning of the fields or the `pass|warn|block` verdict model.

## Request contract

```json
{
  "requestId": "uuid",
  "tool": "codex|cursor|lovable|figma-make",
  "surfaceId": "reference-target-web",
  "mode": "workspace|descriptor",
  "bundleRoot": "/absolute/path/to/compiled/bundle",
  "workspaceRoot": "/absolute/path/optional",
  "descriptor": [
    {
      "surfaceId": "reference-target-web",
      "primitives": [],
      "colors": [],
      "icons": [{ "value": "@heroicons/react/24/outline", "source": "generated.tsx" }]
    }
  ],
  "provenance": {
    "sessionId": "string",
    "userId": "string",
    "timestamp": "ISO-8601"
  }
}
```

Field notes:

- `bundleRoot` is required and must point to the output of `interfacectl compile`.
- `mode=workspace` requires `workspaceRoot`.
- `mode=descriptor` requires `descriptor`.
- `contractPath` is no longer supported.
- `provenance` is optional but recommended for auditability.

Descriptor entries commonly include:

- `primitives`: emitted shell/surface roles with counts and sources
- `colors`: observed generated color values and sources
- `icons`: observed icon import sources and sources
- additional additive fields supplied by the consumer's extraction pipeline

## Response contract

```json
{
  "requestId": "uuid",
  "status": "pass|warn|block",
  "surfaceId": "reference-target-web",
  "bundle": {
    "root": "/absolute/path/to/compiled/bundle",
    "version": "2.0",
    "manifestPath": "/absolute/path/to/compiled/bundle/manifest.json",
    "surfacePath": "/absolute/path/to/compiled/bundle/surfaces/reference-target-web/generation.json"
  },
  "contract": {
    "id": "surfaces.web",
    "version": "0.1.0"
  },
  "coverage": {
    "generationGuard": true,
    "fullValidate": true,
    "shellBoundaryEvaluated": true,
    "colorPolicyEvaluated": true,
    "iconPolicyEvaluated": true
  },
  "findings": [
    {
      "code": "color.disallowed|icon.source-disallowed|shell-owned-primitive-emitted|...",
      "severity": "error|warning",
      "policy": "strict|warn|off",
      "message": "human-readable",
      "location": {
        "file": "path",
        "line": 0
      },
      "evidence": {}
    }
  ],
  "timings": {
    "totalMs": 0
  },
  "provenance": {
    "sessionId": "string",
    "userId": "string",
    "timestamp": "ISO-8601",
    "evaluatedAt": "ISO-8601"
  }
}
```

Field notes:

- `bundle` captures the compiled bundle provenance that shaped the evaluation.
- `contract` preserves canonical contract identity and version.
- `coverage.generationGuard` is `true` when generation-time guard checks ran.
- `coverage.fullValidate` is `true` only when a full validation pass ran.
- `findings` carry the structured remediation payload that tools should feed back into generation.

## Status semantics

- `block`: at least one strict/error finding exists.
- `warn`: findings exist, but none are blocking.
- `pass`: no findings exist.

Consumers must preserve these semantics even if they map the result onto repo-local HTTP status codes, CLI exit codes, or in-product publish gates.

## Transport guidance

This contract is transport-agnostic.

- `interfacectl validate-generation` emits JSON and maps `block` to exit code `30`.
- `interfacectl serve-generation-adapter` maps `block` to HTTP `422`.
- Consumer wrappers may bind `bundleRoot` out-of-band, but the canonical data model remains bundle-based.

## Related docs

- [AI Generator Adapter Quick Start](./ai-generator-adapter-quickstart.md)
- [AI Tool Playbooks](./ai-tool-playbooks.md)
- [Generator-Aware Contract Consumption](./generator-consumption.md)
