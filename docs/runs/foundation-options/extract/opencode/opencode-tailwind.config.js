/** @type {import('tailwindcss').Config} */
export default {
  theme: {
    extend: {
    colors: {
        primary: {
            '50': 'hsl(0, 20%, 97%)',
            '100': 'hsl(0, 20%, 94%)',
            '200': 'hsl(0, 20%, 86%)',
            '300': 'hsl(0, 20%, 76%)',
            '400': 'hsl(0, 20%, 64%)',
            '500': 'hsl(0, 20%, 50%)',
            '600': 'hsl(0, 20%, 40%)',
            '700': 'hsl(0, 20%, 32%)',
            '800': 'hsl(0, 20%, 24%)',
            '900': 'hsl(0, 20%, 16%)',
            '950': 'hsl(0, 20%, 10%)',
            DEFAULT: '#fdfcfc'
        },
        'neutral-50': '#646262',
        'neutral-100': '#201d1d',
        'neutral-200': '#9a9898',
        'neutral-300': '#8d8b8b',
        'neutral-400': '#0f0000',
        'neutral-500': '#000000',
        'neutral-600': '#d0cfce',
        'neutral-700': '#424245',
        background: '#ffffff',
        foreground: '#1d1d1f'
    },
    fontFamily: {
        sans: [
            'Berkeley Mono',
            'sans-serif'
        ]
    },
    fontSize: {
        '14': [
            '14px',
            {
                lineHeight: '28px'
            }
        ],
        '16': [
            '16px',
            {
                lineHeight: '16px'
            }
        ],
        '38': [
            '38px',
            {
                lineHeight: '57px'
            }
        ]
    },
    spacing: {
        '8': '32px',
        '10': '40px',
        '12': '48px',
        '16': '64px',
        '20': '80px',
        '24': '96px',
        '1px': '1px'
    },
    borderRadius: {
        sm: '4px'
    },
    transitionDuration: {
        '150': '0.15s',
        '180': '0.18s'
    },
    container: {
        center: true,
        padding: '0px'
    },
    maxWidth: {
        container: '1080px'
    }
},
  },
};
