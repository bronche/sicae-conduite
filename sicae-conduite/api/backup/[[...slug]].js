const { netlifyCompat } = require('../../netlify/functions/lib/netlify-compat');
const { handler }       = require('../../netlify/functions/backup');
module.exports = netlifyCompat(handler);
