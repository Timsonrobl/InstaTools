module.exports = {
  env: {
    browser: true,
    es2021: true,
  },
  extends: ["airbnb-base", "prettier"],
  parserOptions: {
    ecmaVersion: 12,
    sourceType: "module",
  },
  rules: {
    quotes: ["error", "double", { avoidEscape: true }],
    // "no-console": "off",
    "prefer-destructuring": "off",
    "no-param-reassign": ["error", { props: false }],
    "no-await-in-loop": "off",
    "no-constant-condition": ["error", { checkLoops: false }],
  },
};
