# Design Language: Grok

> Extracted from `https://grok.com` on September 26, 2026
> 710 elements analyzed

This document describes the complete design language of the website. It is structured for AI/LLM consumption — use it to faithfully recreate the visual design in any framework.

## Color Palette

### Primary Colors

| Role | Hex | RGB | HSL | Usage Count |
|------|-----|-----|-----|-------------|
| Primary | `#0890ff` | rgb(8, 144, 255) | hsl(207, 100%, 52%) | 1 |
| Secondary | `#3860be` | rgb(56, 96, 190) | hsl(222, 54%, 48%) | 4 |
| Accent | `#27455c` | rgb(39, 69, 92) | hsl(206, 40%, 26%) | 8 |

### Tonal Ramps

Generated in OKLCH from each role colour, so the steps are perceptually even. The site's own colour keeps its position in the ladder.

| Role | 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950 |
|------|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|
| primary | `#bcfbff` | `#aaefff` | `#91deff` | `#6ac5ff` | `#35a2ff` | **`#0890ff`** | `#006bd1` | `#0055b0` | `#004495` | `#00367d` | `#001c4d` |
| secondary | `#d6f6ff` | `#c8eaff` | `#b3d8ff` | `#95bfff` | `#709cfc` | `#527ddd` | **`#3860be`** | `#2f51a1` | `#234188` | `#1a3472` | `#0a1b46` |
| accent | `#e4f9ff` | `#d6edff` | `#c3ddf2` | `#a8c4dc` | `#84a4be` | `#6686a0` | `#527088` | `#3f5a6f` | **`#27455c`** | `#273b4b` | `#12202b` |
| neutral | `#f5f5f5` | `#eaeaea` | `#d9d9d9` | `#c0c0c0` | `#9f9f9f` | `#828282` | `#6c6c6c` | **`#555555`** | `#464646` | `#393939` | `#1f1f1f` |

### Semantic Pairs

| Role | Background | Foreground | Contrast | Level |
|------|------------|------------|----------|-------|
| `surface.page` | `#f9f8f7` | `#000000` | 19.8:1 | AAA |
| `surface.raised` | `#ffffff` | `#000000` | 21:1 | AAA |
| `action.primary` | `#0890ff` | `#000000` | 6.44:1 | AA |
| `action.secondary` | `#3860be` | `#fcfcfc` | 5.71:1 | AA |
| `action.accent` | `#27455c` | `#fcfcfc` | 9.78:1 | AAA |

### Dominance

Share of painted background area — what the page looks like, as opposed to what it declares most often.

- `#ffffff` — 99%
- `#050505` — 1%
- `#0890ff` — 0%

### Neutral Colors

| Hex | HSL | Usage Count |
|-----|-----|-------------|
| `#050505` | hsl(0, 0%, 2%) | 731 |
| `#0f0d0a` | hsl(36, 20%, 5%) | 302 |
| `#ffffff` | hsl(0, 0%, 100%) | 72 |
| `#555555` | hsl(0, 0%, 33%) | 25 |
| `#636363` | hsl(0, 0%, 39%) | 14 |
| `#262626` | hsl(0, 0%, 15%) | 10 |
| `#858585` | hsl(0, 0%, 52%) | 6 |
| `#eeeeee` | hsl(0, 0%, 93%) | 6 |
| `#dddddd` | hsl(0, 0%, 87%) | 4 |
| `#ababab` | hsl(0, 0%, 67%) | 4 |
| `#767676` | hsl(0, 0%, 46%) | 4 |
| `#d8d8d8` | hsl(0, 0%, 85%) | 2 |

### Background Colors

Used on large-area elements: `#f9f8f7`, `#ffffff`

### Text Colors

Text color palette: `#000000`, `#050505`, `#636363`, `#fcfcfc`, `#858585`, `#ababab`, `#eeeeee`, `#555555`, `#ffffff`, `#b3b3b3`

### Gradients

```css
background-image: linear-gradient(in oklab, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0) 25%, rgba(0, 0, 0, 0) 100%);
```

```css
background-image: linear-gradient(90deg, rgba(5, 5, 5, 0.25) 0%, rgba(5, 5, 5, 0.25) 35%, rgb(99, 102, 241) 40%, rgb(168, 85, 247) 45%, rgb(236, 72, 153) 50%, rgb(249, 115, 22) 55%, rgb(234, 179, 8) 60%, rgba(5, 5, 5, 0.25) 65%, rgba(5, 5, 5, 0.25) 100%);
```

### Full Color Inventory

| Hex | Contexts | Count |
|-----|----------|-------|
| `#050505` | text, background, border | 731 |
| `#0f0d0a` | border | 302 |
| `#ffffff` | background, text, border | 72 |
| `#555555` | text, border | 25 |
| `#636363` | text, border | 14 |
| `#262626` | background, border | 10 |
| `#27455c` | background | 8 |
| `#858585` | text | 6 |
| `#eeeeee` | text, border, background | 6 |
| `#dddddd` | border | 4 |
| `#ababab` | text, border | 4 |
| `#3860be` | text, border, background | 4 |
| `#767676` | background, border | 4 |
| `#d8d8d8` | border | 2 |
| `#0890ff` | background | 1 |
| `#32ae88` | border | 1 |
| `#bbbbbb` | border | 1 |

## Typography

### Font Families

- **universalSans** — used for all (57 elements)

### Type System

- **Scale ratio** — irregular (11 distinct sizes, no modular ratio fits)
- **Measure** — ~70 characters per line (comfortable, low confidence from 1 sample)
- **Fluid type** — none; sizes are fixed per breakpoint

### Named Scale

| Role | Size | Weight | Line Height | Tracking |
|------|------|--------|-------------|----------|
| `h1` | 24px / 1.5rem | 550 | 32.4px | -0.48px |
| `h2` | 16px / 1rem | 400 | 24px | normal |
| `body-sm` | 15px / 0.9375rem | 400 | 22.5px | normal |
| `micro` | 14.4px / 0.9rem | 400 | 38px | 0.144px |
| `h4` | 14px / 0.875rem | 400 | 21px | normal |
| `sm-3` | 13.6px / 0.85rem | 400 | 27.2px | normal |
| `sm-4` | 13.008px / 0.813rem | 400 | 19.512px | normal |
| `sm-5` | 13px / 0.8125rem | 400 | 19.5px | normal |
| `sm-6` | 12.992px / 0.812rem | 400 | 19.488px | normal |
| `sm-7` | 12.8px / 0.8rem | 400 | normal | normal |
| `sm-8` | 12px / 0.75rem | 400 | normal | normal |

### Type Scale

| Size (px) | Size (rem) | Weight | Line Height | Letter Spacing | Used On |
|-----------|------------|--------|-------------|----------------|---------|
| 24px | 1.5rem | 550 | 32.4px | -0.48px | h1, span, div |
| 16px | 1rem | 400 | 24px | normal | html, head, link, script |
| 15px | 0.9375rem | 400 | 22.5px | normal | body, div, noscript, script |
| 14.4px | 0.9rem | 400 | 38px | 0.144px | button, svg, title, g |
| 14px | 0.875rem | 400 | 21px | normal | a, div, svg, defs |
| 13.6px | 0.85rem | 400 | 27.2px | normal | div, svg, path, span |
| 13.008px | 0.813rem | 400 | 19.512px | normal | div, button |
| 13px | 0.8125rem | 400 | 19.5px | normal | div, a, button, p |
| 12.992px | 0.812rem | 400 | 19.488px | normal | div, br, a, p |
| 12.8px | 0.8rem | 400 | normal | normal | input |
| 12px | 0.75rem | 400 | normal | normal | span, button, a, img |

### Heading Scale

```css
h1 { font-size: 24px; font-weight: 550; line-height: 32.4px; }
h2 { font-size: 16px; font-weight: 400; line-height: 24px; }
h4 { font-size: 14px; font-weight: 400; line-height: 21px; }
```

### Body Text

```css
body { font-size: 24px; font-weight: 550; line-height: 32.4px; }
```

### Font Weights in Use

`400` (609x), `500` (68x), `700` (19x), `600` (9x), `550` (5x)

## Spacing

**Base unit:** 2px

| Token | Value | Rem |
|-------|-------|-----|
| spacing-1 | 1px | 0.0625rem |
| spacing-10 | 10px | 0.625rem |
| spacing-20 | 20px | 1.25rem |
| spacing-23 | 23px | 1.4375rem |
| spacing-25 | 25px | 1.5625rem |
| spacing-28 | 28px | 1.75rem |
| spacing-30 | 30px | 1.875rem |
| spacing-35 | 35px | 2.1875rem |
| spacing-40 | 40px | 2.5rem |
| spacing-58 | 58px | 3.625rem |
| spacing-150 | 150px | 9.375rem |

## Border Radii

| Label | Value | Count |
|-------|-------|-------|
| xs | 1px | 8 |
| sm | 4px | 1 |
| md | 8px | 1 |
| lg | 16px | 1 |
| xl | 20px | 3 |
| xl | 24px | 1 |
| full | 50px | 1 |
| full | 9999px | 13 |

## Elevation

3 levels from 9 raw shadows · neutral tint

**xs** — blur 5px, y -3px, used 1×
```css
box-shadow: rgb(199, 197, 199) -3px -3px 5px -2px;
```

**sm** — blur 18px, y 0px, used 1×
```css
box-shadow: rgba(0, 0, 0, 0.2) 0px 0px 18px 0px;
```

**md** — blur 30px, y 0px, used 1× · 6 layers
```css
box-shadow: rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0.1) 0px 0px 30px -5px, rgba(0, 0, 0, 0.1) 0px 0px 6px -4px;
```

## Inset Shadows

```css
box-shadow: rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(56, 87, 199, 0.5) 0px 0px 0px 0px inset, rgba(0, 0, 0, 0) 0px 0px 0px 0px;
```

```css
box-shadow: rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(15, 13, 10, 0.04) 0px 0px 0px 1px inset, rgba(0, 0, 0, 0.04) 0px 2px 8px 0px;
```

## CSS Custom Properties

### Colors

```css
--border: 0 0% 89.8%;
--input-border: oklch(90.01% 0 none/.38);
--card-border: oklch(95.5% .0092 274.92);
--sidebar-primary-foreground: 0 0% 98%;
--card: oklch(99.24% 0 none/.8);
--thead-border-b-color: oklch(11.57% 0 none/.1);
--bg-warning: hsl(47 100% 45%/.08);
--border-invert-l1: oklch(99.24% 0 none/.06);
--primary-foreground: 0 0% 98%;
--button-secondary-fill: oklch(11.57% 0 none/.04);
--tw-inset-ring-shadow: 0 0 #0000;
--muted: 0 0% 96.1%;
--cookie-consent-on-primary: oklch(97.72% 0 none);
--input-button-border-hover: oklch(91.58% 0 none);
--popover: oklch(96.19% 0 none);
--color-white: #fff;
--button-outline-border: oklch(90.01% 0 none/.5);
--color-blue-400: hsl(227 72% 65%);
--popover-foreground: 0 0% 3.9%;
--background-secondary: oklch(99.33% .0009 106.42);
--thead-bg-color: 0 0% 99%;
--chart-2: 173 58% 39%;
--button-secondary-selected: oklch(90.01% 0 none/.7);
--sidebar-primary: 240 5.9% 10%;
--background-color: 0 0% 97%;
--input-border-focus: oklch(50.13% 0 none/.5);
--border-incognito-muted: 243 89% 91%;
--accent: 0 0% 96.1%;
--button-primary-hover: oklch(11.57% 0 none/.8);
--secondary-foreground: 0 0% 9%;
--border-l3: oklch(11.57% 0 none/.15);
--card-focus: oklch(90.01% 0 none);
--button-secondary-fill-active: oklch(11.57% 0 none/.08);
--card-hover: oklch(33.11% 0 none/.04);
--sidebar-border: 220 13% 91%;
--bg-electric-blue: hsl(222 100% 55%/10%);
--tw-border-style: solid;
--incognito-input-button-border-hover: oklch(82.31% .0132 305.99);
--color-border: oklch(11.57% 0 none/.06);
--destructive: 0 84.2% 60.2%;
--chart-3: 197 37% 24%;
--tw-border-spacing-y: 0px;
--primary: 0 0% 2%;
--sidebar-ring: 217.2 91.2% 59.8%;
--button-secondary-hover: oklch(90.01% 0 none/.8);
--chart-1: 12 76% 61%;
--tw-ring-shadow: 0 0 #0000;
--border-l2: oklch(11.57% 0 none/.1);
--card-foreground: 0 0% 3.9%;
--sidebar-accent-foreground: 240 5.9% 10%;
--tw-border-spacing-x: 0px;
--gradient-bg: oklch(92.34% 0 none);
--accent-foreground: 0 0% 9%;
--ring: oklch(61.54% 0 none);
--tw-ring-offset-color: #fff;
--color-red-400: hsl(356 58% 56%);
--card-border-focus: oklch(90.01% 0 none);
--sidebar-foreground: 240 5.3% 26.1%;
--sidebar-accent: 240 4.8% 95.9%;
--border-l1: oklch(11.57% 0 none/.06);
--tw-ring-offset-width: 0px;
--border-incognito-hover: 245 60% 65%;
--popover-hover: oklch(99.24% 0 none/.2);
--destructive-foreground: 0 0% 98%;
--chart-4: 43 74% 66%;
--fg-secondary: 0 0% 39%;
--tw-ring-offset-shadow: 0 0 #0000;
--button-secondary-fill-hover: oklch(11.57% 0 none/.06);
--button-secondary: oklch(99.24% 0 none);
--popover-border: oklch(99.24% 0 none);
--button-primary: oklch(11.57% 0 none);
--border-incognito: 245 74% 74%;
--chart-5: 27 87% 67%;
--fg-primary: 0 0% 2%;
--muted-foreground: 0 0% 45.1%;
--toggle-border: oklch(11.57% 0 none/.1);
--incognito-input-button-border: oklch(82.31% .0132 305.99);
--input-button-border: oklch(91.58% 0 none);
--foreground: oklch(99.24% 0 none);
--secondary: 0 0% 39%;
```

### Spacing

```css
--resize-dur: .22s;
--resize-ease: cubic-bezier(.65, 0, .35, 1);
--tw-space-x-reverse: 0;
--font-size-label: 15px;
--font-size-ui: 15px;
--content-breakout-margin: calc(-1*1.5rem);
--spacing: .25rem;
--font-size-meta: 13px;
--tw-space-y-reverse: 0;
--font-size-chrome: 14px;
--diffs-font-size: 13px;
--font-size-title: 16px;
```

### Typography

```css
--tracking-wider: .05em;
--font-weight-bold: 700;
--text-xl: 1.25rem;
--leading-relaxed: 1.625;
--leading-snug: 1.375;
--diffs-line-height: 1.7;
--text-2xl--line-height: calc(2/1.5);
--text-swap-blur: 1.5px;
--diffs-font-family: "var(--font-ibm-plex-mono)",monospace;
--text-xl--line-height: calc(1.75/1.25);
--leading-tight: 1.25;
--text-swap-dur: .15s;
--line-height-ui: 1.5;
--text-4xl--line-height: calc(2.5/2.25);
--tracking-tight: -.025em;
--text-2xl: 1.5rem;
--text-lg: 1.125rem;
--font-default: ;
--text-5xl--line-height: 1;
--leading-normal: 1.5;
--text-lg--line-height: calc(1.75/1.125);
--button-text-hover: oklch(90.01% 0 none/.08);
--font-sans: ;
--text-6xl: 3.75rem;
--default-font-family: ;
--font-weight-light: 300;
--text-swap-ease: cubic-bezier(.23, 1, .32, 1);
--tracking-tighter: -.05em;
--text-swap-translate-y: 3px;
--tracking-wide: .025em;
--font-weight-extrabold: 800;
--text-4xl: 2.25rem;
--tracking-normal: 0em;
--text-3xl--line-height: calc(2.25/1.875);
--text-5xl: 3rem;
--text-3xl: 1.875rem;
--tracking-widest: .1em;
--font-weight-medium: 500;
--font-weight-normal: 400;
--font-serif: Georgia,Cambria,"Times New Roman",Times,serif;
--text-6xl--line-height: 1;
--default-mono-font-family: ;
```

### Shadows

```css
--tw-inset-shadow-alpha: 100%;
--tw-inset-shadow: 0 0 #0000;
--tw-shadow-alpha: 100%;
--drop-shadow-sm: 0 1px 1px #0000000d;
--tw-drop-shadow-alpha: 100%;
--drop-shadow-none: 0 0 #0000;
--drop-shadow-2xl: 0 25px 25px #00000026;
--drop-shadow-md: 0 4px 3px #00000012,0 2px 2px #0000000f;
--tw-shadow: 0 0 #0000;
--drop-shadow: 0 1px 2px #0000001a,0 1px 1px #0000000f;
```

### Radii

```css
--radius-4xl: 2rem;
--radius-none: 0;
--radius-2xl: 1rem;
--radius: .5rem;
--radius-3xl: 1.5rem;
--radius-full: 9999px;
--radius-xs: .125rem;
--radius-xl: .75rem;
```

### Other

```css
--input-button-background-hover: oklch(96.12% 0 none);
--green-900: 131 100% 13%;
--cyan-800: 192 55% 15%;
--header-height: 56px;
--blue-400: 227 72% 65%;
--toggle-hover: oklch(99.24% 0 none);
--purple-200: 243 89% 91%;
--aspect-video: 16/9;
--pink-600: 324 38% 33%;
--surface-l1: 0 0% 97%;
--blur-lg: 16px;
--neutral-800: 0 0% 16%;
--fg-incognito: 245 47% 51%;
--neutral-300: 0 0% 62%;
--tw-animation-delay: 0s;
--scrollbar-track: transparent;
--important-hover: oklch(98.48% 0 none);
--fg-invert: 0 0% 99%;
--neutral-500: 0 0% 39%;
--neutral-100: 0 0% 95%;
--panel-open-dur: .15s;
--tw-outline-style: solid;
--fg-positive: 180 98% 23%;
--max-width-md: 28rem;
--ease-in: cubic-bezier(.4,0,1,1);
--surface-l1-hover: 0 0% 95%;
--orange-700: 22 65% 19%;
--gray-950: 228 8% 7%;
--blue-100: 225 100% 96%;
--max-width-sm: 24rem;
--lime-900: 66 62% 8%;
--page-slide-ease: cubic-bezier(.22,1,.36,1);
--tw-enter-scale: 1;
--yellow-950: 43 80% 15%;
--link-hover: oklch(72.44% .1266 271.21);
--incognito-input-background: oklch(95.78% .0057 308.39);
--blue-600: 227 44% 38%;
--highlight: oklch(89.28% .0457 270.86/.4);
--orange-200: 17 92% 88%;
--icon-swap-dur: .18s;
--gray-600: 228 2% 29%;
--max-width-xl: 36rem;
--blue-900: 227 35% 14%;
--blue-200: 225 84% 90%;
--warm-gray-600: 30 1% 29%;
--panel-ease: cubic-bezier(.22, 1, .36, 1);
--purple-500: 245 47% 51%;
--yellow-200: 48 95% 77%;
--purple-400: 245 60% 65%;
--link: oklch(50.04% .1778 267.72);
--tw-gradient-from: rgba(0, 0, 0, 0);
--neutral-50: 0 0% 97%;
--yellow-700: 45 100% 29%;
--button-filled: oklch(11.57% 0 none);
--tw-gradient-to: rgba(0, 0, 0, 0);
--orange-50: 12 100% 97%;
--orange-500: 22 100% 31%;
--purple-1000: 240 50% 2%;
--black: 0 0% 2%;
--cookie-consent-surface: oklch(97.72% 0 none);
--fg-danger: 355 63% 44%;
--blur-2xl: 40px;
--pink-50: 324 100% 98%;
--yellow-300: 48 98% 62%;
--input-button-background: oklch(100% 0 none);
--lime-50: 75 67% 95%;
--_number-flow-d-opacity: 0;
--tw-exit-translate-y: 0;
--blue-50: 225 100% 98%;
--button-danger-fill-active: hsl(355 63% 44%/10%);
--tw-gradient-via-position: 50%;
--incognito-input-button-background: oklch(95.78% .0057 308.39);
--gray-100: 228 33% 95%;
--warm-gray-700: 30 1% 21%;
--important: oklch(99.24% 0 none);
--red-100: 0 100% 96%;
--page-slide-dur: .25s;
--button-incognito: hsl(245 47% 51%);
--gray-50: 228 43% 97%;
--tw-gradient-to-position: 100%;
--red-1000: 0 75% 2%;
--warm-gray-100: 20 11% 95%;
--default-transition-duration: .15s;
--fg-success: 136 100% 29%;
--animate-pulse: pulse 2s cubic-bezier(.4,0,.6,1)infinite;
--blue-1000: 227 60% 2%;
--gray-1000: 228 25% 2%;
--container-xs: 20rem;
--blur-none: 0;
--lime-400: 73 65% 37%;
--chip: oklch(90.01% 0 none/.2);
--cyan-950: 192 50% 7%;
--blue-700: 227 38% 28%;
--green-300: 122 61% 72%;
--icon-swap-blur: 1.5px;
--gray-900: 228 5% 11%;
--surface-invert: 0 0% 2%;
--button-filled-hover: oklch(28.01% 0 none);
--cyan-300: 192 75% 58%;
--default-transition-timing-function: cubic-bezier(.4,0,.2,1);
--overlay: oklch(11.57% 0 none/.2);
--white: 0 0% 99%;
--tw-animation-iteration-count: 1;
--warm-gray-200: 30 3% 87%;
--tw-exit-opacity: 1;
--green-800: 133 100% 18%;
--_number-flow-d: 0;
--purple-950: 245 33% 8%;
--desktop-shell-command: lab(47.855% 12.616 83.6906);
--background: oklch(97.72% 0 none);
--tw-translate-z: 0;
--incognito-input-background-hover: oklch(94% .014 304.13);
--green-50: 118 82% 94%;
--tw-gradient-via: rgba(0, 0, 0, 0);
--green-200: 120 58% 85%;
--blue-950: 227 33% 8%;
--tw-scale-y: 1;
--green-400: 127 60% 55%;
--incognito-input-button-background-selected: oklch(88.83% .0142 304.12);
--pink-900: 324 31% 11%;
--container-6xl: 72rem;
--button-ghost-hover: oklch(11.57% 0 none/.04);
--lime-300: 62 87% 42%;
--surface-l3: 0 0% 91%;
--tw-exit-translate-x: 0;
--feather-top: 0%;
--container-3xl: 48rem;
--tw-translate-y: 0;
--ease-out-quint: cubic-bezier(.23,1,.32,1);
--red-500: 355 63% 44%;
--ease-out: cubic-bezier(0,0,.2,1);
--gray-300: 228 3% 62%;
--surface-inset: 0 0% 97%;
--blur-xs: 4px;
--purple-800: 245 31% 18%;
--neutral-400: 0 0% 52%;
--feather-inline-end: 0%;
--gray-500: 228 2% 39%;
--tw-content: "";
--warm-gray-300: 30 1% 62%;
--surface-incognito-elevated: 243 100% 96%;
--cyan-1000: 192 67% 2%;
--warm-gray-950: 30 1% 6%;
--red-300: 357 82% 71%;
--cyan-500: 192 85% 36%;
--red-600: 353 46% 33%;
--green-600: 136 100% 29%;
--warm-gray-50: 30 15% 97%;
--warm-gray-1000: 30 1% 2%;
--pink-500: 324 49% 44%;
--input-glow: oklch(90.01% 0 none/.2);
--button-filled-active: oklch(33.11% 0 none);
--tw-translate-x: 0;
--teal-600: 180 76% 19%;
--green-500: 136 100% 35%;
--purple-900: 245 33% 13%;
--neutral-150: 0 0% 91%;
--purple-100: 243 100% 96%;
--yellow-500: 47 100% 45%;
--tw-enter-rotate: 0;
--gray-800: 228 4% 14%;
--red-700: 354 42% 22%;
--gray-200: 0 0% 87%;
--button-ghost-surface-hover: oklch(11.57% 0 none/.02);
--teal-1000: 180 67% 2%;
--max-width-lg: 32rem;
--teal-100: 180 80% 92%;
--fg-tertiary: 0 0% 52%;
--fg-quaternary: 0 0% 62%;
--tw-enter-blur: 0;
--purple-600: 245 38% 38%;
--surface-incognito: 243 100% 96%;
--surface-l2-active: 0 0% 91%;
--panel-slide-dur: .3s;
--cyan-50: 192 100% 97%;
--neutral-250: 0 0% 78%;
--orange-600: 22 100% 23%;
--input-background-hover: oklch(100% 0 none);
--lime-1000: 66 60% 2%;
--yellow-900: 43 85% 19%;
--solar: 22 100% 52%;
--blue-500: 227 56% 50%;
--teal-700: 180 64% 15%;
--neutral-1000: 0 0% 2%;
--teal-200: 179 77% 80%;
--input-background: oklch(100% 0 none);
--_number-flow-dx: 0px;
--green-1000: 125 100% 6%;
--blue-800: 227 34% 18%;
--subheader-height: 48px;
--warm-gray-800: 30 1% 14%;
--lightningcss-dark: ;
--button-danger-fill-hover: hsl(355 63% 44%/8%);
--orange-800: 22 62% 13%;
--tw-animation-direction: normal;
--lime-950: 66 50% 5%;
--animate-ping: ping 1s cubic-bezier(0,0,.2,1)infinite;
--neutral-600: 0 0% 28%;
--angle: 0deg;
--surface-l2: 0 0% 95%;
--purple-50: 240 100% 98%;
--fg-warning: 45 100% 29%;
--cyan-900: 192 55% 11%;
--gray-700: 228 3% 21%;
--blur-xl: 24px;
--orange-100: 15 100% 95%;
--tw-divide-x-reverse: 0;
--purple-700: 245 33% 27%;
--pink-800: 324 32% 15%;
--icon-swap-start-scale: .6;
--input-hover: oklch(99.24% 0 none);
--surface-l4-hover: 0 0% 78%;
--orange-400: 22 85% 49%;
--fg-link: 227 56% 50%;
--thead-sticky-top: 0px;
--tw-exit-rotate: 0;
--tw-scale-z: 1;
--button-ghost-active: oklch(11.57% 0 none/.08);
--fg-electric-blue: 222 100% 55%;
--yellow-50: 48 90% 95%;
--scrollbar-thumb: oklch(0% 0 none/.15);
--yellow-100: 48 88% 88%;
--surface-l4: 0 0% 87%;
--cyan-400: 192 65% 48%;
--content-breakout-max-width: calc(44rem + 2*1.5rem);
--tw-scroll-snap-strictness: proximity;
--lime-800: 66 58% 10%;
--pink-300: 324 65% 73%;
--green-100: 120 70% 87%;
--pink-200: 324 87% 90%;
--neutral-900: 0 0% 13%;
--red-400: 356 58% 56%;
--yellow-600: 46 100% 37%;
--lime-100: 68 85% 86%;
--content-gutter: 1.5rem;
--surface-banner: 127 31% 36%;
--red-950: 354 50% 6%;
--lime-200: 65 83% 68%;
--panel-blur: 2px;
--_number-flow-d-width: 0;
--cyan-700: 192 60% 22%;
--teal-950: 180 50% 6%;
--feather-inline-start: 0%;
--yellow-1000: 43 72% 10%;
--feather-bottom: 0%;
--tw-gradient-from-position: 0%;
--teal-300: 180 67% 47%;
--surface-elevated: 0 0% 99%;
--purple-300: 245 74% 74%;
--teal-500: 180 98% 23%;
--ease-in-out: cubic-bezier(.4,0,.2,1);
--pink-700: 324 35% 24%;
--teal-900: 180 100% 8%;
--alpha-mask-bottom: 0px;
--yellow-800: 44 100% 22%;
--red-800: 354 39% 14%;
--toggle-selected: oklch(11.57% 0 none/.08);
--tw-animation-fill-mode: none;
--green-950: 129 100% 11%;
--button-danger-fill: hsl(355 63% 44%/6%);
--tw-exit-blur: 0;
--container-5xl: 64rem;
--teal-400: 180 54% 41%;
--max-width-2xl: 42rem;
--green-700: 135 100% 23%;
--red-900: 354 38% 10%;
--blur-md: 12px;
--cyan-600: 192 75% 28%;
--scrollbar-thumb-dimmed: oklch(0% 0 none/.05);
--animate-spin: spin 1s linear infinite;
--tw-enter-translate-x: 0;
--alpha-mask-top: 0px;
--container-4xl: 56rem;
--red-50: 0 100% 98%;
--lime-600: 60 100% 15%;
--input-button-background-selected: oklch(95.51% 0 none);
--cyan-200: 192 90% 82%;
--gradient: oklch(92.34% 0 none);
--fg-orange: 28 100% 49%;
--desktop-shell-args: lab(49.9902% 44.5514 38.9867);
--pink-1000: 324 67% 2%;
--lightningcss-light: ;
--blue-300: 227 85% 75%;
--teal-50: 177 80% 97%;
--tw-divide-y-reverse: 0;
--icon-swap-ease: cubic-bezier(.23, 1, .32, 1);
--orange-1000: 15 75% 2%;
--pink-400: 324 53% 58%;
--neutral-200: 0 0% 87%;
--teal-800: 181 100% 10%;
--tw-exit-scale: 1;
--pink-950: 324 33% 7%;
--orange-950: 18 50% 7%;
--warm-gray-400: 30 2% 52%;
--gray-400: 228 2% 52%;
--input: oklch(99.24% 0 none);
--warm-gray-500: 30 1% 38%;
--pink-100: 324 100% 96%;
--tw-scale-x: 1;
--tw-enter-translate-y: 0;
--orange-900: 22 64% 10%;
--cyan-100: 192 100% 93%;
--lime-500: 60 100% 21%;
--content-max-width: 44rem;
--incognito-input-button-background-hover: oklch(94% .014 304.13);
--yellow-400: 48 100% 48%;
--blur: 8px;
--surface-base: 0 0% 99%;
--neutral-950: 0 0% 8%;
--tw-enter-opacity: 1;
--warm-gray-900: 30 1% 10%;
--red-200: 0 75% 89%;
--orange-300: 19 78% 67%;
--container-7xl: 80rem;
--lime-700: 66 60% 12%;
--blur-sm: 4px;
--fg-link-hover: 227 85% 75%;
--neutral-700: 0 0% 21%;
```

### Dependencies

```css
0: --font-ibm-plex-mono;
```

### Semantic

```css
--green-900: 131 100% 13%;
--fg-positive: 180 98% 23%;
--fg-success: 136 100% 29%;
--green-300: 122 61% 72%;
--green-800: 133 100% 18%;
--green-50: 118 82% 94%;
--green-200: 120 58% 85%;
--green-400: 127 60% 55%;
--green-600: 136 100% 29%;
--green-500: 136 100% 35%;
--green-1000: 125 100% 6%;
--green-100: 120 70% 87%;
--green-950: 129 100% 11%;
--green-700: 135 100% 23%;
--bg-warning: hsl(47 100% 45%/.08);
--yellow-950: 43 80% 15%;
--yellow-200: 48 95% 77%;
--yellow-700: 45 100% 29%;
--yellow-300: 48 98% 62%;
--yellow-500: 47 100% 45%;
--yellow-900: 43 85% 19%;
--fg-warning: 45 100% 29%;
--yellow-50: 48 90% 95%;
--yellow-100: 48 88% 88%;
--yellow-600: 46 100% 37%;
--yellow-1000: 43 72% 10%;
--yellow-800: 44 100% 22%;
--yellow-400: 48 100% 48%;
--fg-danger: 355 63% 44%;
--button-danger-fill-active: hsl(355 63% 44%/10%);
--red-100: 0 100% 96%;
--red-1000: 0 75% 2%;
--red-500: 355 63% 44%;
--red-300: 357 82% 71%;
--red-600: 353 46% 33%;
--red-700: 354 42% 22%;
--destructive: 0 84.2% 60.2%;
--button-danger-fill-hover: hsl(355 63% 44%/8%);
--color-red-400: hsl(356 58% 56%);
--red-400: 356 58% 56%;
--destructive-foreground: 0 0% 98%;
--red-950: 354 50% 6%;
--red-800: 354 39% 14%;
--button-danger-fill: hsl(355 63% 44%/6%);
--red-900: 354 38% 10%;
--red-50: 0 100% 98%;
--red-200: 0 75% 89%;
--blue-400: 227 72% 65%;
--blue-100: 225 100% 96%;
--blue-600: 227 44% 38%;
--blue-900: 227 35% 14%;
--blue-200: 225 84% 90%;
--color-blue-400: hsl(227 72% 65%);
--blue-50: 225 100% 98%;
--blue-1000: 227 60% 2%;
--blue-700: 227 38% 28%;
--blue-950: 227 33% 8%;
--bg-electric-blue: hsl(222 100% 55%/10%);
--blue-500: 227 56% 50%;
--blue-800: 227 34% 18%;
--fg-electric-blue: 222 100% 55%;
--blue-300: 227 85% 75%;
```

## Breakpoints

| Name | Value | Type |
|------|-------|------|
| 400px | 400px | min-width |
| sm | 425px | max-width |
| sm | 426px | min-width |
| sm | 500px | max-width |
| sm | 530px | max-width |
| 550px | 550px | max-width |
| sm | 600px | max-width |
| sm | 640px | max-width |
| md | 768px | min-width |
| 896px | 896px | max-width |

## Transitions & Animations

**Easing functions:** `cubic-bezier(0.4, 0, 0.2, 1)`, `cubic-bezier(0.23, 1, 0.32, 1)`, `ease`

**Durations:** `0.15s`, `0.1s`, `0.5s`, `0.3s`, `0s`, `0.25s`, `0.2s`

### Common Transitions

```css
transition: all;
transition: opacity 0.15s cubic-bezier(0.4, 0, 0.2, 1);
transition: color 0.1s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.1s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.1s cubic-bezier(0.4, 0, 0.2, 1), outline-color 0.1s cubic-bezier(0.4, 0, 0.2, 1), text-decoration-color 0.1s cubic-bezier(0.4, 0, 0.2, 1), fill 0.1s cubic-bezier(0.4, 0, 0.2, 1), stroke 0.1s cubic-bezier(0.4, 0, 0.2, 1), --tw-gradient-from 0.1s cubic-bezier(0.4, 0, 0.2, 1), --tw-gradient-via 0.1s cubic-bezier(0.4, 0, 0.2, 1), --tw-gradient-to 0.1s cubic-bezier(0.4, 0, 0.2, 1);
transition: opacity 0.5s cubic-bezier(0.23, 1, 0.32, 1);
transition: width 0.3s cubic-bezier(0.23, 1, 0.32, 1), visibility 0s 0.3s, height 0s 0.3s;
transition: 0.25s ease-out;
transition: 0.2s ease-in;
transition: 0.1s;
transition: 0.2s;
transition: color 0.15s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.15s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.15s cubic-bezier(0.4, 0, 0.2, 1), outline-color 0.15s cubic-bezier(0.4, 0, 0.2, 1), text-decoration-color 0.15s cubic-bezier(0.4, 0, 0.2, 1), fill 0.15s cubic-bezier(0.4, 0, 0.2, 1), stroke 0.15s cubic-bezier(0.4, 0, 0.2, 1), --tw-gradient-from 0.15s cubic-bezier(0.4, 0, 0.2, 1), --tw-gradient-via 0.15s cubic-bezier(0.4, 0, 0.2, 1), --tw-gradient-to 0.15s cubic-bezier(0.4, 0, 0.2, 1);
```

### Keyframe Animations

**swipe-out-left**
```css
@keyframes swipe-out-left {
  0% { transform: var(--y) translateX(var(--swipe-amount-x)); opacity: 1; }
  100% { transform: var(--y) translateX(calc(var(--swipe-amount-x) - 100%)); opacity: 0; }
}
```

**swipe-out-right**
```css
@keyframes swipe-out-right {
  0% { transform: var(--y) translateX(var(--swipe-amount-x)); opacity: 1; }
  100% { transform: var(--y) translateX(calc(var(--swipe-amount-x) + 100%)); opacity: 0; }
}
```

**swipe-out-up**
```css
@keyframes swipe-out-up {
  0% { transform: var(--y) translateY(var(--swipe-amount-y)); opacity: 1; }
  100% { transform: var(--y) translateY(calc(var(--swipe-amount-y) - 100%)); opacity: 0; }
}
```

**swipe-out-down**
```css
@keyframes swipe-out-down {
  0% { transform: var(--y) translateY(var(--swipe-amount-y)); opacity: 1; }
  100% { transform: var(--y) translateY(calc(var(--swipe-amount-y) + 100%)); opacity: 0; }
}
```

**sonner-fade-in**
```css
@keyframes sonner-fade-in {
  0% { opacity: 0; transform: scale(0.8); }
  100% { opacity: 1; transform: scale(1); }
}
```

**sonner-fade-out**
```css
@keyframes sonner-fade-out {
  0% { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: scale(0.8); }
}
```

**sonner-spin**
```css
@keyframes sonner-spin {
  0% { opacity: 1; }
  100% { opacity: 0.15; }
}
```

**fadeIn**
```css
@keyframes fadeIn {
  0% { opacity: 0; }
  100% { opacity: 1; }
}
```

**fadeOut**
```css
@keyframes fadeOut {
  100% { opacity: 0; }
}
```

**slideFromBottom**
```css
@keyframes slideFromBottom {
  0% { transform: translate3d(0,var(--initial-transform,100%),0); }
  100% { transform: translate3d(0px, 0px, 0px); }
}
```

## Component Patterns

Detected UI component patterns and their most common styles:

### Buttons (30 instances)

```css
.buttons {
  background-color: rgb(38, 38, 38);
  color: rgb(85, 85, 85);
  font-size: 14.4px;
  font-weight: 700;
  padding-top: 12px;
  padding-right: 30px;
  border-radius: 2px;
}
```

### Cards (6 instances)

```css
.cards {
  background-color: rgb(0, 0, 0);
  border-radius: 2.5px;
  box-shadow: rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(56, 87, 199, 0.5) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px;
  padding-top: 0px;
  padding-right: 0px;
}
```

### Inputs (11 instances)

```css
.inputs {
  background-color: rgb(255, 255, 255);
  color: rgb(5, 5, 5);
  border-color: rgb(5, 5, 5);
  border-radius: 0px;
  font-size: 16px;
  padding-top: 0px;
  padding-right: 0px;
}
```

### Links (13 instances)

```css
.links {
  color: rgb(5, 5, 5);
  font-size: 14px;
  font-weight: 500;
}
```

### Navigation (9 instances)

```css
.navigation {
  color: rgb(5, 5, 5);
  padding-top: 0px;
  padding-bottom: 0px;
  padding-left: 0px;
  padding-right: 0px;
  position: static;
}
```

### Footer (2 instances)

```css
.footer {
  background-color: rgb(244, 244, 244);
  color: rgb(5, 5, 5);
  padding-top: 0px;
  padding-bottom: 0px;
  font-size: 16px;
}
```

### Modals (3 instances)

```css
.modals {
  background-color: oklch(0.9772 0 none);
  border-radius: 0px;
  box-shadow: rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0.1) 0px 0px 30px -5px, rgba(0, 0, 0, 0.1) 0px 0px 6px -4px;
  padding-top: 0px;
  padding-right: 0px;
  max-width: 100%;
}
```

### Accordions (4 instances)

```css
.accordions {
  color: rgb(5, 5, 5);
  font-size: 16px;
  padding-top: 0px;
  padding-right: 0px;
  border-color: rgb(5, 5, 5) rgb(216, 216, 216) rgb(216, 216, 216);
}
```

### Switches (9 instances)

```css
.switches {
  background-color: rgb(118, 118, 118);
  border-radius: 0px;
  border-color: rgb(5, 5, 5);
}
```

## Component Clusters

Reusable component instances grouped by DOM structure and style similarity:

### Button — 1 instance, 1 variant

**Variant 1** (1 instance)

```css
  background: rgba(0, 0, 0, 0);
  color: rgb(5, 5, 5);
  padding: 8px 16px 8px 16px;
  border-radius: 9999px;
  border: 1px solid rgba(0, 0, 0, 0);
  font-size: 14px;
  font-weight: 500;
```

### Button — 1 instance, 1 variant

**Variant 1** (1 instance)

```css
  background: rgba(0, 0, 0, 0);
  color: rgb(99, 99, 99);
  padding: 8px 8px 8px 8px;
  border-radius: 9999px;
  border: 1px solid rgba(0, 0, 0, 0);
  font-size: 14px;
  font-weight: 500;
```

### Button — 2 instances, 1 variant

**Variant 1** (2 instances)

```css
  background: rgba(0, 0, 0, 0);
  color: rgb(5, 5, 5);
  padding: 8px 16px 8px 16px;
  border-radius: 9999px;
  border: 1px solid rgba(15, 13, 10, 0.08);
  font-size: 14px;
  font-weight: 500;
```

### Input — 2 instances, 1 variant

**Variant 1** (2 instances)

```css
  background: rgba(0, 0, 0, 0);
  color: rgb(5, 5, 5);
  padding: 14px 8px 0px 8px;
  border-radius: 0px;
  border: 0px solid rgba(15, 13, 10, 0.04);
  font-size: 16px;
  font-weight: 400;
```

### Button — 1 instance, 1 variant

**Variant 1** (1 instance)

```css
  background: rgba(0, 0, 0, 0);
  color: rgb(99, 99, 99);
  padding: 8px 8px 8px 8px;
  border-radius: 9999px;
  border: 1px solid rgba(0, 0, 0, 0);
  font-size: 14px;
  font-weight: 500;
```

### Button — 1 instance, 1 variant

**Variant 1** (1 instance)

```css
  background: rgba(0, 0, 0, 0);
  color: rgb(133, 133, 133);
  padding: 8px 8px 8px 16px;
  border-radius: 9999px;
  border: 1px solid rgba(0, 0, 0, 0);
  font-size: 14px;
  font-weight: 500;
```

### Button — 1 instance, 1 variant

**Variant 1** (1 instance)

```css
  background: rgba(0, 0, 0, 0);
  color: rgb(5, 5, 5);
  padding: 0px 0px 0px 0px;
  border-radius: 9999px;
  border: 0px solid rgba(15, 13, 10, 0.04);
  font-size: 15px;
  font-weight: 400;
```

### Button — 1 instance, 1 variant

**Variant 1** (1 instance)

```css
  background: rgb(8, 144, 255);
  color: rgb(252, 252, 252);
  padding: 0px 0px 0px 0px;
  border-radius: 9999px;
  border: 0px solid rgba(15, 13, 10, 0.04);
  font-size: 15px;
  font-weight: 400;
```

### Button — 4 instances, 2 variants

**Variant 1** (1 instance)

```css
  background: rgba(0, 0, 0, 0);
  color: rgb(5, 5, 5);
  padding: 0px 0px 0px 0px;
  border-radius: 0px;
  border: 0px solid rgba(15, 13, 10, 0.04);
  font-size: 13px;
  font-weight: 400;
```

**Variant 2** (3 instances)

```css
  background: rgba(0, 0, 0, 0);
  color: rgb(5, 5, 5);
  padding: 4px 12px 4px 12px;
  border-radius: 9999px;
  border: 0px solid rgba(15, 13, 10, 0.04);
  font-size: 14px;
  font-weight: 500;
```

### Button — 1 instance, 1 variant

**Variant 1** (1 instance)

```css
  background: rgba(0, 0, 0, 0);
  color: oklab(0.115679 0.00000526756 0.00000231713 / 0.45);
  padding: 0px 0px 0px 0px;
  border-radius: 4px;
  border: 0px solid rgba(15, 13, 10, 0.04);
  font-size: 15px;
  font-weight: 400;
```

## Layout System

**0 grid containers** and **52 flex containers** detected.

### The System

- **Content column** — 752px wide
- **Section rhythm** — 16px vertical padding (ladder: 16px · 150px)
- **Gap scale** — 2px · 4px · 6px · 8px · 12px · 16px · 20px · 28px

### Container Widths

| Max Width | Padding |
|-----------|---------|
| 100% | 0px |

### Flex Patterns

| Direction/Wrap | Count |
|----------------|-------|
| column/nowrap | 13x |
| row/nowrap | 37x |
| row/wrap | 2x |

**Gap values:** `normal 6px`, `2px`, `4px`, `6px`, `8px`, `12px`, `16px`, `20px`, `28px`, `36px`

## Accessibility (WCAG 2.1)

**Overall Score: 100%** — 9 passing, 0 failing color pairs

### Passing Color Pairs

| Foreground | Background | Ratio | Level |
|------------|------------|-------|-------|
| `#ffffff` | `#262626` | 15.13:1 | AAA |
| `#000000` | `#eeeeee` | 18.1:1 | AAA |
| `#050505` | `#ffffff` | 20.38:1 | AAA |
| `#eeeeee` | `#000000` | 18.1:1 | AAA |

## Design System Score

**Overall: 89/100 (Grade: B)**

| Category | Score |
|----------|-------|
| Color Discipline | 92/100 |
| Typography Consistency | 90/100 |
| Spacing System | 85/100 |
| Shadow Consistency | 90/100 |
| Border Radius Consistency | 80/100 |
| Accessibility | 100/100 |
| CSS Tokenization | 100/100 |

**Strengths:** Tight, disciplined color palette, Consistent typography system, Well-defined spacing scale, Clean elevation system, Strong accessibility compliance, Good CSS variable tokenization

**Issues:**
- 197 !important rules — prefer specificity over overrides
- 6245 duplicate CSS declarations

## Gradients

**2 unique gradients** detected.

| Type | Direction | Stops | Classification |
|------|-----------|-------|----------------|
| linear | — | 4 | bold |
| linear | 90deg | 9 | complex |

```css
background: linear-gradient(in oklab, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0) 25%, rgba(0, 0, 0, 0) 100%);
background: linear-gradient(90deg, rgba(5, 5, 5, 0.25) 0%, rgba(5, 5, 5, 0.25) 35%, rgb(99, 102, 241) 40%, rgb(168, 85, 247) 45%, rgb(236, 72, 153) 50%, rgb(249, 115, 22) 55%, rgb(234, 179, 8) 60%, rgba(5, 5, 5, 0.25) 65%, rgba(5, 5, 5, 0.25) 100%);
```

## Z-Index Map

**12 unique z-index values** across 3 layers.

| Layer | Range | Elements |
|-------|-------|----------|
| modal | 9999,2147483647 | div, a.f.i.x.e.d. .t.o.p.-.3. .z.-.[.1.0.0.0.0.]. .-.t.r.a.n.s.l.a.t.e.-.y.-.[.c.a.l.c.(.1.0.0.%.+.2.r.e.m.).]. .s.t.a.r.t.-.[.c.a.l.c.(.a.n.c.h.o.r.(.-.-.g.r.o.k.-.c.o.n.t.e.n.t.-.a.r.e.a._.s.t.a.r.t.).+.0...7.5.r.e.m.).]. .r.o.u.n.d.e.d.-.m.d. .b.g.-.s.u.r.f.a.c.e.-.e.l.e.v.a.t.e.d. .p.x.-.2. .p.y.-.1. .t.e.x.t.-.s.m. .f.o.n.t.-.n.o.r.m.a.l. .s.h.a.d.o.w.-.e.l.e.v.a.t.e.d. .o.u.t.l.i.n.e.-.n.o.n.e. .r.i.n.g.-.1. .r.i.n.g.-.i.n.s.e.t. .r.i.n.g.-.b.o.r.d.e.r.-.l.1. .f.o.c.u.s.:.t.r.a.n.s.l.a.t.e.-.y.-.0, div.o.t.F.l.o.a.t.i.n.g.R.o.u.n.d.e.d. .o.t.-.b.o.t.t.o.m.-.r.i.g.h.t. .o.t.-.w.o.-.t.i.t.l.e. .v.e.r.t.i.c.a.l.-.a.l.i.g.n.-.c.o.n.t.e.n.t. .o.t.-.f.a.d.e.-.i.n |
| sticky | 10,25 | div.a.b.s.o.l.u.t.e. .i.n.s.e.t.-.x.-.0. .t.o.p.-.0. .z.-.1.0. .f.l.e.x. .h.-.1.4. .i.t.e.m.s.-.c.e.n.t.e.r. .j.u.s.t.i.f.y.-.b.e.t.w.e.e.n. .g.a.p.-.2. .p.x.-.3. .@.[.8.0.r.e.m.]./.n.a.v.:.h.-.0. .@.[.8.0.r.e.m.]./.n.a.v.:.t.o.p.-.7. .p.o.i.n.t.e.r.-.e.v.e.n.t.s.-.n.o.n.e, form.w.-.f.u.l.l. .t.e.x.t.-.b.a.s.e. .f.l.e.x. .f.l.e.x.-.c.o.l. .g.a.p.-.2. .i.t.e.m.s.-.c.e.n.t.e.r. .j.u.s.t.i.f.y.-.c.e.n.t.e.r. .r.e.l.a.t.i.v.e. .z.-.1.0. .m.t.-.0, div.r.e.l.a.t.i.v.e. .z.-.1.0. .p.s.-.2...5. .p.e.-.3...5 |
| base | -1000,3 | textarea, div.a.b.s.o.l.u.t.e. .i.n.s.e.t.-.0. .-.z.-.1.0. .b.g.-.g.r.a.d.i.e.n.t.-.t.o.-.b. .t.r.a.n.s.i.t.i.o.n.-.o.p.a.c.i.t.y. .d.u.r.a.t.i.o.n.-.1.5.0. .f.r.o.m.-.s.u.r.f.a.c.e.-.b.a.s.e. .v.i.a.-.s.u.r.f.a.c.e.-.b.a.s.e. .v.i.a.-.9.0.%. .@.[.7.0.r.e.m.]./.n.a.v.:.v.i.a.-.2.5.%. .@.[.7.0.r.e.m.]./.n.a.v.:.t.o.-.s.u.r.f.a.c.e.-.b.a.s.e./.0.%. .@.[.8.0.r.e.m.]./.n.a.v.:.f.r.o.m.-.t.r.a.n.s.p.a.r.e.n.t. .@.[.8.0.r.e.m.]./.n.a.v.:.v.i.a.-.t.r.a.n.s.p.a.r.e.n.t, button.o.t.-.c.l.o.s.e.-.i.c.o.n |

**Issues:**
- Very high z-index values: 10000, 2147483645, 2147483646, 2147483647

## SVG Icons

**11 unique SVG icons** detected. Dominant style: **filled**.

| Size Class | Count |
|------------|-------|
| xs | 1 |
| sm | 1 |
| md | 4 |
| xl | 5 |

**Icon colors:** `currentColor`, `#ffffff`, `rgb(255,255,255)`, `rgb(0, 0, 0)`, `#1d9bf008`

## Motion Language

**Feel:** mixed · **Scroll-linked:** yes

### Duration Tokens

| name | value | ms |
|---|---|---|
| `xs` | `100ms` | 100 |
| `sm` | `200ms` | 200 |
| `md` | `300ms` | 300 |
| `lg` | `500ms` | 500 |

### Easing Families

- **custom** (12 uses) — `cubic-bezier(0.4, 0, 0.2, 1)`
- **ease-out** (2 uses) — `cubic-bezier(0.23, 1, 0.32, 1)`
- **ease-in-out** (7 uses) — `ease`

### Keyframes In Use

| name | kind | properties | uses |
|---|---|---|---|
| `onetrust-fade-in` | fade | opacity | 3 |

## Component Anatomy

### button — 13 instances

**Slots:** label, icon
**Variants:** outline · primary
**Sizes:** sm

| variant | count | sample label |
|---|---|---|
| outline | 10 | Imagine |
| primary | 2 | Your privacy choices |
| default | 1 |  |

### input — 2 instances

**Variants:** outline

| variant | count | sample label |
|---|---|---|
| outline | 1 |  |
| default | 1 |  |

## Brand Voice

**Tone:** friendly · **Pronoun:** we→you · **Headings:** Sentence case (tight)

### Top CTA Verbs

- **sign** (2)
- **imagine** (1)
- **fast** (1)
- **your** (1)
- **close** (1)
- **cookies** (1)
- **reject** (1)
- **accept** (1)

### Button Copy Patterns

- "imagine" (1×)
- "sign in" (1×)
- "sign up" (1×)
- "fast" (1×)
- "your privacy choices" (1×)
- "close" (1×)
- "cookies settings" (1×)
- "reject all" (1×)
- "accept all cookies" (1×)

### Sample Headings

> What should we explore?
>  Manage Consent Preferences
> Cookie List

## Page Intent

**Type:** `landing` (confidence 0.29)
**Description:** Grok is an AI assistant built by SpaceXAI. Chat, create images, write code, and get real-time answers from the web and X.

Alternates: legal (0.4), blog-post (0.35)

## Section Roles

Reading order (top→bottom): hero → content → content → content → content → content

| # | Role | Heading | Confidence |
|---|------|---------|------------|
| 0 | hero | What should we explore? | 0.85 |
| 1 | content | — | 0.3 |
| 2 | content |  Manage Consent Preferences | 0.3 |
| 3 | content | Cookie List | 0.3 |
| 4 | content | — | 0.3 |
| 5 | content | — | 0.3 |

## Material Language

**Label:** `flat` (confidence 0)

| Metric | Value |
|--------|-------|
| Avg saturation | 0.194 |
| Shadow profile | soft |
| Avg shadow blur | 0px |
| Max radius | 9999px |
| backdrop-filter in use | no |
| Gradients | 2 |

## Component Library

**Detected:** `shadcn/ui` (confidence 0.65)

Evidence:
- shadcn css tokens

Also considered: tailwindcss (0.3)

## Component Screenshots

8 retina crops written to `screenshots/`. Index: `*-screenshots.json`.

| Cluster | Variant | Size (px) | File |
|---------|---------|-----------|------|
| button--outline--sm | 0 | 114 × 40 | `screenshots/button-outline-sm-0.png` |
| button--outline--sm | 1 | 40 × 40 | `screenshots/button-outline-sm-1.png` |
| button--outline--sm | 2 | 77 × 40 | `screenshots/button-outline-sm-2.png` |
| input--outline | 0 | 726 × 42 | `screenshots/input-outline-0.png` |
| button--outline | 0 | 40 × 40 | `screenshots/button-outline-0.png` |
| button--default | 0 | 40 × 40 | `screenshots/button-default-0.png` |
| button--primary | 0 | 126 × 20 | `screenshots/button-primary-0.png` |
| button--primary--sm | 0 | 24 × 24 | `screenshots/button-primary-sm-0.png` |

Full-page: `screenshots/full-page.png`

## Quick Start

To recreate this design in a new project:

1. **Install fonts:** Add `universalSans` from Google Fonts or your font provider
2. **Import CSS variables:** Copy `variables.css` into your project
3. **Tailwind users:** Use the generated `tailwind.config.js` to extend your theme
4. **Design tokens:** Import `design-tokens.json` for tooling integration
