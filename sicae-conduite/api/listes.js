const { netlifyCompat } = require('../netlify/functions/lib/netlify-compat');
const { handler }       = require('../netlify/functions/listes');
module.exports = netlifyCompat(handler);
