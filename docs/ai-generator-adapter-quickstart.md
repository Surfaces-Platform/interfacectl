# AI Generator Adapter Quick Start

Use this flow when a local agent or hosted generator needs contract-aware guidance before generation and structured findings after generation.

## Integration flow

1. Compile the contract into a generation bundle.
2. For local agents, resolve the bundle into one agent-ready payload with `prepare-generation`.
3. Generate or edit UI.
4. Run `validate-generation` against the same bundle.
5. Repeat until the result is `pass` or an accepted `warn`.

## Step 1: compile the bundle

```bash
interfacectl compile --contract <path> --out <dir>
```

All later steps use `bundleRoot` from this compiled directory. The CLI never compiles implicitly inside adapter commands.

## Step 2: prepare local-agent input

Use `prepare-generation` for workspace agents such as Codex, Cursor, or Claude Code.

```bash
interfacectl prepare-generation \
  --bundle-root ./artifacts/generation-bundles/surfaces-web \
  --surface surfaces-web \
  --out ./artifacts/generation-inputs/surfaces-web.json
```

The output is one tool-neutral JSON payload with:

- bundle and contract provenance
- resolved boundary, structure, layout, visual, and guidance data
- sections, components, constraints, repair map, and optional authoring hints
- summary text plus checklist items
- evidence refs only, never inline extracted payloads

## Step 3: validate generation

### `workspace`

Use `workspace` mode after a local agent edits the repo.

```bash
interfacectl validate-generation \
  --tool codex \
  --surface surfaces-web \
  --mode workspace \
  --workspace-root . \
  --bundle-root ./artifacts/generation-bundles/surfaces-web
```

### `descriptor`

Use `descriptor` mode for hosted builders such as Lovable or Figma Make.

```bash
interfacectl validate-generation \
  --tool lovable \
  --surface reference-target-web \
  --mode descriptor \
  --bundle-root ./artifacts/generation-bundles/reference-target-web \
  --descriptor-path ./generated/reference-target-web.descriptor.json
```

Exit semantics:

- `0` for `pass` and `warn`
- `30` for `block`
- `10` for malformed adapter input or unreadable bundle

## HTTP mode

Hosted builders can still use the HTTP adapter:

```bash
interfacectl serve-generation-adapter \
  --bundle-root ./artifacts/generation-bundles/reference-target-web
```

Endpoint:

- `POST /surfaces.validateGeneration`
- `422` for `status=block`
- `400` for invalid request

## Related docs

- [AI Generator Adapter API](./ai-generator-adapter-api.md)
- [AI Tool Playbooks](./ai-tool-playbooks.md)
- [Generator-Aware Contract Consumption](./generator-consumption.md)
