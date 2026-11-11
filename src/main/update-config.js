'use strict';
// Where Multi-Claude looks for new versions.
//
// A constant rather than a read of package.json: electron-builder strips the
// `build` key from the packaged package.json, so the installed app could never
// see `build.publish`. test/update-feed.test.js fails if the two drift apart.

module.exports = Object.freeze({ owner: 'moshiuzzaman', repo: 'multi-claude' });
