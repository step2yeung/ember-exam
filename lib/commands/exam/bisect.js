'use strict';

const execa = require('execa');
const fs = require('fs-extra');
const chalk = require('chalk');

/*
  Algorithm for bisecting:
  Read test-execution file.
  rerun the test suite, if fails

  POC:
  run a test executing using `ember exam -re -rb` to see if test fails
    - if it does not fail, retry x times
      - after x times, if it does not fail... report back cannot reproduce failure
      - within the x times, if it does fail... what to do??!?!?!
    - if it does fail...
      - we need to now the module that the test failed on
      - find the module in the json
      - remove everything after it
      - how bisect all the things before it

  open question: what happens if multiple tests are needed to make it fail?
  solution: after as much binary-search as possible is done, just do a linear search??
*/
module.exports = {
  name: 'exam:bisect',

  description:
    'Use binary search to identify the smallest subset of modules to reproduce the failure from a test execution.',

  works: 'insideProject',

  availableOptions: [
    {
      name: 'replay-execution',
      type: 'String',
      aliases: ['re'],
      description: 'A JSON file path which maps from browser id(s) to a list of modules'
    },
    {
      name: 'replay-browser',
      type: [Array, Number, String],
      aliases: ['rb'],
      description: 'The browser id(s) to replay from the replay-execution file'
    },
    {
      name: 'path',
      type: String,
      default: '',
      description: 'The output path of a previous build to run tests against'
    }
  ],

  /**
   * The output directory of the build used to run test bisecting.
   *
   * @type {String}
   */
  _outputDir: 'bisect-dist',

  /**
   * Runs `ember exam` with `--replay-execution` to identify the set of modules that
   * produces a failing test execution. The results of each run are displayed in a
   * table at the end of the command. This is useful for pre-emptively identifying
   * flaky/non-atomic tests in an offline job.
   *
   * @override
   */
  run(commandOptions) {
    const needsBuild = !commandOptions.path;
    const replayExecution = commandOptions.replayExecution;
    const options = commandOptions.options;

    this._write(`Bisecting failing tests from: ${replayExecution}\n----------------------------------------------------------------\n`)

    if (needsBuild) {
      this._buildForTests();
    } else {
      this._outputDir = commandOptions.path;
    }

    const results = this._runBisect(replayExecution, options);

    if (needsBuild) {
      this._cleanupBuild();
    }

    this._write(results.toString(), true);
  },

  /**
   * Writes out a line with a standard color, unless specifically turned off.
   *
   * @param {String} input
   * @param {Boolean} noColor
   */
  _write(input, noColor) {
    if (!noColor) {
      input = chalk.blue(input);
    }

    console.info(input); // eslint-disable-line no-console
  },

  /**
   * Builds the application into a special output directory to run the tests
   * against repeatedly without rebuilding.
   */
  _buildForTests() {
    this._write('\nBuilding app for test bisecting.');
    execa.sync(
      './node_modules/.bin/ember', ['build', '--output-path', `${this._outputDir}`], ['stdio', 'inherit']
    );
  },

  /**
   * Cleans up the build artifacts used for the test bisecting.
   */
  _cleanupBuild() {
    this._write('\nCleaning up test bisecting.\n');
    execa.sync(
      'rm', ['-rf', `${this._outputDir}`]
    );
  },

  /**
   * Read the test execution file and validate that it has the necessary attributes
   *
   * @param {String} executionFilePath
   * @return {Object} testExecutionJson
   */
  _readAndValidateTestExecutionJson(executionFilePath) {
    try {
      const testExecutionJson = fs.readJsonSync(executionFilePath);

      if (testExecutionJson.failedBrowsers === []){
        this._write('\nNo failing tests to iterations.');
        return;
      } else if (!testExecutionJson.failedModulesMap){
        this._write('\nNo failedModulesMap in the test-execution file.');
        return;
      }
      return testExecutionJson;
    } catch (err) {
      throw new Error(`Error reading reply execution JSON file - ${err}`);
    }
  },

  /**
   * Setup chalk & table for write output
   * @return {Object} Table
   */
  _setupChalkAndTable() {
    const Table = require('cli-table3');

    return new Table({
      head: [
        chalk.blue('Test Execution File'),
        chalk.blue('Failure Reproduced?'),
        chalk.blue('Command')
      ]
    });
  },

  _createFailingTestExecutionFiles(testExecutionJson) {
    const failedBrowsers = Object.keys(this.testExecutionJson.failedModulesMap);
    const testExecutionFiles = [];

    failedBrowsers.forEach(browserId => {
      // TODO: should we break up executionMapping to only have one module?
      const moduleMapJson = {
        numberOfBrowsers: 1,
        failedBrowsers: ["1"],
        executionMapping: {
          "1": testExecutionJson.failedModulesMap[browserId]
        }
      }
      const filename = `te-${browserId}.json`;

      try {
        // probably don't need these
        this._write(`Writing the following content to file '${filename}'`);
        this._write(JSON.stringify(moduleMapJson, null, 2));
        fs.writeJsonSync(filename, moduleMapJson, { spaces: 2 });
        testExecutionFiles.push(filename);
      } catch (err) {
        err.file = err.file || filename;
        throw err;
      }
    });

    return testExecutionFiles;
  },

  /**
   * Runs iterations of the test suite and returns a table to display the
   * results.
   *
   * @param {String} replayExecutionPath
   * @param {String} options
   * @return {Table} results
   */
  _runBisect(replayExecutionPath, options) {
    // TODO: validate options??

    // generate dummy re file with single modules from failedModulesMap
    // run the single failing module by itself, if fails.. we got reproduction
    const results = this._setupChalkAndTable();
    this.testExecutionJson = this._readAndValidateTestExecutionJson(replayExecutionPath);
    this.testExecutionFiles = this._createFailingTestExecutionFiles(this.testExecutionJson);
    this.testExecutionFiles.forEach(testExecutionFilename => {
      this._write(`\nRunning test execution file ${testExecutionFilename}:`);
      const testExecutionResults = this._runTests(testExecutionFilename, options);
      results.push([testExecutionFilename].concat(testExecutionResults));
    });

    // TODO: otherwise.. generate dummy re file with test modules above failedModule
    // start bisecting

    return results;
  },

  /**
   * Runs the test suite with replay-execution
   * Returns an array representing a row in the result table for _runIterations.
   *
   * @param {String} options
   * @return {Array} results
   */
  _runTests(testExecutionFilename, options) {
    const chalk = require('chalk');
    const execSync = require('child_process').execSync;

    this._outputDir = this._outputDir || 'dist';

    const command =
      `./node_modules/.bin/ember exam --path ${this._outputDir} -re ${testExecutionFilename}`
    let exitCode;

    try {
      this._write(`\nExecuting: ${command}`);
      execSync(command, { stdio: 'inherit' });
      exitCode = 0;
    } catch (error) {
      this._write('Returned non-zero exit code with error: ' + error);
      exitCode = 1;
      process.exitCode = 1;
    }

    const color = exitCode ? chalk.green : chalk.red;
    return [color(Boolean(exitCode)), color(command)];
  }
};
