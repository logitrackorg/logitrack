const { defineConfig } = require("cypress");

module.exports = defineConfig({
  e2e: {
    // URL de tu aplicación hosteada en AWS Amplify
    baseUrl: 'https://main.d4yjmo20ob07h.amplifyapp.com',
    viewportWidth: 1280,
    viewportHeight: 720,
    setupNodeEvents(on, config) {
      // implementar node event listeners aquí
    },
  },
});