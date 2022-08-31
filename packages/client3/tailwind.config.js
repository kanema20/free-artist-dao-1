/* eslint-disable @typescript-eslint/no-var-requires */
const colors = require("tailwindcss/colors");
const defaultTheme = require("tailwindcss/defaultTheme");

module.exports = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./stories/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    colors: {
      sand: {
        50: "#FAFAF9",
        100: "#F5F5F4",
        200: "#E7E5E4",
        300: "#D6D3D1",
        400: "#A8A29E",
        500: "#78716C",
        600: "#57534E",
        700: "#44403C",
        800: "#292524",
        900: "#1C1917",
      },
      eggplant: {
        50: "#F8F5FD",
        100: "#EAE4F5",
        200: "#E0DAED",
        300: "#CDC3E1",
        400: "#A79CC1",
        500: "#776B91",
        600: "#584C72",
        700: "#45395F",
        800: "#2A1E44",
        900: "#1E1238",
      },
      clay: {
        50: "#FCF5F5",
        100: "#F5DBDA",
        200: "#ECC1BF",
        300: "#E4A7A5",
        400: "#DB8F8C",
        500: "#D17673",
        600: "#A9635E",
        700: "#824F49",
        800: "#5B3933",
        900: "#34221E",
      },
      grass: {
        50: "#F8FCF3",
        100: "#E7F1DC",
        200: "#D7E8C5",
        300: "#C7DFAD",
        400: "#B8D796",
        500: "#A8CF7E",
        600: "#79AA69",
        700: "#538653",
        800: "#3D6247",
        900: "#273D33",
      },
      sky: {
        50: "#E7F4FD",
        100: "#C0DAEE",
        200: "#9ABEDF",
        300: "#74A0D0",
        400: "#5081C1",
        500: "#3962A8",
        600: "#2B4983",
        700: "#1D325F",
        800: "#1B284C",
        900: "#0F1C3C",
      },
      transparent: "transparent",
      current: "currentColor",
      white: colors.white,
      black: colors.black,
      gray: colors.gray,
    },
    fontFamily: {
      sans: ['"Inter"', "sans-serif"],
      serif: ['"Newsreader Display"', "serif"],
    },
    screens: {
      xs: "480px",
      ...defaultTheme.screens,
    },
    extend: {
      keyframes: {
        "background-oscillate": {
          "0%": { "background-position": "0 50%" },
          "25%": { "background-position": "50 50%" },
          "50%": { "background-position": "100% 50%" },
          "75%": { "background-position": "50% 50%" },
          "100%": { "background-position": "0 50%" },
        },
        marquee: {
          "0%": { transform: "translateX(0%)" },
          "100%": { transform: "translateX(-100%)" },
        },
      },
      animation: {
        "background-oscillate-slow": "background-oscillate 4s ease-in infinite",
        marquee: "marquee 60s linear infinite",
      },
      backgroundImage: {
        "sunrise-01":
          "linear-gradient(180deg, rgba(29,50,95,1) 0%, rgba(118,95,148,1) 50%, rgba(248,224,206,1) 100%)",
        "sunrise-02":
          "linear-gradient(180deg, rgba(209, 118, 115, 0) 17.71%, #D17673 100%),linear-gradient(0deg, #1D325F, #1D325F)",
        afternoon:
          "linear-gradient(180deg, rgba(222, 248, 253, 0) 18.75%, #A9D9E3 100%),linear-gradient(0deg, #7BA3D0, #7BA3D0)",
        "sunset-01":
          "linear-gradient(180deg, rgba(231, 182, 145, 0) 19.27%, #FED9BD 100%),linear-gradient(0deg, #7BA3D0, #7BA3D0)",
        "sunset-02":
          "linear-gradient(180deg, rgba(160, 190, 223, 0) 16.67%, #FBECBD 100%),linear-gradient(0deg, #E99390, #E99390)",
      },
      spacing: {
        15: "3.75rem",
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
