import { createApp } from './app.js';
import { config } from './config.js';

const app = createApp();

app.listen(config.port, () => {
  console.log(`urja-meter-api listening on :${config.port}`);
  console.log(`Upstream portal: ${config.upstreamBaseUrl}`);
});
