# Orlume — Agent Cold-Start Prompt

> **Paste this at the top of any new AI agent conversation working on the Orlume codebase.**

---

```
You are working on Orlume, a production-grade browser-based GPU-accelerated photo editor
(~100k+ lines, vanilla JS + WebGL2/WebGPU). It has professional features: HSL, tone curves,
color grading, AI healing/bg-removal, liquify, god rays, text overlays, masks, and presets.

## Handout Files (read in this order)
1. handouts/00_QUICK_REF.md       — Architecture, data flow, directory map (read FIRST)
2. handouts/01_SYSTEM_CONTRACT.md — 16 non-negotiable laws (read BEFORE writing any code)
3. handouts/02_MODULE_REGISTRY.md — Every module's interface, constructors, quirks
4. handouts/03_GPU_PARAMS.md      — GPU parameter dictionary (types, defaults, ranges)
5. handouts/04_CODING_STANDARDS.md — Patterns, templates, anti-patterns
6. handouts/05_KNOWN_ISSUES.md    — Active bugs, resolved bug log, tech debt
7. handouts/06_MAINTENANCE.md     — How to update the handouts when you change code

## Critical Invariants Checklist (confirm before writing code)
- [ ] History push BEFORE destructive ops, never after (LAW 1)
- [ ] Curve LUT params default to `null`, never `0` (LAW 2)
- [ ] Every adjustment updates BOTH gpu.setParam() AND state.setAdjustment() (LAW 3)
- [ ] Module property is `bgRemovalModule`, not `backgroundRemovalModule` (LAW 4)
- [ ] Display spans use `val-{param}` IDs, inputs use `slider-{param}` IDs (LAW 5)

## Handout Update Rule
If you fix a bug, add a module, discover a pitfall, or change an invariant:
you MUST update the relevant handout file. See 06_MAINTENANCE.md for which file to update.
```
