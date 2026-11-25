// PM2 process definition for the VeriDoc web app on the server.
// Start or reload with:  pm2 startOrReload ecosystem.config.js --update-env
// Settings (port, keys, chain RPC...) come from veridoc/.env, which is never committed.
module.exports = {
  apps: [
    {
      name: "veridoc",
      cwd: __dirname,
      script: "server/index.js",
      env: { NODE_ENV: "production" },
      max_memory_restart: "400M",
      time: true, // timestamps in `pm2 logs`
    },
  ],
};
