const { netlifyCompat } = require('../../netlify/functions/lib/netlify-compat');
const { handler }       = require('../../netlify/functions/auth');
module.exports = netlifyCompat(handler);
