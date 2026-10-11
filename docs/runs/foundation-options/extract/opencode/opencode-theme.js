// React Theme — extracted from https://opencode.ai
// Compatible with: Chakra UI, Stitches, Vanilla Extract, or any CSS-in-JS

/**
 * TypeScript type definition for this theme:
 *
 * interface Theme {
 *   colors: {
    primary: string;
    background: string;
    foreground: string;
    neutral50: string;
    neutral100: string;
    neutral200: string;
    neutral300: string;
    neutral400: string;
    neutral500: string;
    neutral600: string;
    neutral700: string;
 *   };
 *   fonts: {
    mono: string;
 *   };
 *   fontSizes: {
    '14': string;
    '16': string;
    '38': string;
 *   };
 *   space: {
    '1': string;
    '32': string;
    '40': string;
    '48': string;
    '64': string;
    '80': string;
    '96': string;
 *   };
 *   radii: {
    sm: string;
 *   };
 *   shadows: {

 *   };
 *   states: {
 *     hover: { opacity: number };
 *     focus: { opacity: number };
 *     active: { opacity: number };
 *     disabled: { opacity: number };
 *   };
 * }
 */

export const theme = {
  "colors": {
    "primary": "#fdfcfc",
    "background": "#ffffff",
    "foreground": "#1d1d1f",
    "neutral50": "#646262",
    "neutral100": "#201d1d",
    "neutral200": "#9a9898",
    "neutral300": "#8d8b8b",
    "neutral400": "#0f0000",
    "neutral500": "#000000",
    "neutral600": "#d0cfce",
    "neutral700": "#424245"
  },
  "fonts": {
    "mono": "'Berkeley Mono', monospace"
  },
  "fontSizes": {
    "14": "14px",
    "16": "16px",
    "38": "38px"
  },
  "space": {
    "1": "1px",
    "32": "32px",
    "40": "40px",
    "48": "48px",
    "64": "64px",
    "80": "80px",
    "96": "96px"
  },
  "radii": {
    "sm": "4px"
  },
  "shadows": {},
  "states": {
    "hover": {
      "opacity": 0.08
    },
    "focus": {
      "opacity": 0.12
    },
    "active": {
      "opacity": 0.16
    },
    "disabled": {
      "opacity": 0.38
    }
  }
};

// MUI v5 theme
export const muiTheme = {
  "palette": {
    "primary": {
      "main": "#fdfcfc",
      "light": "hsl(0, 20%, 95%)",
      "dark": "hsl(0, 20%, 84%)"
    },
    "background": {
      "default": "#ffffff",
      "paper": "#fdfcfc"
    },
    "text": {
      "primary": "#1d1d1f",
      "secondary": "#646262"
    }
  },
  "typography": {
    "h1": {
      "fontSize": "38px",
      "fontWeight": "700",
      "lineHeight": "57px"
    },
    "body1": {
      "fontSize": "16px",
      "fontWeight": "400",
      "lineHeight": "16px"
    },
    "body2": {
      "fontSize": "14px",
      "fontWeight": "400",
      "lineHeight": "28px"
    }
  },
  "shape": {
    "borderRadius": 4
  },
  "shadows": []
};

export default theme;
