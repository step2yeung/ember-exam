'use strict';

const assert = require('assert');
const execa = require('execa');
const fs = require('fs-extra');
const path = require('path');
const rimraf = require('rimraf');

function assertExpectRejection() {
  assert.ok(false, 'Expected promise to reject, but it fullfilled');
}

function getNumberOfTests(str) {
  const match = str.match(/# tests ([0-9]+)/);
  return match && parseInt(match[1], 10);
}

const TOTAL_NUM_TESTS = 47; // Total Number of tests without the global 'Ember.onerror validation tests'

const originalTestHelperPath = path.join(
  __dirname,
  '..',
  '..',
  'tests',
  'test-helper.js'
);

const renamedQunitTestHelperPath = path.join(
  __dirname,
  '..',
  '..',
  'tests',
  'test-helper-with-qunit.js'
);

const testHelperWithMochaPath = path.join(
  __dirname,
  '..',
  'fixtures',
  'test-helper-with-mocha.js'
);

function getTotalNumberOfTests() {
  // remove me later
  return TOTAL_NUM_TESTS;
}

describe.only('Acceptance | Exam Command with Ember-Mocha', function() {
  this.timeout(300000);

  before(function() {
    // Cleanup any previous runs
    rimraf.sync('acceptance-dist');

    // Use test-helper-with-mocha.js as the test-helper.js file
    fs.renameSync(originalTestHelperPath, renamedQunitTestHelperPath);
    fs.copySync(testHelperWithMochaPath, originalTestHelperPath);

    // Build the app
    return execa('ember', ['build', '--output-path', 'acceptance-dist']);
  });

  after(function() {
    rimraf.sync('acceptance-dist');

    // restore the qunit test-helper.js file
    fs.unlinkSync(originalTestHelperPath);
    fs.renameSync(renamedQunitTestHelperPath, originalTestHelperPath);
  });

  function assertOutput(output, text, good, bad) {
    good.forEach(function(partition) {
      assert.ok(
        output.includes(`${text} ${partition} `),
        `output has ${text} ${partition}`
      );
    });

    (bad || []).forEach(function(partition) {
      assert.ok(
        !output.includes(`${text} ${partition} `),
        `output does not have ${text} ${partition}`
      );
    });
  }

  function assertAllPartitions(output) {
    assertOutput(output, 'Exam Partition', [1, 2, 3]);
    assert.equal(
      getNumberOfTests(output),
      getTotalNumberOfTests(output),
      'ran all of the tests in the suite'
    );
  }

  function assertSomePartitions(output, good, bad) {
    assertOutput(output, 'Exam Partition', good, bad);
    assert.ok(
      getNumberOfTests(output) < getTotalNumberOfTests(output),
      'did not run all of the tests in the suite'
    );
  }

  it('runs all tests normally', function() {
    return execa('ember', ['exam', '--path', 'acceptance-dist']).then(child => {
      const stdout = child.stdout;
      assert.ok(
        !stdout.includes('Exam Partition'),
        'does not add any sort of partition info'
      );
      assert.equal(
        getNumberOfTests(stdout),
        getTotalNumberOfTests(stdout),
        'ran all of the tests in the suite'
      );
    });
  });

  describe('Split', function() {
    it('splits the test suite but only runs the first partition', function() {
      return execa('ember', [
        'exam',
        '--split',
        '3',
        '--path',
        'acceptance-dist'
      ]).then(child => {
        assertSomePartitions(child.stdout, [1], [2, 3]);
      });
    });

    describe('Partition', function() {
      it('splits the test suite and runs a specified partition', function() {
        return execa('ember', [
          'exam',
          '--split',
          '3',
          '--partition',
          '2',
          '--path',
          'acceptance-dist'
        ]).then(child => {
          assertSomePartitions(child.stdout, [2], [1, 3]);
        });
      });

      it('splits the test suite and runs multiple specified partitions', function() {
        return execa('ember', [
          'exam',
          '--split',
          '3',
          '--partition',
          '1,3',
          '--path',
          'acceptance-dist'
        ]).then(child => {
          assertSomePartitions(child.stdout, ['1,3'], [1, 2, 3]);
        });
      });

      it('errors when running an invalid partition', function() {
        return execa('ember', [
          'exam',
          '--split',
          '3',
          '--partition',
          '4',
          '--path',
          'acceptance-dist'
        ]).then(assertExpectRejection, error => {
          assert.ok(
            error.message.includes(
              'You must specify `partition` values that are less than or equal to your `split` value.'
            )
          );
        });
      });

      it('errors when specifying a partition but no split count', function() {
        return execa('ember', [
          'exam',
          '--partition',
          '2',
          '--path',
          'acceptance-dist'
        ]).then(assertExpectRejection, error => {
          assert.ok(
            error.message.includes(
              'You must specify a `split` value in order to use `partition`.'
            )
          );
        });
      });
    });

    describe('Parallel', function() {
      it('runs multiple partitions in parallel', function() {
        return execa('ember', [
          'exam',
          '--path',
          'acceptance-dist',
          '--split',
          '3',
          '--parallel'
        ]).then(child => {
          assertAllPartitions(child.stdout);
        });
      });

      it('runs multiple specified partitions in parallel', function() {
        return execa('ember', [
          'exam',
          '--split',
          '3',
          '--partition',
          '1,3',
          '--path',
          'acceptance-dist',
          '--parallel'
        ]).then(child => {
          assertSomePartitions(child.stdout, [1, 3], [2]);
        });
      });
    });
  });

  describe('Random', function() {
    it('runs tests with the passed in seeds', function() {
      return execa('ember', [
        'exam',
        '--random',
        '1337',
        '--path',
        'acceptance-dist'
      ]).then(child => {
        const stdout = child.stdout;
        assert.ok(
          stdout.includes('Randomizing tests with seed: 1337'),
          'logged the seed value'
        );
        assert.equal(
          getNumberOfTests(stdout),
          getTotalNumberOfTests(stdout),
          'ran all of the tests in the suite'
        );
      });
    });
  });

  describe('Load Balance', function() {
    it('should throw an error', function() {
      assert.ok(false);
    });
  });

  describe('Replay Execution', function() {
    it('should throw an error', function() {
      assert.ok(false);
    });
  });
});
