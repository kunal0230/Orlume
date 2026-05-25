# Orlume — Handout Maintenance Protocol

> **The rule: if you touch code, you touch the docs.** These handouts are the institutional memory of the project. Letting them go stale is a bug.

---

## When Must You Update?

| Event | Required Update |
|-------|----------------|
| **Bug fix** | Add entry to `05_KNOWN_ISSUES.md` (Resolved section) |
| **New module added** | Add row to `02_MODULE_REGISTRY.md`, update `04_CODING_STANDARDS.md` §6 checklist |
| **New GPU parameter added** | Add to `03_GPU_PARAMS.md` (correct table + module ownership) |
| **New invariant discovered** | Add LAW to `01_SYSTEM_CONTRACT.md`, add to quick checklist |
| **New pitfall encountered** | Add to `04_CODING_STANDARDS.md` §9 anti-patterns table |
| **New ESLint global needed** | Note in `02_MODULE_REGISTRY.md` ESLint section or `04_CODING_STANDARDS.md` §7 |
| **Known issue found** | Add to `05_KNOWN_ISSUES.md` (Active section) |
| **Known issue resolved** | Move from Active to Resolved in `05_KNOWN_ISSUES.md` |
| **Architecture change** | Update `00_QUICK_REF.md` if it affects data flow, directory structure, or key patterns |
| **New file added** | Check if `00_QUICK_REF.md` directory map needs updating |
| **Constructor signature changed** | Update `02_MODULE_REGISTRY.md` constructor docs |

---

## Which File Gets Updated?

| Type of Change | Primary File | Secondary File |
|---------------|-------------|----------------|
| Architecture / data flow | `00_QUICK_REF.md` | — |
| Invariant / safety rule | `01_SYSTEM_CONTRACT.md` | `00_QUICK_REF.md` (if checklist needs update) |
| Module interface | `02_MODULE_REGISTRY.md` | `04_CODING_STANDARDS.md` (if patterns change) |
| GPU params | `03_GPU_PARAMS.md` | `01_SYSTEM_CONTRACT.md` (if new null-vs-zero rules) |
| Code patterns / style | `04_CODING_STANDARDS.md` | — |
| Bug fix / issue | `05_KNOWN_ISSUES.md` | `01_SYSTEM_CONTRACT.md` (if new invariant) |
| Handout system itself | `06_MAINTENANCE.md` | — |

---

## Bug Entry Format

When adding a resolved bug to `05_KNOWN_ISSUES.md`:

```markdown
| B## | YYYY-MM | One-line description | `AffectedFile.js` | Root cause sentence | Fix description | LAW # (if applicable) |
```

Example:
```markdown
| B26 | May 2026 | Color grading undo not working | `ColorGradingWheel.js`, `ColorGradingModule.js` | No `onInteractionEnd` callback passed to wheel constructor | Added 4th arg | LAW 12 |
```

Rules:
- Assign the next sequential `B##` number
- Always specify affected file(s)
- State root cause, not just symptoms
- Reference the System Contract LAW if one applies (or note if a new LAW should be created)

---

## New Module Entry Format

When adding a module to `02_MODULE_REGISTRY.md`:

1. **Add row to Module Interface Table:**
```markdown
| ## | `ClassName` | `propertyName` | ✅/❌ | ✅/❌ | ✅/❌ | ✅/❌ | `.init()` / constructor only |
```

2. **If it has constructor params**, add a section under "Component Constructors"

3. **If it has quirks**, add a section under "Module Quirks & Bug Notes"

4. **Add mode → panel mapping** if it has a panel

5. **Check `_deactivateAllOverlayTools()`** — if the module has an overlay canvas, it must be added there

---

## New Invariant (System Contract LAW) Format

```markdown
## LAW ## — Short Descriptive Title

**One-sentence rule in bold.**

```javascript
// CORRECT ✅
correct code example

// WRONG ❌ — explanation of what goes wrong
wrong code example
```

**Root cause:** What bug this was learned from.
```

Rules:
- Assign the next sequential LAW number
- Include correct AND wrong code examples
- State root cause from a real bug
- Add to the Quick Checklist at the bottom of `01_SYSTEM_CONTRACT.md`

---

## Known Issue Entry Format

Active issue:
```markdown
| K## | Description | `AffectedModule` | Low/Medium/High/Critical | Workaround description | Open/In Progress |
```

Resolved: Move to appropriate priority table in "Resolved Issues" section.

---

## `[VERIFY: ...]` Markers

When you encounter a fact you can't confirm from the handouts alone, write:
```markdown
[VERIFY: description of what needs checking]
```

These markers signal to the human (or a future agent with source access) that the claim needs validation. They are **not** TODOs for the handout system — they are specific factual claims that need source code confirmation.

---

## Handout File Set

| File | Purpose | Typical Length |
|------|---------|---------------|
| `00_QUICK_REF.md` | Architecture overview, data flow, directory map. Read first. | ≤ 150 lines |
| `01_SYSTEM_CONTRACT.md` | Non-negotiable invariants. Laws. | ~200 lines |
| `02_MODULE_REGISTRY.md` | Module interfaces, constructors, quirks. | ~200 lines |
| `03_GPU_PARAMS.md` | Every GPU parameter. Types, defaults, ranges. | ~150 lines |
| `04_CODING_STANDARDS.md` | Patterns, anti-patterns, templates. | ~250 lines |
| `05_KNOWN_ISSUES.md` | Active issues, resolved bugs, tech debt. | Growing |
| `06_MAINTENANCE.md` | How to maintain these handouts. | ~100 lines |

---

## Quality Checks

Before marking a handout update as complete:

- [ ] No `[TODO]` markers (use `[VERIFY: ...]` instead for uncertain facts)
- [ ] Cross-references are correct (e.g., "See System Contract LAW 5" → LAW 5 exists)
- [ ] Table alignment is not broken
- [ ] Code examples compile / are syntactically valid
- [ ] Bug entry has sequential numbering (no gaps, no duplicates)
- [ ] If a new LAW was added, it's also in the Quick Checklist
