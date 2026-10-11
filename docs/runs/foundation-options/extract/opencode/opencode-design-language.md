# Design Language: OpenCode | The open source AI coding agent

> Extracted from `https://opencode.ai` on September 26, 2026
> 673 elements analyzed

This document describes the complete design language of the website. It is structured for AI/LLM consumption — use it to faithfully recreate the visual design in any framework.

## Color Palette

### Primary Colors

| Role | Hex | RGB | HSL | Usage Count |
|------|-----|-----|-----|-------------|
| Primary | `#fdfcfc` | rgb(253, 252, 252) | hsl(0, 20%, 99%) | 23 |

### Tonal Ramps

Generated in OKLCH from each role colour, so the steps are perceptually even. The site's own colour keeps its position in the ladder.

| Role | 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950 |
|------|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|
| primary | **`#fdfcfc`** | `#eae9e9` | `#d9d9d9` | `#c1c0c0` | `#a09f9f` | `#828282` | `#6d6c6c` | `#575656` | `#474646` | `#393838` | `#1f1f1f` |
| neutral | `#f6f5f5` | `#ebe9e9` | `#dad8d8` | `#c1c0c0` | `#a19f9f` | `#838181` | **`#646262`** | `#585656` | `#484646` | `#3a3838` | `#1f1e1e` |

### Semantic Pairs

| Role | Background | Foreground | Contrast | Level |
|------|------------|------------|----------|-------|
| `surface.page` | `#ffffff` | `#000000` | 21:1 | AAA |
| `surface.raised` | `#fdfcfc` | `#000000` | 20.51:1 | AAA |
| `action.primary` | `#fdfcfc` | `#000000` | 20.51:1 | AAA |

### Dominance

Share of painted background area — what the page looks like, as opposed to what it declares most often.

- `#fdfcfc` — 100%
- `#201d1d` — 0%

### Neutral Colors

| Hex | HSL | Usage Count |
|-----|-----|-------------|
| `#646262` | hsl(0, 1%, 39%) | 870 |
| `#201d1d` | hsl(0, 5%, 12%) | 299 |
| `#9a9898` | hsl(0, 1%, 60%) | 110 |
| `#8d8b8b` | hsl(0, 1%, 55%) | 30 |
| `#0f0000` | hsl(0, 100%, 3%) | 12 |
| `#000000` | hsl(0, 0%, 0%) | 4 |
| `#d0cfce` | hsl(30, 2%, 81%) | 4 |
| `#424245` | hsl(240, 2%, 26%) | 4 |

### Background Colors

Used on large-area elements: `#ffffff`, `#fdfcfc`, `#f8f7f7`

### Text Colors

Text color palette: `#1d1d1f`, `#646262`, `#201d1d`, `#fdfcfc`, `#000000`, `#8d8b8b`, `#9a9898`, `#d0cfce`, `#424245`

### Full Color Inventory

| Hex | Contexts | Count |
|-----|----------|-------|
| `#646262` | text, border | 870 |
| `#201d1d` | text, border, background | 299 |
| `#9a9898` | text, border | 110 |
| `#8d8b8b` | text, border | 30 |
| `#fdfcfc` | background, text, border | 23 |
| `#0f0000` | border | 12 |
| `#000000` | text, border | 4 |
| `#d0cfce` | text, border | 4 |
| `#424245` | text, border | 4 |

## Typography

### Font Families

- **Berkeley Mono** — used for mono (92 elements)

### Type System

- **Scale ratio** — irregular (3 distinct sizes, no modular ratio fits)
- **Measure** — ~109 characters per line (wide)
- **Fluid type** — none; sizes are fixed per breakpoint

### Named Scale

| Role | Size | Weight | Line Height | Tracking |
|------|------|--------|-------------|----------|
| `h1` | 38px / 2.375rem | 700 | 57px | normal |
| `h3` | 16px / 1rem | 400 | 16px | normal |
| `body-sm` | 14px / 0.875rem | 400 | 28px | normal |

### Type Scale

| Size (px) | Size (rem) | Weight | Line Height | Letter Spacing | Used On |
|-----------|------------|--------|-------------|----------------|---------|
| 38px | 2.375rem | 700 | 57px | normal | h1 |
| 16px | 1rem | 400 | 16px | normal | html, head, meta, style |
| 14px | 0.875rem | 400 | 28px | normal | span, figure, strong |

### Heading Scale

```css
h1 { font-size: 38px; font-weight: 700; line-height: 57px; }
h3 { font-size: 16px; font-weight: 400; line-height: 16px; }
```

### Body Text

```css
body { font-size: 16px; font-weight: 400; line-height: 16px; }
```

### Font Weights in Use

`400` (591x), `500` (75x), `700` (7x)

## Spacing

**Base unit:** 4px

| Token | Value | Rem |
|-------|-------|-----|
| spacing-1 | 1px | 0.0625rem |
| spacing-32 | 32px | 2rem |
| spacing-40 | 40px | 2.5rem |
| spacing-48 | 48px | 3rem |
| spacing-64 | 64px | 4rem |
| spacing-80 | 80px | 5rem |
| spacing-96 | 96px | 6rem |

## Border Radii

| Label | Value | Count |
|-------|-------|-------|
| sm | 4px | 5 |

## CSS Custom Properties

### Colors

```css
--color-white: #ffffff;
--color-black: #000000;
--color-bg: #ffffff;
--color-bg-surface: #f5f5f7;
--color-bg-elevated: #ffffff;
--color-text: #1d1d1f;
--color-text-secondary: #424245;
--color-text-muted: #6e6e73;
--color-text-disabled: #86868b;
--color-accent: #007aff;
--color-accent-hover: #0056b3;
--color-accent-active: #004085;
--color-success: #30d158;
--color-border: #d2d2d7;
--color-border-muted: #e5e5ea;
--color-primary: var(--color-accent);
--color-primary-hover: var(--color-accent-hover);
--color-primary-active: var(--color-accent-active);
--color-primary-text: #ffffff;
--color-danger: #ff3b30;
--color-danger-hover: #d70015;
--color-danger-active: #a50011;
--color-danger-text: #ffffff;
--color-warning: #ff9f0a;
--color-warning-hover: #cc7f08;
--color-warning-active: #995f06;
--color-warning-text: #000000;
--color-surface: var(--color-bg-surface);
--color-surface-hover: var(--color-bg-elevated);
--color-surface-border: var(--color-border);
```

### Dependencies

```css
0: --color-accent;
0: --color-accent-hover;
0: --color-accent-active;
0: --color-bg-surface;
0: --color-bg-elevated;
0: --color-border;
```

### Semantic

```css
--color-success: #30d158;
--color-warning: #ff9f0a;
--color-warning-hover: #cc7f08;
--color-warning-active: #995f06;
--color-warning-text: #000000;
--color-danger: #ff3b30;
--color-danger-hover: #d70015;
--color-danger-active: #a50011;
--color-danger-text: #ffffff;
```

## Transitions & Animations

**Durations:** `0.18s`, `0.15s`

### Common Transitions

```css
transition: all;
transition: opacity 0.18s;
transition: 0.15s;
```

## Component Patterns

Detected UI component patterns and their most common styles:

### Buttons (18 instances)

```css
.buttons {
  background-color: rgb(32, 29, 29);
  color: rgb(32, 29, 29);
  font-size: 16px;
  font-weight: 400;
  padding-top: 0px;
  padding-right: 0px;
  border-radius: 0px;
}
```

### Inputs (1 instances)

```css
.inputs {
  background-color: rgb(248, 247, 247);
  color: rgb(32, 29, 29);
  border-color: rgba(15, 0, 0, 0.12);
  border-radius: 6px;
  font-size: 16px;
  padding-top: 20px;
  padding-right: 20px;
}
```

### Links (20 instances)

```css
.links {
  color: rgb(32, 29, 29);
  font-size: 16px;
  font-weight: 400;
}
```

### Navigation (3 instances)

```css
.navigation {
  color: rgb(100, 98, 98);
  padding-top: 0px;
  padding-bottom: 0px;
  padding-left: 0px;
  padding-right: 0px;
  position: static;
}
```

### Footer (1 instances)

```css
.footer {
  color: rgb(100, 98, 98);
  padding-top: 0px;
  padding-bottom: 0px;
  font-size: 16px;
}
```

### Tabs (6 instances)

```css
.tabs {
  color: rgb(154, 152, 152);
  font-size: 16px;
  font-weight: 400;
  padding-top: 16px;
  padding-right: 0px;
  border-color: rgb(154, 152, 152) rgb(154, 152, 152) rgba(0, 0, 0, 0);
  border-radius: 0px;
}
```

### Switches (1 instances)

```css
.switches {
  border-radius: 0px;
  border-color: rgb(0, 0, 0);
}
```

## Component Clusters

Reusable component instances grouped by DOM structure and style similarity:

### Button — 7 instances, 3 variants

**Variant 1** (1 instance)

```css
  background: rgba(0, 0, 0, 0);
  color: rgb(32, 29, 29);
  padding: 16px 0px 16px 0px;
  border-radius: 0px;
  border: 0px 0px 2px none none solid rgb(32, 29, 29);
  font-size: 16px;
  font-weight: 400;
```

**Variant 2** (5 instances)

```css
  background: rgba(0, 0, 0, 0);
  color: rgb(154, 152, 152);
  padding: 16px 0px 16px 0px;
  border-radius: 0px;
  border: 0px 0px 2px none none solid rgb(154, 152, 152) rgb(154, 152, 152) rgba(0, 0, 0, 0);
  font-size: 16px;
  font-weight: 400;
```

**Variant 3** (1 instance)

```css
  background: rgb(32, 29, 29);
  color: rgb(253, 252, 252);
  padding: 4px 20px 4px 20px;
  border-radius: 4px;
  border: 0px none rgb(253, 252, 252);
  font-size: 16px;
  font-weight: 500;
```

### Button — 1 instance, 1 variant

**Variant 1** (1 instance)

```css
  background: rgba(0, 0, 0, 0);
  color: rgb(100, 98, 98);
  padding: 8px 16px 8px 8px;
  border-radius: 4px;
  border: 0px none rgb(100, 98, 98);
  font-size: 16px;
  font-weight: 400;
```

### Button — 8 instances, 1 variant

**Variant 1** (8 instances)

```css
  background: rgba(0, 0, 0, 0);
  color: rgb(32, 29, 29);
  padding: 0px 0px 0px 0px;
  border-radius: 0px;
  border: 0px none rgb(32, 29, 29);
  font-size: 16px;
  font-weight: 500;
```

### Input — 1 instance, 1 variant

**Variant 1** (1 instance)

```css
  background: rgb(248, 247, 247);
  color: rgb(32, 29, 29);
  padding: 20px 20px 20px 20px;
  border-radius: 6px;
  border: 1px solid rgba(15, 0, 0, 0.12);
  font-size: 16px;
  font-weight: 400;
```

### Button — 1 instance, 1 variant

**Variant 1** (1 instance)

```css
  background: rgba(0, 0, 0, 0);
  color: rgb(154, 152, 152);
  padding: 0px 0px 0px 0px;
  border-radius: 0px;
  border: 0px none rgb(154, 152, 152);
  font-size: 16px;
  font-weight: 400;
```

## Layout System

**0 grid containers** and **38 flex containers** detected.

### The System

- **Content column** — 1080px wide
- **Section rhythm** — 64px vertical padding (ladder: 64px · 80px · 96px)
- **Gap scale** — 8px · 10px · 12px · 16px · 24px · 32px · 40px · 64px
- **Fluid layout** — 1 clamp/viewport declarations

```css
/* … */ { width: calc(-48px + 100vw); }
```

### Container Widths

| Max Width | Padding |
|-----------|---------|
| 1080px | 0px |
| 100% | 80px |

### Flex Patterns

| Direction/Wrap | Count |
|----------------|-------|
| column/nowrap | 5x |
| row/nowrap | 32x |
| row/wrap | 1x |

**Gap values:** `8px`, `10px`, `12px`, `16px`, `24px`, `32px`, `40px`, `64px`

## Accessibility (WCAG 2.1)

**Overall Score: 100%** — 2 passing, 0 failing color pairs

### Passing Color Pairs

| Foreground | Background | Ratio | Level |
|------------|------------|-------|-------|
| `#fdfcfc` | `#201d1d` | 16.34:1 | AAA |

## Design System Score

**Overall: 94/100 (Grade: A)**

| Category | Score |
|----------|-------|
| Color Discipline | 100/100 |
| Typography Consistency | 100/100 |
| Spacing System | 100/100 |
| Shadow Consistency | 85/100 |
| Border Radius Consistency | 100/100 |
| Accessibility | 100/100 |
| CSS Tokenization | 100/100 |

**Strengths:** Tight, disciplined color palette, Consistent typography system, Well-defined spacing scale, Clean elevation system, Consistent border radii, Strong accessibility compliance, Good CSS variable tokenization

**Issues:**
- 7 !important rules — prefer specificity over overrides
- 86% of CSS is unused — consider purging
- 2008 duplicate CSS declarations

## Z-Index Map

**1 unique z-index values** across 1 layers.

| Layer | Range | Elements |
|-------|-------|----------|
| sticky | 10,10 | section |

## SVG Icons

**12 unique SVG icons** detected. Dominant style: **filled**.

| Size Class | Count |
|------------|-------|
| xs | 1 |
| sm | 2 |
| md | 9 |

**Icon colors:** `currentColor`, `white`

## Font Files

| Family | Source | Weights | Styles |
|--------|--------|---------|--------|
| IBM Plex Mono | self-hosted | 100, 200, 300, 400, 450, 500, 600, 700 | normal, italic |
| IBM Plex Sans | self-hosted | 100, 200, 300, 400, 450, 500, 600, 700 | normal, italic |
| IBM Plex Sans Condensed | self-hosted | 100, 200, 300, 400, 450, 500, 600, 700 | normal, italic |
| IBM Plex Sans Hebrew | self-hosted | 100, 200, 300, 400, 450, 500, 600, 700 | normal |
| IBM Plex Sans Devanagari | self-hosted | 100, 200, 300, 400, 450, 500, 600, 700 | normal |
| IBM Plex Sans Thai | self-hosted | 100, 200, 300, 400, 450, 500, 600, 700 | normal |
| IBM Plex Sans Thai Looped | self-hosted | 100, 200, 300, 400, 450, 500, 600, 700 | normal |
| IBM Plex Serif | self-hosted | 100, 200, 300, 400, 450, 500, 600, 700 | normal, italic |
| IBM Plex Sans Arabic | self-hosted | 100, 200, 300, 400, 450, 500, 600, 700 | normal |

## Image Style Patterns

| Pattern | Count | Key Styles |
|---------|-------|------------|
| thumbnail | 1 | objectFit: fill, borderRadius: 0px, shape: square |

**Aspect ratios:** 5.57:1 (1x)

## Motion Language

**Feel:** mixed · **Scroll-linked:** yes

### Duration Tokens

| name | value | ms |
|---|---|---|
| `xs` | `150ms` | 150 |
| `sm` | `180ms` | 180 |

## Component Anatomy

### button — 17 instances

**Slots:** label

## Brand Voice

**Tone:** friendly · **Pronoun:** we→you · **Headings:** Title Case (balanced)

### Top CTA Verbs

- **what** (2)
- **how** (2)
- **can** (2)
- **curl** (1)
- **npm** (1)
- **bun** (1)
- **brew** (1)
- **paru** (1)

### Button Copy Patterns

- "curl" (1×)
- "npm" (1×)
- "bun" (1×)
- "brew" (1×)
- "paru" (1×)
- "yay" (1×)
- "curl -fssl https://opencode.ai/v2/install | bash" (1×)
- "what is opencode?" (1×)
- "how do i use opencode?" (1×)
- "do i need extra ai subscriptions to use opencode?" (1×)

### Sample Headings

> The open source AI coding agent
> What is OpenCode?
> The open source AI coding agent
> Built for privacy first
> FAQ
> The open source AI coding agent
> What is OpenCode?
> The open source AI coding agent
> Built for privacy first
> FAQ

## Page Intent

**Type:** `landing` (confidence 0.45)
**Description:** OpenCode - The open source coding agent.

## Section Roles

Reading order (top→bottom): faq → content → nav → nav → hero → content → content → content → content → content → faq → content → content → footer

| # | Role | Heading | Confidence |
|---|------|---------|------------|
| 0 | faq | The open source AI coding agent | 0.85 |
| 1 | content | — | 0.3 |
| 2 | nav | — | 0.9 |
| 3 | nav | — | 0.9 |
| 4 | hero | The open source AI coding agent | 0.85 |
| 5 | content | — | 0.3 |
| 6 | content | — | 0.3 |
| 7 | content | What is OpenCode? | 0.3 |
| 8 | content | The open source AI coding agent | 0.3 |
| 9 | content | Built for privacy first | 0.3 |
| 10 | faq | FAQ | 0.85 |
| 11 | content | — | 0.3 |
| 12 | content | Be the first to know when we release new products | 0.3 |
| 13 | footer | — | 0.95 |

## Material Language

**Label:** `flat` (confidence 0.55)

| Metric | Value |
|--------|-------|
| Avg saturation | 0.133 |
| Shadow profile | none |
| Avg shadow blur | 0px |
| Max radius | 4px |
| backdrop-filter in use | no |
| Gradients | 0 |

## Imagery Style

**Label:** `flat-illustration` (confidence 0.55)
**Counts:** total 1, svg 1, icon 0, screenshot-like 0, photo-like 0
**Dominant aspect:** ultra-wide
**Radius profile on images:** square

## Component Screenshots

4 retina crops written to `screenshots/`. Index: `*-screenshots.json`.

| Cluster | Variant | Size (px) | File |
|---------|---------|-----------|------|
| button--default | 0 | 38 × 50 | `screenshots/button-default-0.png` |
| button--default | 1 | 29 × 50 | `screenshots/button-default-1.png` |
| button--default | 2 | 29 × 50 | `screenshots/button-default-2.png` |
| input--default | 0 | 918 × 66 | `screenshots/input-default-0.png` |

Full-page: `screenshots/full-page.png`

## Quick Start

To recreate this design in a new project:

1. **Install fonts:** Add `Berkeley Mono` from Google Fonts or your font provider
2. **Import CSS variables:** Copy `variables.css` into your project
3. **Tailwind users:** Use the generated `tailwind.config.js` to extend your theme
4. **Design tokens:** Import `design-tokens.json` for tooling integration
