import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT) || 3000,
  upstreamBaseUrl: process.env.UPSTREAM_BASE_URL || 'https://urja-ops.flockenergy.tech',
};
