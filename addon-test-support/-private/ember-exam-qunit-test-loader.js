import getUrlParams from './get-url-params';
import splitTestModules from './split-test-modules';
import weightTestModules from './weight-test-modules';
import { filterTestModules } from './filter-test-modules';
import { TestLoader } from 'ember-qunit/test-loader';
import AsyncIterator from './async-iterator';
import QUnit from 'qunit';

/**
 * Return partitions as an array of values
 */
function getPartitions(partitions) {
  if (partitions === undefined) {
    return [1];
  } else if (!Array.isArray(partitions)) {
    return [partitions];
  }
  return partitions;
}

/**
 * Return split as a number
 */
function getSplit(splitInput) {
  const split = parseInt(splitInput, 10);
  return isNaN(split) ? 1 : split;
}

/**
 * EmberExamQUnitTestLoader allows delayed requiring of test modules to enable test load balancing
 * It extends ember-qunit/test-loader used by `ember test`, since it overrides moduleLoadFailure()
 * to log a test failure when a module fails to load
 * @class EmberExamQUnitTestLoader
 * @extends {TestLoader}
 */
export default class EmberExamQUnitTestLoader extends TestLoader {
  constructor(testem, urlParams, qunit = QUnit) {
    super();
    this._testModules = [];
    this._testem = testem;
    this._qunit = qunit;
    this._urlParams = urlParams || getUrlParams();
    this.retryLimit = 3;
  }

  get urlParams() {
    return this._urlParams;
  }

  /**
   * ember-cli-test-loader instantiates a new TestLoader instance and calls loadModules.
   * EmberExamQUnitTestLoader does not support load() in favor of loadModules().
   */
  static load() {
    throw new Error('`EmberExamQUnitTestLoader` doesn\'t support `load()`.');
  }

  /**
   * require() collects the full list of modules before requiring each module with
   * super.require(), instead of requiring and unseeing a module when each gets loaded.
   *
   * @param {string} moduleName
   */
  require(moduleName) {
    this._testModules.push(moduleName);
  }

  /**
   * Make unsee a no-op to avoid any unwanted resets
   */
  unsee() {}

  /**
   * Loads the test modules depending on the urlParam
   */
  loadModules() {
    const loadBalance = this._urlParams.get('loadBalance');
    const browserId = this._urlParams.get('browser');
    const modulePath = this._urlParams.get('modulePath');
    const filePath = this._urlParams.get('filePath');
    const partitions = getPartitions(this._urlParams.get('partition'));
    const split = getSplit(this._urlParams.get('split'));

    super.loadModules();

    if (modulePath || filePath) {
      this._testModules = filterTestModules(
        this._testModules,
        modulePath,
        filePath
      );
    }

    if (loadBalance && this._testem) {
      this.setupLoadBalanceHandlers();
      this._testModules = splitTestModules(
        weightTestModules(this._testModules),
        split,
        partitions
      );
      this._testem.emit(
        'testem:set-modules-queue',
        this._testModules,
        browserId
      );
    } else {
      this._testModules = splitTestModules(
        this._testModules,
        split,
        partitions
      );
      this._testModules.forEach((moduleName) => {
        super.require(moduleName);
        super.unsee(moduleName);
      });
    }
  }

  /**
   * Allow loading one module at a time.
   *
   * @param {string} moduleName
   */
  loadIndividualModule(moduleName) {
    if (moduleName === undefined) {
      throw new Error(
        'Failed to load a test module. `moduleName` is undefined in `loadIndividualModule`.'
      );
    }
    super.require(moduleName);
    super.unsee(moduleName);
  }

  /**
   * setupLoadBalanceHandlers() registers QUnit callbacks needed for the load-balance option.
   */
  setupLoadBalanceHandlers() {
    // nextModuleAsyncIterator handles the async testem events
    // it returns an element of {value: <moduleName>, done: boolean}
    const nextModuleAsyncIterator = new AsyncIterator(this._testem, {
      request: 'testem:next-module-request',
      response: 'testem:next-module-response',
      timeout: this._urlParams.get('asyncTimeout'),
      browserId: this._urlParams.get('browser'),
    });
    const exitOnError = this._urlParams.get('_emberExamExitOnError');
    let retryCount = 0;

    const nextModuleResolveHandler = response => {
      if (!response.done) {
        const moduleName = response.value;
        this.loadIndividualModule(moduleName);

        // if no tests were added, request the next module
        if (this._qunit.config.queue.length === 0) {
          return nextModuleHandler();
        }
        // reset the retry count
        retryCount = 0;
      }
    };

    const nextModuleRejectHandler = e => {
      if (typeof e === 'object' && e !== null && typeof e.message === 'string') {
        e.message = `EmberExam: Failed to get next test module: ${e.message}`;
      }

      // if retry limit has been reached
      if (retryCount >= this.retryLimit) {
        if (exitOnError) {
          throw new Error(`EmberExam: Failed to get next test module after ${this.retryLimit} retries: ${e}`);
        }

        // eslint-disable-next-line no-console
        console.error(`EmberExam: Failed to get next test module after ${
          this.retryLimit
        } retries: ${e}. Closing browser to exit gracefully.`);
      } else {
        retryCount++;

        // eslint-disable-next-line no-console
        console.log(`EmberExam: Promise timed out after ${
          this._urlParams.get('asyncTimeout')
        } s while waiting for response for testem:next-module-request. Retrying.`)
        return nextModuleHandler();
      }
    };

    const nextModuleHandler = () => {
      return nextModuleAsyncIterator
        .next()
        .then(nextModuleResolveHandler)
        .catch(nextModuleRejectHandler);
    };

    // it registers qunit begin callback to ask for a next test moudle to execute when the test suite begins.
    // By default ember-qunit adds `Ember.onerror` test to a qunit processing queue and once the test is complete it execute _qunit.moduleDone callback.
    // However, when `setupEmberOnerrorValidation: false` is passed the test is disabled and _qunit.begin callback needs to request a next test module to run.
    this._qunit.begin(() => {
      return nextModuleHandler();
    });

    this._qunit.moduleDone(() => {
      return nextModuleHandler();
    });
  }
}
