# TSXobf UI Design System

## Design Read

TSXobf is a developer/security compiler tool for TypeScript engineers protecting critical logic. The interface should feel like a tactical telemetry console for a real VM compiler pipeline, not a generic SaaS landing page.

## Product Surfaces

- Marketing/docs surface: explain selective virtualization, compiler pipeline, threat model, syntax support, and quick start.
- Visualizer surface: inspect semantic graph, IR blocks, transform passes, bytecode stream, runtime handlers, and equivalence checks.
- CLI support surface: make commands copyable, profiles clear, and failure modes actionable.

## Visual Direction

- Primary style: Tactical Telemetry with restrained industrial brutalism.
- Theme: dark graphite only. Avoid section-level theme flips.
- Structure: visible grid lines, dense but readable data panels, semantic status tags, terminal and bytecode motifs.
- Texture: subtle scanline/noise layer and low-chroma radial depth. No decorative blobs or purple AI gradients.
- Shape: square to small-radius technical surfaces. Use pill shapes only for CTAs and compact status chips.

## Tokens

```css
--bg: #050706;
--panel: #0b100d;
--panel-2: #101712;
--ink: #eef8f1;
--muted: #9cafaa;
--faint: #5d7068;
--line: rgba(174, 255, 198, 0.13);
--line-strong: rgba(174, 255, 198, 0.26);
--accent: #9dff6f;
--ok: #4df79f;
--warn: #f0c96a;
--danger: #ff665f;
--info: #67e8f9;
```

## Typography

- Display and UI: `Geist`, `Plus Jakarta Sans`, system sans fallback.
- Code and telemetry: `JetBrains Mono`, `SF Mono`, `Consolas`, monospace.
- Use tabular figures for metrics and bytecode.
- Headings should be compact, heavy, and left-aligned. Avoid long wrapped hero copy.

## UX Rules

- Always provide visible focus states and a skip link.
- Do not rely on color alone for status. Pair color with text labels.
- Respect `prefers-reduced-motion`.
- Keep mobile layouts single-column and avoid horizontal overflow.
- Do not use decorative scroll cues.
- Use real visual assets or actual UI previews. Avoid div-only fake screenshots when a real page section can show the actual interface.

## Visualizer Information Architecture

1. Hero: value proposition plus live-feeling compile console.
2. Telemetry strip: selective, register IR, polymorphic, standalone.
3. Pipeline: six compiler phases in a deterministic rail.
4. Transform matrix: passes and hardening mechanisms.
5. Runtime cockpit: bytecode, handlers, constant pool, rolling keys.
6. Threat model: honest protection levels.
7. Syntax status: supported, limited, unsupported.
8. Quick start: install/build/run commands.
9. Final CTA: GitHub and support status.

## Anti-Patterns To Avoid

- Purple/blue AI glow as primary style.
- Three identical feature cards as the main story.
- Generic slogans like "next-gen", "unleash", or "seamless".
- Fake precision metrics without source.
- Inline icon clutter where text/status labels are clearer.
- Overly rounded consumer SaaS cards.
