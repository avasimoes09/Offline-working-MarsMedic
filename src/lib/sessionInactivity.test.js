import assert from 'node:assert/strict';
import test from 'node:test';
import { getIdleStage, IDLE_LOGOUT_MS, IDLE_WARNING_MS } from './sessionInactivity.js';

test('idle timeout warns at 90 seconds and logs out at two minutes', () => {
  assert.equal(getIdleStage(IDLE_WARNING_MS - 1), 'active');
  assert.equal(getIdleStage(IDLE_WARNING_MS), 'warning');
  assert.equal(getIdleStage(IDLE_LOGOUT_MS - 1), 'warning');
  assert.equal(getIdleStage(IDLE_LOGOUT_MS), 'logout');
});
