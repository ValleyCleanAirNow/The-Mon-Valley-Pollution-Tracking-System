module.exports = {
  root: true,
  env: {
    es6: true,
    node: true,
  },
  extends: [
    "eslint:recommended",
    "plugin:import/errors",
    "plugin:import/warnings",
    "plugin:import/typescript",
    "google",
    "plugin:@typescript-eslint/recommended",
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: ["tsconfig.json", "tsconfig.dev.json"],
    sourceType: "module",
  },
  ignorePatterns: [
    "/lib/**/*", // Ignore built files.
    "/generated/**/*", // Ignore generated files.
  ],
  plugins: [
    "@typescript-eslint",
    "import",
  ],
  rules: {
    "quotes": "off",
    "import/no-unresolved": 0,
    "indent": "off",
    "object-curly-spacing": "off",
    "comma-dangle": "off",
    "no-trailing-spaces": "off",
    "eol-last": "off",
    "padded-blocks": "off",
    "arrow-parens": "off",
    "max-len": "off",
    "require-jsdoc": "off",
    "camelcase": "off",
    "@typescript-eslint/no-explicit-any": "off",
  },
  overrides: [
    {
      files: ["test/**/*.ts"],
      rules: {
        "@typescript-eslint/no-var-requires": "off",
      },
    },
  ],
};
