'use strict';

/**
 * A class to iterate a sequencial set of asynchronous events.
 *
 * @class AsyncIterator
 */
export default class AsyncIterator {
  constructor(testem, options) {
    this._testem = testem;
    this._request = options.request;
    this._response = options.response;
    this._done = false;
    this._current = null;
    this._boundHandleResponse = this.handleResponse.bind(this);
    this._waiting = false;
    // Set a timeout value from either url parameter or default timeout value, 15 s.
    this._timeout = options.timeout || 5;
    this._browserId = options.browserId;
    this._retry = 0;

    testem.on(this._response, this._boundHandleResponse);
  }

  /**
   * Return whether the response queue is done.
   */
  get done() {
    return this._done;
  }

  toString() {
    return `<AsyncIterator (request: ${this._request} response: ${
      this._response
    })>`;
  }

  /**
   * Handle a response when it's waiting for a response
   *
   * @param {*} response
   */
  handleResponse(response) {
    if(this._retry > 1) {
      console.log(`Got a response:`)
      console.log(response);
      console.log(`state:`)
      console.log(this);
    }
    // if (this._waiting === false) {
    //   throw new Error(
    //     `${this.toString()} Was not expecting a response, but got a response:`
    //   );
    // } else {
      this._waiting = false;
    // }

    try {
      if (response.done) {
        this.dispose();
      }

      if(this._retry > 1) {
        throw new Error('retry works!');
      }
      this._current.resolve(response);
    } catch (e) {
      this._current.reject(e);
    } finally {
      this._current = null;

      if (this.timer) {
        clearTimeout(this.timer);
      }
    }
  }

  /**
   * Dispose when an iteration is finished.
   *
   */
  dispose() {
    this._done = true;
    this._testem.removeEventCallbacks(
      this._response,
      this._boundHandleResponse
    );
  }

  /**
   * Emit the current request.
   *
   */
  _makeNextRequest() {
    this._waiting = true;
    this._testem.emit(this._request, this._browserId);
    if (this._retry > 0) {
      console.log(`emitting retry requests for ${this._request} for browserId:${this._browserId}`)
      console.log(`set this._waiting = ${this._waiting}`);
    }
  }

  /**
   * Set a timeout to reject a promise if it doesn't get response within the timeout threshold.
   *
   * @param {*} reject
   */
  _setTimeout(reject) {
    clearTimeout(this.timeout);
    this.timer = setTimeout(() => {
      if (!this._waiting) {
        return;
      }
      console.log(`EmberExam: Promise timed out after ${
        this._timeout
      } s while waiting for response for ${this._request}`);
      this._retry += 1;
      this._timeout += 2;

      if (this._retry > 3) {
        let err = new Error(
          `EmberExam: Promise timed out after ${
            this._timeout
          } s while waiting for response for ${this._request}`
        );
        reject(err);
      } else {
        console.log('retrying request');
        this._current = null;
        this.next();
      }
    }, this._timeout * 1000);
  }

  /**
   * Gets the next response from the request and resolve the promise.
   * if it's end of the iteration resolve the promise with done being true.
   *
   * @return {Promise}
   */
  next() {
    if (this._done) {
      return Promise.resolve({ done: true, value: null });
    }
    if (this._current) {
      return this._current.promise;
    }
    if (this._retry > 0) {
      console.log(`calling next()`);
    }

    let resolve, reject;
    let promise = new Promise((_resolve, _reject) => {
      resolve = _resolve;
      reject = _reject;
      this._setTimeout(reject);
    });

    this._current = {
      resolve,
      reject,
      promise
    };
    this._makeNextRequest();

    return promise;
  }
}
