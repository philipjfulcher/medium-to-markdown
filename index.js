'use strict';

// const convertUrls = require('./lib/convertFromMarkdown')
const convertUrls = require('./lib/convertFromUrl')

module.exports = {
  convertUrls
}

// if run as cmd utility
if (typeof require !== 'undefined' && require.main === module) {
  convertUrls().then(function (markdown) {
    console.log('all done'); //=> Markdown content of medium post
  });
}
