/* globals require */

import { setResolver } from '@ember/test-helpers';
import resolver from './helpers/resolver';
import start from 'ember-exam/test-support/start';

Object.keys(require.entries).forEach((entry) => {
  if (entry.indexOf('qunit') !== -1) {
    delete require.entries[entry];
  }
});

setResolver(resolver);
start();
