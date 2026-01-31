# Compile fixture

Input contract and golden expected output for `interfacectl compile` tests.

- **contract/ui.contract.json**: Small representative contract (one surface, motion constraints).
- **expected/**: Golden output for one compile run. Tests compare generated bundle to this for structure and determinism.

Tests run compile twice into separate temp dirs and assert manifest.files and hashes match (determinism). Optionally compare generated files to expected/ for shape and content.
