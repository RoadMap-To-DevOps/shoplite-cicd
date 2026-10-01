const http = require('node:http');
const { createHandler } = require('./src/app');

const port = Number(process.env.PORT) || 8080;
const server = http.createServer(createHandler());

server.listen(port, () => {
  console.log(`webapp listening on port ${port}`);
});

// systemd sends SIGTERM on `systemctl restart` - finish in-flight requests first.
process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
