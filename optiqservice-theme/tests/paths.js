/* Where the tests find the theme files and the generated payload. Keeping this
   in one place means the suites can live beside the theme without every file
   carrying its own relative-path guesswork. */
const path = require('path');
const root = path.join(__dirname, '..');
module.exports = {
  js: path.join(root, 'assets', 'optiq-ai.js'),
  css: path.join(root, 'assets', 'optiq-ai.css'),
  snippet: path.join(root, 'snippets', 'optiq-ai.liquid'),
  knowledge: path.join(root, 'snippets', 'optiq-ai-knowledge.liquid'),
  payload: path.join(__dirname, 'live-payload.json')
};
