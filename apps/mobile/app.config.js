// Extends app.json. Adds the Firebase config file for Android push when it exists,
// so builds without it still work (they just cannot receive notifications while closed).
const fs = require("fs");
const path = require("path");

module.exports = ({ config }) => {
  const googleServices = path.join(__dirname, "google-services.json");
  if (fs.existsSync(googleServices)) {
    config.android = { ...config.android, googleServicesFile: "./google-services.json" };
  }
  return config;
};
