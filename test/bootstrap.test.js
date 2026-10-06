import test from 'node:test';
import assert from 'node:assert/strict';
import bootstrap from '../src/remote-bootstrap.cjs';
test('bootstrap rejects live legacy isolated backends and reuses only the current data home', () => {
  const ep = {version:bootstrap.VERSION, pid:process.pid, childPid:process.pid};
  assert.equal(bootstrap.reusableEndpoint(ep), false);
  assert.equal(bootstrap.reusableEndpoint({...ep,dataHome:bootstrap.dataHome + '-isolated'}), false);
  assert.equal(bootstrap.reusableEndpoint({...ep,dataHome:bootstrap.dataHome}), true);
  assert.equal(bootstrap.reusableEndpoint({...ep,dataHome:bootstrap.dataHome,version:'old'}), false);
});
