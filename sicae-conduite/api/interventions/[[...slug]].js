const { netlifyCompat } = require('../../netlify/functions/lib/netlify-compat');
const { handler }       = require('../../netlify/functions/interventions');
module.exports = netlifyCompat(handler);
