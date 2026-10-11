// React Theme — extracted from https://grok.com
// Compatible with: Chakra UI, Stitches, Vanilla Extract, or any CSS-in-JS

/**
 * TypeScript type definition for this theme:
 *
 * interface Theme {
 *   colors: {
    primary: string;
    secondary: string;
    accent: string;
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
    neutral800: string;
    neutral900: string;
 *   };
 *   fonts: {
    body: string;
 *   };
 *   fontSizes: {
    '12': string;
    '13': string;
    '14': string;
    '15': string;
    '16': string;
    '24': string;
    '14.4': string;
    '13.6': string;
    '13.008': string;
    '12.992': string;
    '12.8': string;
 *   };
 *   space: {
    '1': string;
    '10': string;
    '20': string;
    '23': string;
    '25': string;
    '28': string;
    '30': string;
    '35': string;
    '40': string;
    '58': string;
    '150': string;
 *   };
 *   radii: {
    xs: string;
    sm: string;
    md: string;
    lg: string;
    xl: string;
    full: string;
 *   };
 *   shadows: {
    none: string;
    md: string;
    lg: string;
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
    "primary": "#0890ff",
    "secondary": "#3860be",
    "accent": "#27455c",
    "background": "#f9f8f7",
    "foreground": "#000000",
    "neutral50": "#050505",
    "neutral100": "#0f0d0a",
    "neutral200": "#ffffff",
    "neutral300": "#555555",
    "neutral400": "#636363",
    "neutral500": "#262626",
    "neutral600": "#858585",
    "neutral700": "#eeeeee",
    "neutral800": "#dddddd",
    "neutral900": "#ababab"
  },
  "fonts": {
    "body": "'universalSans', sans-serif"
  },
  "fontSizes": {
    "12": "12px",
    "13": "13px",
    "14": "14px",
    "15": "15px",
    "16": "16px",
    "24": "24px",
    "14.4": "14.4px",
    "13.6": "13.6px",
    "13.008": "13.008px",
    "12.992": "12.992px",
    "12.8": "12.8px"
  },
  "space": {
    "1": "1px",
    "10": "10px",
    "20": "20px",
    "23": "23px",
    "25": "25px",
    "28": "28px",
    "30": "30px",
    "35": "35px",
    "40": "40px",
    "58": "58px",
    "150": "150px"
  },
  "radii": {
    "xs": "1px",
    "sm": "4px",
    "md": "8px",
    "lg": "16px",
    "xl": "24px",
    "full": "9999px"
  },
  "shadows": {
    "none": "rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, oklab(0.115679 0.00000526756 0.00000231713 / 0.15) 0px 0px 0px 1px, rgba(0, 0, 0, 0) 0px 0px 0px 0px",
    "md": "rgb(199, 197, 199) 0px 0px 12px 2px",
    "lg": "rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0.1) 0px 0px 30px -5px, rgba(0, 0, 0, 0.1) 0px 0px 6px -4px"
  },
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
      "main": "#0890ff",
      "light": "hsl(207, 100%, 67%)",
      "dark": "hsl(207, 100%, 37%)"
    },
    "secondary": {
      "main": "#3860be",
      "light": "hsl(222, 54%, 63%)",
      "dark": "hsl(222, 54%, 33%)"
    },
    "background": {
      "default": "#f9f8f7",
      "paper": "#ffffff"
    },
    "text": {
      "primary": "#000000",
      "secondary": "#050505"
    }
  },
  "typography": {
    "fontFamily": "'universalSans', sans-serif",
    "h2": {
      "fontSize": "24px",
      "fontWeight": "550",
      "lineHeight": "32.4px"
    },
    "body1": {
      "fontSize": "16px",
      "fontWeight": "400",
      "lineHeight": "24px"
    },
    "body2": {
      "fontSize": "13.6px",
      "fontWeight": "400",
      "lineHeight": "27.2px"
    }
  },
  "shape": {
    "borderRadius": 8
  },
  "shadows": [
    "rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(56, 87, 199, 0.5) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px",
    "rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(56, 87, 199, 0.5) 0px 0px 0px 0px inset, rgba(0, 0, 0, 0) 0px 0px 0px 0px",
    "rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, oklab(0.115679 0.00000526756 0.00000231713 / 0.15) 0px 0px 0px 1px, rgba(0, 0, 0, 0) 0px 0px 0px 0px",
    "rgb(199, 197, 199) -3px -3px 5px -2px",
    "rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(15, 13, 10, 0.04) 0px 0px 0px 1px inset, rgba(0, 0, 0, 0.04) 0px 2px 8px 0px"
  ]
};

export default theme;
