'use strict';
// The GitHub repository "Report a problem" opens an issue in. Not read from package.json at run time: the installed
// app's package.json has no "build" section (electron-builder leaves it out). test/packaged.test.js checks that this
// matches build.publish.

const REPO = Object.freeze({ owner: 'izscaryu', repo: 'pauli-speaks' });

module.exports = { REPO };
