const { netlifyCompat } = require('../../netlify/functions/lib/netlify-compat');
const { handler }       = require('../../netlify/functions/journal');
module.exports = netlifyCompat(handler);
