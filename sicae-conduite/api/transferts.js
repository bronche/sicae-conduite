const { netlifyCompat } = require('../netlify/functions/lib/netlify-compat');
const { handler }       = require('../netlify/functions/transferts');
module.exports = netlifyCompat(handler);
