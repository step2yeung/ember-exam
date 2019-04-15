import { module, test } from 'qunit';

module('Module With test failure');

test('failing test #1', function(assert) {
  assert.expect(1);

  assert.ok(false);
});
