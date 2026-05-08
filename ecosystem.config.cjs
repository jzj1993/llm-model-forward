module.exports = {
  apps: [
    {
      name: "llm-model-forward",
      script: "src/server.js",
      args: "--config config.json",
      interpreter: "node",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "256M",
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
