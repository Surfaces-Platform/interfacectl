# Authoring Contract Metadata

These optional contract fields help agentic UI generators interpret structure, safe edits, responsive behavior, implementation preferences, and external sources of truth for any governed web surface.

The fields are advisory-first in v1:

- `interfacectl validate` checks shape and referential integrity.
- The fields do not add new blocking runtime or CI semantics by themselves.
- Existing contracts remain valid without them.

## Scope

Authoring metadata in v1 is for web surfaces:

- `contract.components[]`
- `sections[].anatomy`
- `sections[].editPolicy`
- `sections[].responsive`
- `surfaces[].viewports`
- `surfaces[].authoring`

Do not treat these fields as first-party patterns. They are generic primitives for any ingested web surface.

## Generator Consumption Order

When both contract metadata and external sources exist, consume them in this order:

1. Use the contract to determine the allowed structure.
2. Respect shell boundaries, section edit policies, and slot constraints.
3. Read `surfaces[].authoring.sourcePriority` to decide which secondary sources to consult next.
4. Resolve `components[].references[]` or other external references only after the contract shape is known.
5. If an external source conflicts with the contract, the contract wins.

Recommended default precedence:

```json
{
  "sourcePriority": ["contract", "figma", "code", "story", "url"]
}
```

## Field Summary

- `components[]`: reusable, named building blocks for a surface.
- `components[].slots[]`: machine-editable anatomy for text, media, actions, icons, and nested content.
- `components[].states[]`: explicit UI states such as loading, empty, disabled, or expanded.
- `components[].interactions[]`: navigational or state-changing behaviors that generators must preserve.
- `sections[].anatomy`: section pattern, allowed components, and section-local slots.
- `sections[].editPolicy`: safe mutation boundary for agent edits.
- `sections[].responsive.rules[]`: named viewport behavior for layout and slot reflow.
- `surfaces[].viewports[]`: named breakpoint profiles and width ranges.
- `surfaces[].authoring`: framework, styling, preferred libraries, and source precedence.
- `references[]`: tool-neutral mappings to Figma, code, Storybook, live URLs, or asset systems.

## Marketing Page Example

```json
{
  "surfaces": [
    {
      "id": "marketing-site",
      "type": "web",
      "viewports": [
        { "id": "mobile", "maxWidthPx": 767 },
        { "id": "desktop", "minWidthPx": 768 }
      ],
      "authoring": {
        "framework": "react",
        "styling": { "strategy": "design-tokens" },
        "sourcePriority": ["contract", "figma", "code", "url"]
      }
    }
  ],
  "components": [
    {
      "id": "copy-block",
      "intent": "intro copy",
      "slots": [
        { "id": "headline", "kind": "text", "required": true },
        { "id": "body", "kind": "richText", "required": true },
        { "id": "primary-action", "kind": "action", "required": false }
      ]
    }
  ],
  "sections": [
    {
      "id": "page.intro",
      "intent": "intro",
      "description": "Top-of-page introduction.",
      "anatomy": {
        "pattern": "copy-block",
        "defaultComponent": "copy-block"
      },
      "editPolicy": {
        "mode": "slot-bound",
        "allowedOperations": ["update-copy", "swap-variant", "adjust-layout"]
      },
      "responsive": {
        "rules": [
          { "viewport": "mobile", "layoutIntent": "stack" },
          { "viewport": "desktop", "layoutIntent": "columns" }
        ]
      }
    }
  ]
}
```

## Application Screen Example

```json
{
  "components": [
    {
      "id": "results-table",
      "intent": "tabular search results",
      "slots": [
        { "id": "toolbar", "kind": "container", "required": true },
        { "id": "rows", "kind": "item-list", "required": true, "repeatable": true },
        { "id": "empty-copy", "kind": "text", "required": false }
      ],
      "states": [
        { "id": "loading", "hiddenSlots": ["rows"], "requiredSlots": ["toolbar"] },
        { "id": "empty", "hiddenSlots": ["rows"], "requiredSlots": ["empty-copy"] },
        { "id": "ready", "requiredSlots": ["toolbar", "rows"] }
      ],
      "interactions": [
        {
          "id": "apply-filter",
          "trigger": "submit toolbar filter form",
          "effect": "filter",
          "resultingState": "ready"
        }
      ]
    }
  ],
  "sections": [
    {
      "id": "screen.results",
      "intent": "search-results",
      "description": "Primary results screen.",
      "anatomy": {
        "pattern": "data-panel",
        "defaultComponent": "results-table"
      },
      "editPolicy": {
        "mode": "slot-bound",
        "allowedOperations": ["bind-data", "wire-interaction", "adjust-layout"]
      }
    }
  ]
}
```

## Reference Fixture

The first annotated example lives at:

- `packages/interfacectl-validator/test/fixtures/authoring/reference-target-web.contract.json`

It uses the live `reference-target-web` surface as calibration, but it is expressed only through generic authoring primitives such as copy block, repeated card list, viewport rules, and source precedence.
