/** @type {import('tailwindcss').Config} */
export default {
  theme: {
    extend: {
    colors: {
        'neutral-50': '#313131',
        'neutral-100': '#000000',
        'neutral-200': '#d9d9d9',
        foreground: '#313131'
    },
    fontSize: {
        '12': [
            '12px',
            {
                lineHeight: '18px'
            }
        ],
        '16': [
            '16px',
            {
                lineHeight: '18.4px'
            }
        ],
        '24': [
            '24px',
            {
                lineHeight: '30px'
            }
        ],
        '40': [
            '40px',
            {
                lineHeight: '50px'
            }
        ],
        '13.3333': [
            '13.3333px',
            {
                lineHeight: 'normal'
            }
        ]
    },
    spacing: {
        '0': '8px',
        '1': '128px'
    },
    borderRadius: {
        full: '50px'
    },
    container: {
        center: true,
        padding: '32px'
    },
    maxWidth: {
        container: '960px'
    }
},
  },
};
