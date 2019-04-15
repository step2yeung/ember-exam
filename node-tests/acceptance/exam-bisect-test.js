'use strict';

const assert = require('assert');
const execa = require('execa');
const fixturify = require('fixturify');
const fs = require('fs-extra');
const path = require('path');
const rimraf = require('rimraf');

describe('Failure Cases', function() {
  this.timeout(60000);

  const destPath = path.join(
    __dirname,
    '..',
    '..',
    'tests',
    'unit',
    'test-failure-test.js'
  );
  beforeEach(function() {
    const failingTestPath = path.join(
      __dirname,
      '..',
      'fixtures',
      'test-failure.js'
    );
    fs.copySync(failingTestPath, destPath);
    return execa('ember', ['build', '--output-path', 'failure-dist']);
  });

  // afterEach(function() {
  //   rimraf.sync('failure-dist');
  //   fs.removeSync(destPath);
  // });

  it.only('should write test-execution json when browser exits', function() {
    assert.ok(false);
  });
});
