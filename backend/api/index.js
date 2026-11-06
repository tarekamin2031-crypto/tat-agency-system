// Vercel serverless entry: every /api/* request is handled by the same Express app used on Docker.
module.exports = require("../src/app");
