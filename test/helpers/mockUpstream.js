import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici';
import { config } from '../../src/config.js';

/**
 * Node's built-in fetch (which src/services/urjaClient.js uses) is powered
 * by undici, so intercepting the global dispatcher is the correct way to
 * mock it — no HTTP actually leaves the process during tests, and real
 * network access is explicitly disabled so a missing mock fails loudly
 * instead of silently hitting the real portal.
 */
let mockAgent;
let originalDispatcher;

export function mockUpstream() {
  originalDispatcher = getGlobalDispatcher();
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
  return mockAgent.get(config.upstreamBaseUrl);
}

export async function restoreUpstream() {
  await mockAgent?.close();
  setGlobalDispatcher(originalDispatcher);
}

export function jsonReply(body) {
  return { statusCode: 200, data: JSON.stringify(body), headers: { 'content-type': 'application/json' } };
}
