# Layout Page Frame Validation

The `layout.pageFrame` contract section enables validation of page container layout properties using static analysis of source files.

## What It Validates

The pageFrame validator checks:

- **Container existence**: Verifies the element matching `containerSelector` exists in the DOM (via `data-contract="page-container"` marker)
- **Max-width**: Compares extracted `max-width` CSS property against `containerMaxWidthPx`
- **Min-width** (optional): Compares extracted `min-width` CSS property against `containerMinWidthPx` when present
- **Horizontal padding**: Compares extracted `padding-left` and `padding-right` (or `padding-inline`) against `paddingXpx`

## What It Does Not Validate

- Framework-specific class names as the primary mechanism (Tailwind bracket classes are supported as a fallback)
- Visual appearance or styling beyond the specified properties
- Responsive breakpoints or media queries
- Animation or transition properties
- Content structure or semantic HTML
- Values expressed using `clamp()`, `calc()`, or other non-deterministic CSS functions

## Static Analysis v1

The validator uses static analysis to extract deterministic pixel values from source files. It does not require runtime execution or special CSS custom properties.

### Extraction Strategy

The validator extracts values in this priority order:

1. **Inline styles** on the marked element (`data-contract="page-container"`)
   - Parses `style` attribute for `max-width`, `min-width`, `padding-left`, `padding-right`, or `padding-inline`
   - Supports px values only

2. **CSS rules** targeting the marker selector
   - Detects rules like `[data-contract="page-container"] { max-width: ...; min-width: ...; padding-inline: ...; }`
   - Supports px values only
   - If values use `clamp()` or `calc()`, returns `layout.pageFrame.unextractable-value`

3. **Tailwind bracket classes** (best-effort, v1)
   - Supports `max-w-[NNNpx]`, `min-w-[NNNpx]`, and `px-[NNpx]` or `pl-[NNpx]/pr-[NNpx]`
   - If only tokenized classes exist (e.g., `px-6`), returns `layout.pageFrame.unextractable-value` with guidance

4. **CSS custom properties** (optional fallback)
   - `--contract-page-frame-max-width`, `--contract-page-frame-min-width`, and `--contract-page-frame-padding-x`
   - Not required, but supported if present

### Limitations

Static analysis v1:
- **Requires deterministic px values** - cannot validate `clamp()`, `calc()`, or responsive expressions
- **Requires container marker** - element must have `data-contract="page-container"` attribute
- **Selector support** - v1 only supports `[data-contract="page-container"]` selector
- **Tailwind classes** - only bracket notation (`max-w-[1200px]`) is supported, not tokenized classes

If values cannot be extracted deterministically, the validator reports `layout.pageFrame.unextractable-value` with guidance on how to express the values.

## Contract Schema

Add `pageFrame` as an optional property within a surface's `layout` section:

```json
{
  "surfaces": [
    {
      "id": "my-surface",
      "type": "web",
      "layout": {
        "maxContentWidth": 1200,
        "pageFrame": {
          "containerSelector": "[data-contract=\"page-container\"]",
          "containerMaxWidthPx": 1200,
          "containerMinWidthPx": 1024,
          "paddingXpx": 24,
          "alignment": "center",
          "enforcement": "strict"
        }
      }
    }
  ]
}
```

### Schema Properties

- `containerSelector` (required): CSS selector identifying the primary page container. v1 only supports `[data-contract="page-container"]`
- `containerMaxWidthPx` (required): Expected max-width in pixels
- `containerMinWidthPx` (optional): Expected min-width in pixels (validated only when present)
- `paddingXpx` (required): Expected horizontal padding (left and right) in pixels
- `alignment` (optional): `"center"` or `"left"`, defaults to `"center"` (not validated in v1)
- `enforcement` (optional): `"strict"` or `"warn"`, defaults to `"strict"`
  - `strict`: Any mismatch causes validation failure (non-zero exit code)
  - `warn`: Mismatches are reported but exit code is 0

## Implementation Examples

### Inline Styles (Recommended)

```tsx
    <div
      data-contract="page-container"
      style={{
        maxWidth: "1200px",
        minWidth: "1024px",
        paddingLeft: "24px",
        paddingRight: "24px",
      }}
>
  {children}
</div>
```

### CSS Rule on Marker Selector

```css
[data-contract="page-container"] {
  max-width: 1200px;
  min-width: 1024px;
  padding-left: 24px;
  padding-right: 24px;
}
```

```tsx
<div data-contract="page-container" className="page-container">
  {children}
</div>
```

### Tailwind Bracket Classes (Best-Effort)

```tsx
<div
  data-contract="page-container"
  className="max-w-[1200px] min-w-[1024px] px-[24px]"
>
  {children}
</div>
```

## CLI Usage

Validate pageFrame layouts using static analysis:

```bash
interfacectl validate \
  --contract path/to/interface.contract.json \
  --root path/to/surface
```

Filter to specific surfaces:

```bash
interfacectl validate \
  --contract path/to/interface.contract.json \
  --root path/to/surface \
  --surface my-surface
```

Output in JSON format:

```bash
interfacectl validate \
  --contract path/to/interface.contract.json \
  --root path/to/surface \
  --format json
```

## Violation Types

### `layout.pageFrame.selector-unsupported`

The container selector in the contract is not supported in static analysis v1.

**Resolution**: Use `[data-contract="page-container"]` as the selector.

### `layout.pageFrame.container-not-found`

The page container marker (`data-contract="page-container"`) was not found in source files.

**Resolution**: Add `data-contract="page-container"` to the container element.

### `layout.pageFrame.maxwidth-mismatch`

Extracted max-width does not match the expected value.

**Resolution**: Update the max-width to match the contract value.

### `layout.pageFrame.minwidth-mismatch`

Extracted min-width does not match the expected value.

**Resolution**: Update the min-width to match the contract value.

### `layout.pageFrame.padding-mismatch`

Extracted padding does not match the expected value.

**Resolution**: Update the padding to match the contract value.

### `layout.pageFrame.unextractable-value`

Values could not be extracted deterministically. This occurs when:
- Values use `clamp()`, `calc()`, or other non-deterministic CSS functions
- Only tokenized Tailwind classes are used (e.g., `px-6` instead of `px-[24px]`)
- No matching styles are found in the expected locations

**Resolution**: Express values using:
- Inline styles with fixed px values
- CSS rules targeting `[data-contract="page-container"]` with fixed px values
- Tailwind bracket classes (e.g., `px-[24px]`)

### `layout.pageFrame.non-deterministic-value`

Values were found but use non-deterministic expressions like `clamp()` or `calc()`.

**Resolution**: Replace with fixed px values or use inline styles.

## Example Failure Output

### Text Format

```
✖ Contract violations detected
  • my-surface:
      - Page frame max-width mismatch for surface "my-surface": expected 1200px, found 1400px.
      - Page frame padding could not be extracted for surface "my-surface". Expected 24px. Static analysis requires deterministic px values.
```

### JSON Format

```json
{
  "contractPath": "path/to/interface.contract.json",
  "contractVersion": "1.0.0",
  "summary": {
    "errors": 2,
    "warnings": 0
  },
  "findings": [
    {
      "code": "layout.pageframe.maxwidth-mismatch",
      "severity": "error",
      "category": "E2",
      "surface": "my-surface",
      "message": "Page frame max-width mismatch for surface \"my-surface\": expected 1200px, found 1400px.",
      "expected": 1200,
      "found": 1400,
      "location": "app/layout.tsx"
    },
    {
      "code": "layout.pageframe.unextractable-value",
      "severity": "error",
      "category": "E2",
      "surface": "my-surface",
      "message": "Page frame padding could not be extracted for surface \"my-surface\". Expected 24px. Static analysis requires deterministic px values.",
      "expected": 24,
      "found": {
        "left": null,
        "right": null
      }
    }
  ]
}
```

## Exit Codes

- `strict` mode with violations → exit code 1 (v1) or 30 (v2)
- `warn` mode with violations → exit code 0
- No violations → exit code 0

## Future Enhancements

Runtime computed validation may be added later via `--url` option, but is not part of v1. The current implementation focuses on deterministic static analysis that works reliably in CI without requiring a running server.
