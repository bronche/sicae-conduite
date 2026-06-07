const { netlifyCompat } = require('../netlify/functions/lib/netlify-compat');
const { handler }       = require('../netlify/functions/users');
module.exports = netlifyCompat(handler);
