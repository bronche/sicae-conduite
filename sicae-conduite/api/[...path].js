const handlers = {
  auth:          require('../netlify/functions/auth').handler,
  interventions: require('../netlify/functions/interventions').handler,
  listes:        require('../netlify/functions/listes').handler,
  transferts:    require('../netlify/functions/transferts').handler,
  backup:        require('../netlify/functions/backup').handler,
  users:         require('../netlify/functions/users').handler,
  journal:       require('../netlify/functions/journal').handler,
  conduite:      require('../netlify/functions/conduite').handler,
};

module.exports = async (req, res) => {
  const url     = req.url || '';
  const pathOnly = url.split('?')[0];
  const parts   = pathOnly.split('/').filter(Boolean);
  const name    = parts[1]; // /api/<name>/...

  const handler = handlers[name];
  if (!handler) return res.status(404).json({ error: `No handler: ${name}` });

  const qs = { ...req.query };
  delete qs.path;

  const body = req.body != null
    ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body))
    : null;

  const event = {
    httpMethod:            req.method,
    headers:               req.headers,
    path:                  pathOnly,
    queryStringParameters: qs,
    body,
  };

  try {
    const result = await handler(event);
    if (result.headers) {
      Object.entries(result.headers).forEach(([k, v]) => res.setHeader(k, v));
    }
    res.status(result.statusCode || 200).end(result.body);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
