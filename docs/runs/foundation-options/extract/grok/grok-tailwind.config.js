/** @type {import('tailwindcss').Config} */
export default {
  theme: {
    extend: {
    colors: {
        primary: {
            '50': 'hsl(207, 100%, 97%)',
            '100': 'hsl(207, 100%, 94%)',
            '200': 'hsl(207, 100%, 86%)',
            '300': 'hsl(207, 100%, 76%)',
            '400': 'hsl(207, 100%, 64%)',
            '500': 'hsl(207, 100%, 50%)',
            '600': 'hsl(207, 100%, 40%)',
            '700': 'hsl(207, 100%, 32%)',
            '800': 'hsl(207, 100%, 24%)',
            '900': 'hsl(207, 100%, 16%)',
            '950': 'hsl(207, 100%, 10%)',
            DEFAULT: '#0890ff'
        },
        secondary: {
            '50': 'hsl(222, 54%, 97%)',
            '100': 'hsl(222, 54%, 94%)',
            '200': 'hsl(222, 54%, 86%)',
            '300': 'hsl(222, 54%, 76%)',
            '400': 'hsl(222, 54%, 64%)',
            '500': 'hsl(222, 54%, 50%)',
            '600': 'hsl(222, 54%, 40%)',
            '700': 'hsl(222, 54%, 32%)',
            '800': 'hsl(222, 54%, 24%)',
            '900': 'hsl(222, 54%, 16%)',
            '950': 'hsl(222, 54%, 10%)',
            DEFAULT: '#3860be'
        },
        accent: {
            '50': 'hsl(206, 40%, 97%)',
            '100': 'hsl(206, 40%, 94%)',
            '200': 'hsl(206, 40%, 86%)',
            '300': 'hsl(206, 40%, 76%)',
            '400': 'hsl(206, 40%, 64%)',
            '500': 'hsl(206, 40%, 50%)',
            '600': 'hsl(206, 40%, 40%)',
            '700': 'hsl(206, 40%, 32%)',
            '800': 'hsl(206, 40%, 24%)',
            '900': 'hsl(206, 40%, 16%)',
            '950': 'hsl(206, 40%, 10%)',
            DEFAULT: '#27455c'
        },
        'neutral-50': '#050505',
        'neutral-100': '#0f0d0a',
        'neutral-200': '#ffffff',
        'neutral-300': '#555555',
        'neutral-400': '#636363',
        'neutral-500': '#262626',
        'neutral-600': '#858585',
        'neutral-700': '#eeeeee',
        'neutral-800': '#dddddd',
        'neutral-900': '#ababab',
        background: '#f9f8f7',
        foreground: '#000000'
    },
    fontFamily: {
        sans: [
            'universalSans',
            'sans-serif'
        ]
    },
    fontSize: {
        '12': [
            '12px',
            {
                lineHeight: 'normal'
            }
        ],
        '13': [
            '13px',
            {
                lineHeight: '19.5px'
            }
        ],
        '14': [
            '14px',
            {
                lineHeight: '21px'
            }
        ],
        '15': [
            '15px',
            {
                lineHeight: '22.5px'
            }
        ],
        '16': [
            '16px',
            {
                lineHeight: '24px'
            }
        ],
        '24': [
            '24px',
            {
                lineHeight: '32.4px',
                letterSpacing: '-0.48px'
            }
        ],
        '14.4': [
            '14.4px',
            {
                lineHeight: '38px',
                letterSpacing: '0.144px'
            }
        ],
        '13.6': [
            '13.6px',
            {
                lineHeight: '27.2px'
            }
        ],
        '13.008': [
            '13.008px',
            {
                lineHeight: '19.512px'
            }
        ],
        '12.992': [
            '12.992px',
            {
                lineHeight: '19.488px'
            }
        ],
        '12.8': [
            '12.8px',
            {
                lineHeight: 'normal'
            }
        ]
    },
    spacing: {
        '5': '10px',
        '10': '20px',
        '14': '28px',
        '15': '30px',
        '20': '40px',
        '29': '58px',
        '75': '150px',
        '1px': '1px',
        '23px': '23px',
        '25px': '25px',
        '35px': '35px'
    },
    borderRadius: {
        xs: '1px',
        sm: '4px',
        md: '8px',
        lg: '16px',
        xl: '24px',
        full: '9999px'
    },
    boxShadow: {
        xs: 'rgb(199, 197, 199) -3px -3px 5px -2px',
        sm: 'rgba(0, 0, 0, 0.2) 0px 0px 18px 0px',
        md: 'rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0.1) 0px 0px 30px -5px, rgba(0, 0, 0, 0.1) 0px 0px 6px -4px'
    },
    screens: {
        '400px': '400px',
        sm: '426px',
        md: '768px'
    },
    transitionDuration: {
        '0': '0s',
        '100': '0.1s',
        '150': '0.15s',
        '200': '0.2s',
        '250': '0.25s',
        '300': '0.3s',
        '500': '0.5s'
    },
    transitionTimingFunction: {
        custom: 'cubic-bezier(0.23, 1, 0.32, 1)',
        default: 'ease'
    },
    container: {
        center: true,
        padding: '0px'
    },
    maxWidth: {
        container: '100%'
    }
},
  },
};
